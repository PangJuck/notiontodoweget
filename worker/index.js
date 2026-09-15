/* 할 일 위젯의 웹판. 토큰을 쥐고 노션과 이야기하는 유일한 곳이다.
 *
 * 화면 코드(ui/app.css, ui/body.html, ui/app.js)는 위젯과 완전히 같은 파일을
 * 그대로 쓴다. 다른 것은 딱 하나, 이 파일이 ui/adapter-web.js를 끼워
 * window.Backend가 pywebview 대신 /api/*를 부르게 만든다는 것뿐이다.
 *
 * 노션 호출 로직(scripts/todo_widget.py)을 그대로 옮겼다. 두 언어라
 * 자동으로 맞물리진 않으니, 한쪽을 고치면 (특히 노션 속성 이름이나
 * 4사분면 판정 규칙) 다른 쪽도 같이 고쳐야 한다.
 *
 * 이 워커 자체에는 로그인 화면이 없다. 문을 지키는 것은 Cloudflare
 * Access(Zero Trust)다 — worker/README.md 참고.
 *
 * 팀 모드(TEAM 시크릿)를 켜면 누가 들어왔는지가 모든 것을 가른다. 신원은
 * Access가 서명해 보낸 토큰에서만 꺼낸다. 브라우저가 보낸 값은 헤더든 본문이든
 * 하나도 믿지 않는다. 거르는 일도 전부 여기서 한다 — 남의 항목은 애초에 이
 * 파일 밖으로 나가지 않는다.
 */

const PERSONAL = [
  ["업무", "0e928040351d4fdfae49f77e67e914e6"],
  ["개인", "1730d225784340f88e15f9af9d51ea78"],
];
// 팀 전용 DB. 팀원에게 노션 자체는 공유하지 않는다 — 워커만 Integration으로 읽는다.
const TEAM_DB = "6f9008aa63f249109b6ed29a374b529d";

/* ── 신원 ──────────────────────────────
   TEAM 시크릿이 없으면 지금까지와 똑같이 동작한다(성준 혼자, 업무+개인).
   있으면 팀 모드로 바뀌고, 그때부터는 Access가 서명한 토큰이 유일한 신원
   근거가 된다. 형식은:

     {"admins":["나@회사.com"],
      "members":{"나@회사.com":"성준","가영@회사.com":"가영", ...}}
*/

class IdentityError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint || "";
  }
}

let accessKeys = null; // 워커가 살아 있는 동안만 캐시한다

function b64urlBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(str)));
}

async function fetchAccessKeys(domain) {
  if (accessKeys) return accessKeys;
  const res = await fetch(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`인증서를 받지 못했다 (${res.status})`);
  accessKeys = (await res.json()).keys || [];
  return accessKeys;
}

/* Access가 붙여 보낸 JWT를 검증한다. 서명·만료·발급자·대상까지 전부 본다.
   하나라도 어긋나면 던진다 — 통과하지 못한 요청은 노션 근처에도 못 간다. */
async function verifyAccessJwt(jwt, domain, aud) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("토큰 형식이 아니다");
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);

  let jwk = (await fetchAccessKeys(domain)).find((k) => k.kid === header.kid);
  if (!jwk) {
    // 키가 돌아갔을 수 있다. 캐시를 버리고 딱 한 번 다시 받아 본다.
    accessKeys = null;
    jwk = (await fetchAccessKeys(domain)).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("서명 키를 찾지 못했다");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw new Error("서명이 맞지 않다");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= now) throw new Error("만료된 토큰이다");
  if (payload.iss !== `https://${domain}`) throw new Error("발급자가 다르다");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("다른 애플리케이션의 토큰이다");
  return payload;
}

function parseTeam(raw) {
  if (!raw) return null;
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (_) {
    throw new IdentityError("팀 설정을 읽지 못했다", "TEAM 시크릿이 올바른 JSON인지 확인한다.");
  }
  const byEmail = {};
  for (const [email, name] of Object.entries(cfg.members || {})) {
    byEmail[String(email).trim().toLowerCase()] = String(name).trim();
  }
  const admins = (cfg.admins || []).map((e) => String(e).trim().toLowerCase());
  if (!Object.keys(byEmail).length) {
    throw new IdentityError("팀에 등록된 사람이 없다", "TEAM 시크릿의 members를 채운다.");
  }
  return { byEmail, admins };
}

async function identify(request, env) {
  const team = parseTeam(env.TEAM);
  // 솔로 모드 — 팀 기능을 켜기 전의 동작 그대로다.
  if (!team) return { team: false, admin: true, name: null, people: [] };

  if (!env.ACCESS_DOMAIN || !env.ACCESS_AUD) {
    throw new IdentityError(
      "팀 설정이 덜 됐다",
      "wrangler.toml의 ACCESS_DOMAIN과 ACCESS_AUD를 채우고 다시 배포한다."
    );
  }
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) {
    throw new IdentityError(
      "로그인 정보가 없다",
      "이 주소가 Cloudflare Access로 보호되고 있는지 확인한다."
    );
  }
  let payload;
  try {
    payload = await verifyAccessJwt(jwt, env.ACCESS_DOMAIN, env.ACCESS_AUD);
  } catch (e) {
    throw new IdentityError("로그인을 확인하지 못했다", String(e.message || e));
  }

  const email = String(payload.email || "").trim().toLowerCase();
  const name = team.byEmail[email];
  if (!name) {
    throw new IdentityError("등록되지 않은 사용자다", `${email} 을 TEAM 시크릿의 members에 추가한다.`);
  }
  const admin = team.admins.includes(email);
  // 관리자만 사람 목록을 받는다. 팀원에게는 동료 이름조차 내보내지 않는다.
  const people = admin ? [...new Set(Object.values(team.byEmail))] : [];
  return { team: true, admin, name, email, people };
}

/* 이 사람이 볼 수 있는 DB 목록. 여기 없는 DB는 어떤 경로로도 닿지 않는다. */
function sourcesFor(who) {
  if (!who.team) return PERSONAL;
  if (who.admin) return [...PERSONAL, ["팀", TEAM_DB]];
  return [["팀", TEAM_DB]];
}

function dbFor(who, tag) {
  const sources = sourcesFor(who);
  const hit = sources.find(([t]) => t === tag);
  return hit ? hit[1] : sources[0][1];
}

function denied() {
  const e = new Error("내 항목이 아니다");
  e.denied = true;
  return e;
}

/* 고치기 전에 이 페이지가 정말 내 것인지 노션에 직접 물어본다.
   화면이 보내온 id를 그대로 믿으면, 남의 항목 id를 손으로 넣는 것만으로
   남의 할 일을 완료 처리할 수 있다. */
async function assertOwned(token, who, pageId) {
  if (!who.team) return;
  const page = await notionCall(token, `https://api.notion.com/v1/pages/${pageId}`, null, "GET");
  const bare = (id) => String(id || "").replace(/-/g, "");
  const parent = bare(page.parent?.database_id);
  if (!sourcesFor(who).some(([, dbId]) => bare(dbId) === parent)) throw denied();
  if (who.admin) return;
  if ((page.properties?.["담당자"]?.select?.name || "") !== who.name) throw denied();
}

const QUADRANTS = [
  [1, "지금 당장", "중요+시급"],
  [2, "핵심 업무", "중요+안시급"],
  [3, "빠르게 쳐낼", "안중요+시급"],
  [4, "언젠가", "안중요+안시급"],
];
const QUADRANT_NUMS = QUADRANTS.map((q) => q[0]);
const LOG_DAYS = 7;

// {db_id: {1: "1 지금 당장 (중요+시급)", ...}} 워커가 살아 있는 동안만 유지된다.
let optionNames = {};

function quadrantNum(name) {
  const m = /^\s*([1-4])/.exec(name || "");
  return m ? Number(m[1]) : null;
}

function quadrantDefault(num) {
  const q = QUADRANTS.find(([n]) => n === num);
  return q ? [q[1], q[2]] : [String(num), ""];
}

function splitOption(name, num) {
  const [label, axis] = quadrantDefault(num);
  if (!name) return [label, axis];
  const rest = name.replace(/^\s*[1-4][\s.)-]*/, "").trim();
  const m = /^(.*?)\s*[(（]([^)）]*)[)）]\s*$/.exec(rest);
  if (m) return [m[1].trim() || label, m[2].trim() || axis];
  return [rest || label, axis];
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function notionCall(token, url, payload, method) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const err = new Error(`notion ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function loadOptionNames(token, dbId) {
  const schema = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}`, null, "GET");
  const options = schema.properties?.["우선순위"]?.select?.options || [];
  const found = {};
  for (const opt of options) {
    const num = quadrantNum(opt.name);
    if (num && !(num in found)) found[num] = opt.name;
  }
  return found;
}

async function ensureOptions(token, dbId) {
  if (optionNames[dbId]) return;
  try {
    optionNames[dbId] = await loadOptionNames(token, dbId);
  } catch (e) {
    optionNames[dbId] = {};
  }
}

function optionName(dbId, num) {
  const names = optionNames[dbId] || {};
  if (num in names) return names[num];
  if (!QUADRANT_NUMS.includes(num)) return null;
  const [label, axis] = quadrantDefault(num);
  return label ? `${num} ${label} (${axis})` : null;
}

function quadDefs(sources) {
  return QUADRANTS.map(([num]) => {
    let found = null;
    for (const [, dbId] of sources) {
      found = (optionNames[dbId] || {})[num];
      if (found) break;
    }
    const [label, axis] = splitOption(found, num);
    return { n: num, key: `q${num}`, name: label, axis };
  });
}

function plain(prop, key) {
  return ((prop && prop[key]) || []).map((t) => t.plain_text || "").join("");
}

function parseRow(row, tag, fallbackOwner) {
  const p = row.properties || {};
  const raw = p["마감일"]?.date?.start;
  const select = p["우선순위"]?.select || {};
  return {
    id: row.id,
    tag,
    // 업무/개인 DB에는 담당자 속성이 없다. 성준 본인의 것이므로 이름을 채워
    // 넣어, 관리자 화면의 사람 필터가 세 DB에 똑같이 걸리게 한다.
    owner: p["담당자"]?.select?.name || fallbackOwner || "",
    title: plain(p["할 일"], "title") || "(제목 없음)",
    memo: plain(p["메모"], "rich_text"),
    due: raw ? raw.slice(0, 10) : "",
    q: quadrantNum(select.name),
    today: !!p["오늘의 3"]?.checkbox,
    wait: !!p["대기중"]?.checkbox,
  };
}

function parseDone(row, tag, fallbackOwner) {
  const p = row.properties || {};
  const raw = p["완료일"]?.date?.start;
  const select = p["우선순위"]?.select || {};
  return {
    id: row.id,
    tag,
    owner: p["담당자"]?.select?.name || fallbackOwner || "",
    title: plain(p["할 일"], "title") || "(제목 없음)",
    q: quadrantNum(select.name),
    done: raw ? raw.slice(0, 10) : "",
  };
}

/* 담당자 조건은 화면이 아니라 노션 질의에 건다. 남의 줄은 워커 메모리에도
   올라오지 않는다. */
function ownerFilter(base, owner) {
  if (!owner) return base;
  return { and: [base, { property: "담당자", select: { equals: owner } }] };
}

async function fetchRows(token, dbId, owner) {
  const base = { property: "완료", checkbox: { equals: false } };
  const payload = { filter: ownerFilter(base, owner), page_size: 100 };
  const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
  return r.results;
}

async function fetchDoneRows(token, dbId, owner) {
  // 완료일로 거르지 않고 정렬만 시킨 뒤 여기서 자른다.
  // 완료일이 비어 있는 줄이 필터에 걸리면 통째로 사라지기 때문이다.
  const payload = {
    filter: ownerFilter({ property: "완료", checkbox: { equals: true } }, owner),
    sorts: [{ property: "완료일", direction: "descending" }],
    page_size: 100,
  };
  const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
  return r.results;
}

/* 팀 DB에서 걸러낼 담당자. 관리자는 전체를 보므로 조건이 없다. */
function ownerLimit(who, dbId) {
  return who.team && !who.admin && dbId === TEAM_DB ? who.name : null;
}

async function loadItems(token, who) {
  const items = [];
  for (const [tag, dbId] of sourcesFor(who)) {
    await ensureOptions(token, dbId);
    const rows = await fetchRows(token, dbId, ownerLimit(who, dbId));
    items.push(...rows.map((r) => parseRow(r, tag, who.name)));
  }
  // 마감 가까운 순. 날짜 없는 것은 뒤로. (파이썬과 같은 키: !due, due, tag)
  items.sort((a, b) => {
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
  });
  return items;
}

async function loadDone(token, who) {
  const cutoff = new Date(Date.now() - (LOG_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const rows = [];
  for (const [tag, dbId] of sourcesFor(who)) {
    const raw = await fetchDoneRows(token, dbId, ownerLimit(who, dbId));
    for (const r of raw) {
      const item = parseDone(r, tag, who.name);
      if (item.done && item.done >= cutoff) rows.push(item);
    }
  }
  rows.sort((a, b) => (a.done < b.done ? 1 : a.done > b.done ? -1 : 0));
  return rows;
}

async function snapshot(token, who) {
  const sources = sourcesFor(who);
  const items = await loadItems(token, who);
  return {
    today: todayISO(),
    quads: quadDefs(sources),
    sources: sources.map(([t]) => t),
    items,
    me: who.name || "",
    team: who.team,
    admin: who.admin,
    people: who.people, // 관리자만 채워져 온다. 화면의 사람 필터가 이걸로 뜬다
  };
}

async function patch(token, pageId, properties) {
  await notionCall(token, `https://api.notion.com/v1/pages/${pageId}`, { properties }, "PATCH");
}

async function complete(token, pageId) {
  await patch(token, pageId, {
    완료: { checkbox: true },
    완료일: { date: { start: todayISO() } },
    "오늘의 3": { checkbox: false },
  });
}

async function uncomplete(token, pageId) {
  await patch(token, pageId, { 완료: { checkbox: false }, 완료일: { date: null } });
}

async function setPriority(token, pageId, quadrant) {
  const value = quadrant ? { select: { name: quadrant } } : { select: null };
  await patch(token, pageId, { 우선순위: value });
}

async function setTodayFlag(token, pageId, on) {
  await patch(token, pageId, { "오늘의 3": { checkbox: !!on } });
}

async function setWaiting(token, pageId, on) {
  await patch(token, pageId, { 대기중: { checkbox: !!on } });
}

async function setMemo(token, pageId, text) {
  text = (text || "").trim();
  const rich = text ? [{ text: { content: text.slice(0, 2000) } }] : [];
  await patch(token, pageId, { 메모: { rich_text: rich } });
}

async function createItem(token, who, tag, title, due, quadrant) {
  const dbId = dbFor(who, tag);
  const properties = {
    "할 일": { title: [{ text: { content: title.slice(0, 2000) } }] },
    완료: { checkbox: false },
  };
  if (due) properties["마감일"] = { date: { start: due } };
  if (quadrant) properties["우선순위"] = { select: { name: quadrant } };
  // 담당자는 화면이 보낸 값이 아니라 로그인한 사람으로 정한다.
  if (dbId === TEAM_DB && who.name) properties["담당자"] = { select: { name: who.name } };
  await notionCall(
    token,
    "https://api.notion.com/v1/pages",
    { parent: { database_id: dbId }, properties },
    "POST"
  );
}

async function trash(token, pageId) {
  // 완전 삭제가 아니라 노션 휴지통으로 보낸다.
  await notionCall(token, `https://api.notion.com/v1/pages/${pageId}`, { archived: true }, "PATCH");
}

function describe(err) {
  if (err.denied) return ["내 항목이 아니다", "새로고침하면 지금 볼 수 있는 것만 다시 불러옵니다."];
  const status = err.status;
  if (status === 401) return ["토큰이 거부됐다", "워커의 NOTION_TOKEN 시크릿을 다시 확인한다."];
  if (status === 403)
    return ["권한이 없다", "노션 Integration 설정에서 Update content와 Insert content를 켜고 다시 실행한다."];
  if (status === 404)
    return ["DB를 찾지 못했다", "노션 DB 페이지에서 ... > 연결로 Integration을 추가했는지 확인한다."];
  if (status) return [`노션이 ${status}를 반환했다`, "잠시 뒤 새로고침한다."];
  return ["노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다."];
}

async function guarded(token, fn) {
  if (!token) {
    return {
      ok: false,
      error: "토큰이 없다",
      hint: "wrangler secret put NOTION_TOKEN 으로 워커에 토큰을 넣는다.",
    };
  }
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const [error, hint] = describe(e);
    return { ok: false, error, hint };
  }
}

/* 페이지를 건드리는 모든 요청은 소유 확인을 먼저 통과해야 한다.
   읽기(data/log)는 애초에 볼 수 있는 것만 불러오므로 확인할 것이 없다. */
function owned(token, who, pageId, fn) {
  return guarded(token, async () => {
    await assertOwned(token, who, pageId);
    return fn();
  });
}

const HANDLERS = {
  data: (token, who) => guarded(token, () => snapshot(token, who)),
  log: (token, who) => guarded(token, () => loadDone(token, who)),
  done: (token, who, [pageId]) => owned(token, who, pageId, () => complete(token, pageId)),
  undo: (token, who, [pageId]) => owned(token, who, pageId, () => uncomplete(token, pageId)),
  setpri: (token, who, [pageId, num, tag]) =>
    owned(token, who, pageId, () => {
      const n = Number(num);
      const name = QUADRANT_NUMS.includes(n) ? optionName(dbFor(who, tag), n) : null;
      return setPriority(token, pageId, name);
    }),
  star: (token, who, [pageId, on]) => owned(token, who, pageId, () => setTodayFlag(token, pageId, !!on)),
  waiting: (token, who, [pageId, on]) => owned(token, who, pageId, () => setWaiting(token, pageId, !!on)),
  setmemo: (token, who, [pageId, text]) => owned(token, who, pageId, () => setMemo(token, pageId, text)),
  add: async (token, who, [title, tag, due, quadrant]) => {
    title = (title || "").trim();
    if (!title) return { ok: false, error: "할 일을 적어주세요", hint: "" };
    const sources = sourcesFor(who);
    if (!sources.some(([t]) => t === tag)) tag = sources[0][0];
    const num = Number(quadrant);
    const name = QUADRANT_NUMS.includes(num) ? optionName(dbFor(who, tag), num) : null;
    return guarded(token, () => createItem(token, who, tag, title, (due || "").trim() || null, name));
  },
  remove: (token, who, [pageId]) => owned(token, who, pageId, () => trash(token, pageId)),
};

async function readAsset(env, requestUrl, path) {
  const assetUrl = new URL(path, requestUrl);
  const res = await env.ASSETS.fetch(new Request(assetUrl));
  if (!res.ok) throw new Error(`asset ${path} -> ${res.status}`);
  return res.text();
}

async function renderShell(env, requestUrl) {
  const [css, body, adapter, app] = await Promise.all([
    readAsset(env, requestUrl, "/app.css"),
    readAsset(env, requestUrl, "/body.html"),
    readAsset(env, requestUrl, "/adapter-web.js"),
    readAsset(env, requestUrl, "/app.js"),
  ]);
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ulick To-do</title>
<style>
${css}
</style></head><body>

${body}

<script>
${adapter}
</script>
<script>
${app}
</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return renderShell(env, request.url);
    }

    if (url.pathname.startsWith("/api/")) {
      // 누구인지부터 정한다. 여기서 걸러지면 노션은 부르지도 않는다.
      let who;
      try {
        who = await identify(request, env);
      } catch (e) {
        if (!(e instanceof IdentityError)) throw e;
        return Response.json({ ok: false, error: e.message, hint: e.hint });
      }

      if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
      const name = url.pathname.slice("/api/".length);
      const handler = HANDLERS[name];
      if (!handler) return new Response("Not Found", { status: 404 });
      let args = [];
      try {
        const body = await request.json();
        args = body.args || [];
      } catch (_) {
        // 빈 본문(인자 없는 호출)도 허용한다
      }
      const result = await handler(env.NOTION_TOKEN, who, args);
      return Response.json(result);
    }

    // app.css, app.js, adapter-web.js 같은 정적 파일
    return env.ASSETS.fetch(request);
  },
};
