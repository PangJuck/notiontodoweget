/* 워커를 진짜로 돌려 보는 시험. 노션과 Cloudflare Access를 흉내 내고,
 * 이 파일이 직접 만든 열쇠로 Access 토큰을 서명해 넣는다.
 *
 *   cd worker && npm test
 *
 * 보는 것은 하나다 — **남의 것이 새어 나가지 않는가.** 누가 어느 DB를 묻게
 * 되는지, 거부된 요청이 노션에 쓰기를 시도조차 안 하는지까지 본다.
 * 노션에 붙지 않으므로 토큰도 네트워크도 필요 없다.
 */
import crypto from "node:crypto";
import worker from "../index.js";

const AUD = "test-aud";
const DOMAIN = "team.cloudflareaccess.com";
const TEAM_DB = "6f9008aa63f249109b6ed29a374b529d";
const PERSONAL_DB = "1730d225784340f88e15f9af9d51ea78";

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
  ok("성준의 업무·개인 DB는 묻지도 않는다", !q.some(c => dbOf(c) !== TEAM_DB));
  ok("응답이 성공", out.ok === true);
}
{
  const { calls } = await api("ga@x.com", "log", ["", 90]);
  const q = queries(calls);
  const f = JSON.stringify(q[0].body);
  ok("기록도 팀 DB만 묻는다", q.length === 1 && dbOf(q[0]) === TEAM_DB);
  ok("기록은 완료된 것만, 완료일 내림차순", f.includes('"완료"') && f.includes('"완료일"') && f.includes('descending'));
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
console.log("── 관리자(성준)");
{
  const { calls } = await api("sj@x.com", "data");
  const q = queries(calls);
  ok("두 DB만 묻는다 — 개인과 팀", q.length === 2, q.map(dbOf).join(","));
  ok("개인 DB가 그 안에 있다(성준만 본다)", q.some(c => dbOf(c) === PERSONAL_DB));
  ok("팀 DB도 본다", q.some(c => dbOf(c) === TEAM_DB));
  ok("없앤 업무 DB는 아무도 묻지 않는다",
     !q.some(c => dbOf(c) === "0e928040351d4fdfae49f77e67e914e6"));
}
{
  pages["p-open"] = { parent: TEAM_DB, owner: "창준", priv: false };
  const { out } = await api("sj@x.com", "setdue", ["p-open", "2026-10-01"]);
  ok("관리자는 팀 항목을 고칠 수 있다", out.ok === true);
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

console.log("── 구글 캘린더용 .ics 피드");
{
  // 노션이 개인 DB를 물으면 할 일 두 건을 준다
  const rowsFor = (dbId) => dbId === PERSONAL_DB ? [
    { id: "aaaa-bbbb", properties: {
        "할 일": { title: [{ plain_text: "치과 예약; 오후, 반차\n확인" }] },
        "마감일": { date: { start: "2026-09-18" } },
        "메모": { rich_text: [{ plain_text: "보험 서류 챙기기" }] },
        "우선순위": { select: { name: "2 핵심 업무 (중요+안시급)" } } } },
    { id: "cccc-dddd", properties: {
        "할 일": { title: [{ plain_text: "날짜 없는 것은 달력에 못 올린다" }] } } },
  ] : [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.endsWith("/query")) {
      const db = s.match(/databases\/([^/]+)\/query/)[1];
      return new Response(JSON.stringify({ results: rowsFor(db), has_more: false }),
        { headers: { "content-type": "application/json" } });
    }
    return prevFetch(u, init);
  };
  const feedEnv = { ...env, ICS_TOKEN: "s".repeat(43) };
  const get = (path, e = feedEnv) => worker.fetch(new Request("https://w.dev" + path), e);

  ok("토큰이 없으면 길 자체가 없다", (await get("/feed/whatever.ics", env)).status === 404);
  ok("틀린 토큰은 404 (403이면 주소가 맞다고 알려주는 셈)",
     (await get("/feed/" + "x".repeat(43) + ".ics")).status === 404);
  ok("길이만 같고 값이 다른 토큰도 404",
     (await get("/feed/" + "s".repeat(42) + "x.ics")).status === 404);

  const res = await get("/feed/" + "s".repeat(43) + ".ics");
  const body = await res.text();
  ok("맞는 토큰이면 캘린더를 내준다",
     res.status === 200 && res.headers.get("content-type").startsWith("text/calendar"));
  ok("로그인(Access 토큰) 없이 읽힌다", body.startsWith("BEGIN:VCALENDAR"));
  ok("마감일 있는 것만 일정이 된다", (body.match(/BEGIN:VEVENT/g) || []).length === 1);
  ok("종일 일정이고 끝 날짜는 다음 날이다",
     body.includes("DTSTART;VALUE=DATE:20260918") && body.includes("DTEND;VALUE=DATE:20260919"));
  ok("세미콜론과 줄바꿈이 escape 된다", body.includes("치과 예약\\; 오후\\, 반차\\n확인"));
  ok("줄은 CRLF로 끝난다", body.includes("\r\n") && !/[^\r]\n/.test(body));
  ok("75옥텟 넘는 줄이 없다(접힌다)",
     body.split("\r\n").every(l => new TextEncoder().encode(l).length <= 75));
  ok("검색에 잡히지 않게 막아 둔다", (res.headers.get("x-robots-tag") || "").includes("noindex"));

  // 이 문으로 팀 DB가 나가면 안 된다
  let asked = [];
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    if (s.endsWith("/query")) {
      asked.push(s.match(/databases\/([^/]+)\/query/)[1]);
      return new Response(JSON.stringify({ results: [], has_more: false }),
        { headers: { "content-type": "application/json" } });
    }
    return prevFetch(u, init);
  };
  await get("/feed/" + "s".repeat(43) + ".ics");
  ok("개인 DB만 묻는다 — 팀·업무는 이 문으로 안 나간다",
     asked.length === 1 && asked[0] === PERSONAL_DB, asked.join(","));

  ok("POST로는 못 부른다",
     (await worker.fetch(new Request("https://w.dev/feed/x.ics", { method: "POST" }), feedEnv)).status === 405);
  globalThis.fetch = prevFetch;
}

console.log(fails ? `\n${fails}건 실패` : "\n전부 통과");
process.exit(fails ? 1 : 0);
