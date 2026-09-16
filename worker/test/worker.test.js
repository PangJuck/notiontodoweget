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

console.log("── 구글 캘린더에 실제로 쓰기");
{
  // 서비스 계정 키 노릇을 할 열쇠. 위에서 만든 것을 그대로 쓴다.
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    privateKey.export({ type: "pkcs8", format: "der" }).toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END PRIVATE KEY-----\n";
  const calEnv = { ...env, CALENDAR: JSON.stringify({
    provider: "google", client_email: "bot@x.iam.gserviceaccount.com",
    private_key: pem, calendar_id: "cal123@group.calendar.google.com", owner: "성준" }) };

  let seen = [];
  let notionRow = null;
  const prevFetch = globalThis.fetch;
  const jsonRes = (o, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    const body = init.body;
    seen.push({ url: s, method: init.method || "GET", body });
    if (s.includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok", expires_in: 3600 });
    if (s.includes("googleapis.com/calendar")) return jsonRes({ id: "e" });
    if (/api\.notion\.com\/v1\/pages\/[^/]+$/.test(s) && (init.method || "GET") === "GET" && notionRow)
      return jsonRes(notionRow);
    return prevFetch(u, init);
  };
  const calls = (pat) => seen.filter(c => c.url.includes(pat));
  const run = async (args) => {
    seen = [];
    const res = await worker.fetch(new Request("https://w.dev/api/setdue", {
      method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint("sj@x.com"), "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }), calEnv);
    await res.json();
    await new Promise(r => setTimeout(r, 80)); // 캘린더는 응답을 기다리지 않는다
  };

  // 개인 DB 항목
  pages["p-priv"] = { parent: PERSONAL_DB, owner: "", priv: false };
  notionRow = { id: "p-priv", url: "https://notion.so/p-priv",
    parent: { database_id: PERSONAL_DB },
    properties: { "할 일": { title: [{ plain_text: "치과 예약" }] },
      "마감일": { date: { start: "2026-09-25" } },
      "메모": { rich_text: [{ plain_text: "보험 서류" }] }, "완료": { checkbox: false } } };
  await run(["p-priv", "2026-09-25"]);
  const put = calls("googleapis.com/calendar").find(c => c.method === "PUT");
  ok("개인 항목이 구글 캘린더에 써진다", !!put, put ? "" : JSON.stringify(seen.map(c=>c.url)));
  ok("공유받은 그 캘린더에만 쓴다", put && put.url.includes(encodeURIComponent("cal123@group.calendar.google.com")));
  const ev = put && JSON.parse(put.body);
  ok("종일 일정이고 끝 날짜는 다음 날", ev && ev.start.date === "2026-09-25" && ev.end.date === "2026-09-26");
  ok("제목과 메모가 실린다", ev && ev.summary === "치과 예약" && ev.description.includes("보험 서류"));
  ok("일정 id를 노션 page_id에서 만든다(두 번 안 생기게)", ev && ev.id === "todop-priv".replace(/-/g, ""));
  ok("하루를 바쁨으로 잡지 않는다", ev && ev.transparency === "transparent");

  // 토큰 요청이 진짜로 서명돼 있는지 — 공개키로 검증해 본다
  const tokenCall = calls("oauth2.googleapis.com").pop();
  const assertion = new URLSearchParams(tokenCall.body).get("assertion");
  const [h, b, sg] = assertion.split(".");
  ok("JWT 서명이 서비스 계정 키로 검증된다",
     crypto.verify("RSA-SHA256", Buffer.from(`${h}.${b}`), publicKey, Buffer.from(sg, "base64url")));
  const claim = JSON.parse(Buffer.from(b, "base64url").toString());
  ok("남의 자격으로 행세하지 않는다(sub 없음)", !claim.sub, JSON.stringify(claim));
  ok("일정 권한만 달라고 한다", claim.scope === "https://www.googleapis.com/auth/calendar.events");

  // 완료된 항목은 캘린더에서 빠진다
  notionRow = { ...notionRow, properties: { ...notionRow.properties, "완료": { checkbox: true } } };
  await run(["p-priv", "2026-09-25"]);
  ok("완료하면 일정이 지워진다", calls("googleapis.com/calendar").some(c => c.method === "DELETE"));

  // 팀 DB — 내 것은 올라가고
  pages["p-team"] = { parent: TEAM_DB, owner: "성준", priv: false };
  notionRow = { id: "p-team", url: "", parent: { database_id: TEAM_DB },
    properties: { "할 일": { title: [{ plain_text: "출고 확인" }] },
      "마감일": { date: { start: "2026-09-30" } }, "담당자": { select: { name: "성준" } },
      "완료": { checkbox: false } } };
  await run(["p-team", "2026-09-30"]);
  ok("팀 DB의 내 항목도 올라간다", calls("googleapis.com/calendar").some(c => c.method === "PUT"));

  // 남의 것은 안 올라간다
  pages["p-other2"] = { parent: TEAM_DB, owner: "가영", priv: false };
  notionRow = { ...notionRow, id: "p-other2", properties: { ...notionRow.properties,
    "담당자": { select: { name: "가영" } } } };
  seen = [];
  await worker.fetch(new Request("https://w.dev/api/setdue", {
    method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint("sj@x.com"), "content-type": "application/json" },
    body: JSON.stringify({ args: ["p-other2", "2026-09-30"] }),
  }), calEnv).then(r => r.json());
  await new Promise(r => setTimeout(r, 80));
  ok("팀원 항목은 내 캘린더에 안 올라간다",
     !calls("googleapis.com/calendar").some(c => c.method === "PUT"));

  globalThis.fetch = prevFetch;
}

console.log("── 주기 동기화 (클로드·위젯으로 넣은 것까지)");
{
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    privateKey.export({ type: "pkcs8", format: "der" }).toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END PRIVATE KEY-----\n";
  const calEnv = { ...env, CALENDAR: JSON.stringify({
    provider: "google", client_email: "bot@x.iam.gserviceaccount.com",
    private_key: pem, calendar_id: "cal123@group.calendar.google.com", owner: "성준" }) };

  const row = (id, title, due, owner, extra = {}) => ({
    id, parent: { database_id: owner ? TEAM_DB : PERSONAL_DB },
    properties: {
      "할 일": { title: [{ plain_text: title }] },
      "마감일": { date: { start: due } },
      "완료": { checkbox: false },
      ...(owner ? { "담당자": { select: { name: owner } } } : {}),
      ...extra,
    },
  });
  // 노션 쪽: 개인 두 건, 팀(성준) 한 건
  const rowsFor = (db) => db === PERSONAL_DB
    ? [row("11112222", "치과 예약", "2026-09-25", null,
           { "메모": { rich_text: [{ plain_text: "보험 서류" }] } }),
       row("33334444", "이미 맞는 것", "2026-10-01", null)]
    : [row("55556666", "출고 확인", "2026-09-30", "성준")];
  // 구글 쪽: 하나는 이미 같고, 하나는 노션에 없고, 하나는 사람이 직접 넣은 것
  const already = [
    { id: "todo33334444", summary: "이미 맞는 것", start: { date: "2026-10-01" }, end: { date: "2026-10-02" } },
    { id: "todo99999999", summary: "노션에서 사라진 것", start: { date: "2026-09-01" }, end: { date: "2026-09-02" } },
    { id: "meeting1", summary: "사람이 직접 넣은 회의", start: { date: "2026-09-02" }, end: { date: "2026-09-03" } },
  ];

  let seen = [];
  let queried = [];
  const prevFetch = globalThis.fetch;
  const jsonRes = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u), m = init.method || "GET";
    seen.push({ url: s, method: m, body: init.body });
    if (s.includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok", expires_in: 3600 });
    if (s.includes("googleapis.com/calendar")) {
      if (m === "GET") return jsonRes({ items: already });
      return jsonRes({ id: "e" });
    }
    if (s.includes("/query")) {
      const db = s.match(/databases\/([^/]+)\/query/)[1];
      queried.push({ db, body: JSON.parse(init.body) });
      return jsonRes({ results: rowsFor(db), has_more: false });
    }
    return prevFetch(u, init);
  };

  await worker.scheduled({}, calEnv, { waitUntil: () => {} });
  const gcal = seen.filter(c => c.url.includes("googleapis.com/calendar"));
  const puts = gcal.filter(c => c.method === "PUT").map(c => JSON.parse(c.body));
  const dels = gcal.filter(c => c.method === "DELETE").map(c => c.url.split("/").pop());

  ok("시계가 깨우면 노션 두 DB를 읽는다", queried.length === 2, queried.map(q => q.db).join(","));
  ok("팀 DB는 내 것만 묻는다",
     JSON.stringify(queried.find(q => q.db === TEAM_DB).body).includes('"담당자"'));
  ok("마감일 없는 줄은 애초에 안 가져온다",
     JSON.stringify(queried[0].body).includes("is_not_empty"));
  ok("클로드로 넣은 개인 항목이 캘린더에 올라간다",
     puts.some(e => e.id === "todo11112222" && e.summary === "치과 예약"), JSON.stringify(puts.map(e=>e.id)));
  ok("팀 DB의 내 항목도 같이 올라간다", puts.some(e => e.id === "todo55556666"));
  ok("이미 같은 것은 다시 쓰지 않는다", !puts.some(e => e.id === "todo33334444"));
  ok("노션에서 사라진 것은 캘린더에서도 지운다", dels.includes("todo99999999"), dels.join(","));
  ok("사람이 직접 넣은 일정은 건드리지 않는다", !dels.includes("meeting1"), dels.join(","));

  // 두 번 돌려도 결과가 같아야 한다 — 기억이 아니라 대조로 맞추기 때문이다
  seen = []; queried = [];
  await worker.scheduled({}, calEnv, { waitUntil: () => {} });
  const again = seen.filter(c => c.url.includes("googleapis.com/calendar") && c.method === "PUT");
  ok("두 번 돌려도 하는 일이 같다(두 번 안 생긴다)", again.length === 2, String(again.length));

  // 설정이 없으면 깨어나도 아무 데도 안 나간다
  seen = [];
  await worker.scheduled({}, env, { waitUntil: () => {} });
  ok("CALENDAR 시크릿이 없으면 노션도 구글도 안 부른다", seen.length === 0, String(seen.length));

  globalThis.fetch = prevFetch;
}

console.log("── 캘린더를 둘로 나눴을 때 (개인 / 회사)");
{
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    privateKey.export({ type: "pkcs8", format: "der" }).toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END PRIVATE KEY-----\n";
  const TEAM_CAL = "work@group.calendar.google.com";
  const MINE_CAL = "mine@group.calendar.google.com";
  const calEnv = { ...env, CALENDAR: JSON.stringify({
    provider: "google", client_email: "bot@x.iam.gserviceaccount.com", private_key: pem,
    calendar_id: TEAM_CAL, personal_calendar_id: MINE_CAL, owner: "성준" }) };

  const row = (id, title, due, owner) => ({
    id, parent: { database_id: owner ? TEAM_DB : PERSONAL_DB },
    properties: {
      "할 일": { title: [{ plain_text: title }] },
      "마감일": { date: { start: due } },
      "완료": { checkbox: false },
      ...(owner ? { "담당자": { select: { name: owner } } } : {}),
    },
  });
  const rowsFor = (db) => db === PERSONAL_DB
    ? [row("aaaa1111", "치과 예약", "2026-09-25", null)]
    : [row("bbbb2222", "출고 확인", "2026-09-30", "성준")];
  // 개인 캘린더에 회사 것이 잘못 들어가 있다. 대조하면 치워져야 한다.
  const stale = { id: "todocccc3333", summary: "옛날 것",
    start: { date: "2026-09-01" }, end: { date: "2026-09-02" } };

  let seen = [];
  const prevFetch = globalThis.fetch;
  const jsonRes = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u), m = init.method || "GET";
    seen.push({ url: s, method: m, body: init.body });
    if (s.includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok", expires_in: 3600 });
    if (s.includes("googleapis.com/calendar")) {
      if (m === "GET") return jsonRes({ items: s.includes(encodeURIComponent(MINE_CAL)) ? [stale] : [] });
      return jsonRes({ id: "e" });
    }
    if (s.includes("/query")) {
      const db = s.match(/databases\/([^/]+)\/query/)[1];
      return jsonRes({ results: rowsFor(db), has_more: false });
    }
    return prevFetch(u, init);
  };

  await worker.scheduled({}, calEnv, { waitUntil: () => {} });
  const onCal = (cal, method) => seen.filter(c =>
    c.url.includes(encodeURIComponent(cal)) && c.method === method);

  const mine = onCal(MINE_CAL, "PUT").map(c => JSON.parse(c.body));
  const work = onCal(TEAM_CAL, "PUT").map(c => JSON.parse(c.body));
  ok("개인 할 일은 개인 캘린더로 간다", mine.length === 1 && mine[0].summary === "치과 예약",
     JSON.stringify(mine.map(e => e.summary)));
  ok("회사 할 일은 회사 캘린더로 간다", work.length === 1 && work[0].summary === "출고 확인",
     JSON.stringify(work.map(e => e.summary)));
  ok("개인 캘린더에 회사 것이 섞이지 않는다", !mine.some(e => e.summary === "출고 확인"));
  ok("두 캘린더를 다 훑는다",
     onCal(MINE_CAL, "GET").length === 1 && onCal(TEAM_CAL, "GET").length === 1);
  ok("엉뚱하게 남아 있던 일정은 그 캘린더에서 지운다",
     onCal(MINE_CAL, "DELETE").some(c => c.url.endsWith("todocccc3333")));

  // 완료하면 어느 캘린더에 있었는지 모르므로 둘 다 훑어야 한다
  seen = [];
  await worker.fetch(new Request("https://w.dev/api/done", {
    method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint("sj@x.com"), "content-type": "application/json" },
    body: JSON.stringify({ args: ["todo-gone"] }),
  }), calEnv).then(r => r.json());
  await new Promise(r => setTimeout(r, 80));
  ok("완료하면 두 캘린더 모두에서 지운다",
     onCal(MINE_CAL, "DELETE").length === 1 && onCal(TEAM_CAL, "DELETE").length === 1);

  globalThis.fetch = prevFetch;
}

console.log("── 화면을 열 때 같이 맞추기 (시계를 못 믿을 때의 길)");
{
  const pem = "-----BEGIN PRIVATE KEY-----\n" +
    privateKey.export({ type: "pkcs8", format: "der" }).toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END PRIVATE KEY-----\n";
  const calEnv = { ...env, CALENDAR: JSON.stringify({
    provider: "google", client_email: "bot@x.iam.gserviceaccount.com", private_key: pem,
    calendar_id: "cal123@group.calendar.google.com", owner: "성준" }) };

  let seen = [];
  const prevFetch = globalThis.fetch;
  const jsonRes = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u);
    seen.push({ url: s, method: init.method || "GET" });
    if (s.includes("oauth2.googleapis.com/token")) return jsonRes({ access_token: "tok", expires_in: 3600 });
    if (s.includes("googleapis.com/calendar")) return jsonRes({ items: [] });
    if (s.includes("/query")) return jsonRes({ results: [], has_more: false });
    return prevFetch(u, init);
  };
  // 앞의 시험들이 이미 한 번 맞춰 놓아서, 같은 모듈로는 "10분에 한 번"에
  // 걸린다. 갓 깨어난 워커를 보려고 모듈을 새로 하나 읽는다.
  const fresh = (await import("../index.js?fresh")).default;
  const hit = async () => {
    seen = [];
    await fresh.fetch(new Request("https://w.dev/api/data", {
      method: "POST", headers: { "Cf-Access-Jwt-Assertion": mint("sj@x.com"), "content-type": "application/json" },
      body: JSON.stringify({ args: [] }),
    }), calEnv).then(r => r.json());
    await new Promise(r => setTimeout(r, 60));
    return seen.some(c => c.url.includes("googleapis.com/calendar"));
  };

  ok("화면을 열면 캘린더도 같이 맞춘다", await hit());
  ok("바로 다시 열어도 또 맞추지는 않는다(10분에 한 번)", !(await hit()));

  globalThis.fetch = prevFetch;
}

console.log(fails ? `\n${fails}건 실패` : "\n전부 통과");
process.exit(fails ? 1 : 0);
