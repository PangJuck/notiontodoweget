/* 워커를 진짜로 돌려 보는 시험. 노션과 Cloudflare Access를 흉내 내고,
 * 이 파일이 직접 만든 열쇠로 Access 토큰을 서명해 넣는다.
 *
 *   cd worker && npm test
 *
 * 보는 것은 하나다 — **남의 것이 새어 나가지 않는가.** 거르개가 노션 질의에
 * 실려 나가는지, 거부된 요청이 노션에 쓰기를 시도조차 안 하는지까지 본다.
 * 노션에 붙지 않으므로 토큰도 네트워크도 필요 없다.
 */
import crypto from "node:crypto";
import worker from "../index.js";

const AUD = "test-aud";
const DOMAIN = "team.cloudflareaccess.com";
const TEAM_DB = "6f9008aa63f249109b6ed29a374b529d";
const WORK_DB = "0e928040351d4fdfae49f77e67e914e6";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function mint(email) {
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = b64({ iss: `https://${DOMAIN}`, aud: [AUD], email, exp: Math.floor(Date.now()/1000) + 600 });
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

// ── 노션 흉내. 오간 요청을 전부 기록해 두고 나중에 들여다본다.
let calls = [];
let pages = {};   // pageId -> {parent, owner, priv}
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: u, method: init.method || "GET", body });
  const json = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  if (u.includes("/cdn-cgi/access/certs")) return json({ keys: [jwk] });
  if (/\/v1\/databases\/[^/]+$/.test(u)) {
    return json({ properties: { 우선순위: { select: { options: [
      { name: "1 지금 당장 (중요+시급)" }, { name: "2 핵심 업무 (중요+안시급)" },
      { name: "3 빠르게 쳐낼 (안중요+시급)" }, { name: "4 언젠가 (안중요+안시급)" }] } } } });
  }
  if (u.endsWith("/query")) return json({ results: [], has_more: false, next_cursor: null });
  if (/\/v1\/pages\/[^/]+$/.test(u)) {
    const id = u.split("/").pop();
    if ((init.method || "GET") === "GET") {
      const pg = pages[id] || { parent: TEAM_DB, owner: "가영", priv: false };
      return json({ id, parent: { database_id: pg.parent },
        properties: { 담당자: { select: { name: pg.owner } }, 비공개: { checkbox: pg.priv } } });
    }
    return json({ id });
  }
  return json({});
};

const env = {
  NOTION_TOKEN: "tok", ACCESS_DOMAIN: DOMAIN, ACCESS_AUD: AUD,
  TEAM: JSON.stringify({ admins: ["sj@x.com"], members: { "sj@x.com": "성준", "ga@x.com": "가영" } }),
};

async function api(email, name, args = []) {
  calls = [];
  const res = await worker.fetch(new Request(`https://w.dev/api/${name}`, {
    method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint(email), "content-type": "application/json" },
    body: JSON.stringify({ args }),
  }), env);
  return { out: await res.json(), calls };
}

const queries = (cs) => cs.filter(c => c.url.endsWith("/query"));
const dbOf = (c) => c.url.match(/databases\/([^/]+)\/query/)[1];
let fails = 0;
const ok = (label, cond, extra) => { console.log((cond ? "  ok  " : "FAIL  ") + label + (extra ? "  " + extra : "")); if (!cond) fails++; };

console.log("── 팀원(가영)");
{
  const { out, calls } = await api("ga@x.com", "data");
  const q = queries(calls);
  ok("자기가 볼 수 있는 DB만 묻는다", q.length === 1 && dbOf(q[0]) === TEAM_DB, q.map(dbOf).join(","));
  const f = JSON.stringify(q[0].body.filter);
  ok("비공개 거르개가 질의에 실려 나간다", f.includes('"비공개"') && f.includes('"가영"'));
  ok("질의가 or 안에 내 이름만 담는다", /"or":\[\{"property":"비공개"[^\]]*"가영"/.test(f), f.slice(0, 200));
  ok("응답이 성공", out.ok === true);
}
{
  const { calls } = await api("ga@x.com", "log", ["", 90]);
  const q = queries(calls);
  const f = JSON.stringify(q[0].body);
  ok("기록도 같은 거르개를 지난다", f.includes('"비공개"') && f.includes('"완료일"'));
  ok("기록은 완료된 것만", f.includes('"완료","checkbox":{"equals":true}') || f.includes('"property":"완료"'));
}
{
  pages["p-mine"] = { parent: TEAM_DB, owner: "가영", priv: false };
  const { out, calls } = await api("ga@x.com", "setdue", ["p-mine", "2026-10-01"]);
  const patch = calls.find(c => c.method === "PATCH");
  ok("내 항목의 마감일은 바뀐다", out.ok === true && !!patch && patch.body.properties["마감일"].date.start === "2026-10-01");
}
{
  pages["p-other"] = { parent: TEAM_DB, owner: "창준", priv: false };
  const { out, calls } = await api("ga@x.com", "setdue", ["p-other", "2026-10-01"]);
  ok("남의 항목은 거부된다", out.ok === false && out.error === "내 항목이 아니다");
  ok("거부되면 노션에 쓰지 않는다", !calls.some(c => c.method === "PATCH"));
}
{
  const { out } = await api("ga@x.com", "setdue", ["p-mine", "2026/10/01"]);
  ok("형식이 틀린 날짜는 노션까지 안 간다", out.ok === false && out.error === "날짜를 알아보지 못했다", out.error);
}
{
  const { out, calls } = await api("ga@x.com", "setpriv", ["p-mine", true]);
  const patch = calls.find(c => c.method === "PATCH");
  ok("비공개를 켤 수 있다", out.ok === true && patch.body.properties["비공개"].checkbox === true);
}

console.log("── 관리자(성준)");
{
  const { calls } = await api("sj@x.com", "data");
  const q = queries(calls);
  ok("세 DB를 다 묻는다", q.length === 3, q.map(dbOf).join(","));
  const personal = q.filter(c => dbOf(c) !== TEAM_DB);
  ok("업무·개인 DB에는 비공개 조건을 걸지 않는다",
     personal.every(c => !JSON.stringify(c.body.filter).includes("비공개")));
  const team = q.find(c => dbOf(c) === TEAM_DB);
  ok("팀 DB에는 건다(관리자도 남의 비공개는 못 본다)", JSON.stringify(team.body.filter).includes("비공개"));
}
{
  pages["p-secret"] = { parent: TEAM_DB, owner: "창준", priv: true };
  const { out, calls } = await api("sj@x.com", "setdue", ["p-secret", "2026-10-01"]);
  ok("관리자도 남의 비공개 항목은 못 고친다", out.ok === false && out.error === "내 항목이 아니다");
  ok("쓰기 시도 자체가 없다", !calls.some(c => c.method === "PATCH"));
}
{
  pages["p-open"] = { parent: TEAM_DB, owner: "창준", priv: false };
  const { out } = await api("sj@x.com", "setdue", ["p-open", "2026-10-01"]);
  ok("관리자는 팀에 열린 항목은 고칠 수 있다(전과 같음)", out.ok === true);
}
{
  pages["p-work"] = { parent: WORK_DB, owner: "", priv: false };
  const { out } = await api("sj@x.com", "setpriv", ["p-work", true]);
  ok("업무 DB에는 비공개를 못 건다", out.ok === false && out.error === "팀 할 일에만 쓸 수 있다", out.error);
}

console.log("── 캘린더 커넥터 (아직 안 붙인 상태)");
{
  // 설정이 없으면 아무 일도 없어야 한다 — 노션 말고 아무 데도 나가지 않는다.
  pages["p-cal"] = { parent: TEAM_DB, owner: "가영", priv: false };
  const { out, calls } = await api("ga@x.com", "setdue", ["p-cal", "2026-10-05"]);
  ok("설정이 없으면 캘린더로 나가는 요청이 없다",
     out.ok === true && !calls.some(c => !c.url.includes("notion.com") && !c.url.includes("cloudflareaccess")));
}
{
  // 커넥터가 터져도 할 일은 기록돼야 한다. 캘린더가 안 맞는 것은 불편이고,
  // 할 일이 안 들어가는 것은 고장이다.
  const env2 = { ...env, CALENDAR: JSON.stringify({ provider: "google" }) };
  calls = [];
  const res = await worker.fetch(new Request("https://w.dev/api/setdue", {
    method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint("ga@x.com"), "content-type": "application/json" },
    body: JSON.stringify({ args: ["p-cal", "2026-10-06"] }),
  }), env2);
  const out = await res.json();
  await new Promise(r => setTimeout(r, 30)); // 커넥터는 await 하지 않으므로 잠깐 기다렸다 본다
  ok("커넥터가 터져도 할 일은 저장된다", out.ok === true);
}

console.log(fails ? `\n${fails}건 실패` : "\n전부 통과");
process.exit(fails ? 1 : 0);
