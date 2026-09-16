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

import { syncTodo } from "./connectors/calendar.js";
import { buildIcs } from "./feed.js";

const PERSONAL = [
  ["업무", "0e928040351d4fdfae49f77e67e914e6"],
  ["개인", "1730d225784340f88e15f9af9d51ea78"],
];
// 구글 캘린더에 구독시키는 .ics로 나가는 DB. 개인 것 하나뿐이다 — worker/feed.js 참고.
const FEED_DB = PERSONAL[1][1];
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

/* 팀 이름을 바꿔도 Cloudflare는 발급자를 옛 이름으로 계속 쓴다. 그래서 받아들일
   발급자를 따로 적어 둔다(ACCESS_ISSUERS). 비워 두면 팀 도메인 하나만 받는다. */
function allowedIssuers(env) {
  const domains = [env.ACCESS_DOMAIN, ...String(env.ACCESS_ISSUERS || "").split(",")];
  return domains.map((d) => String(d || "").trim()).filter(Boolean).map((d) => `https://${d}`);
}

/* Access가 붙여 보낸 JWT를 검증한다. 서명·만료·발급자·대상까지 전부 본다.
   하나라도 어긋나면 던진다 — 통과하지 못한 요청은 노션 근처에도 못 간다. */
async function verifyAccessJwt(jwt, domain, aud, issuers) {
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
  // 어긋났을 때 실제 값을 같이 알려 준다. 안 그러면 뭘 적어야 할지 알 수가 없다.
  if (!issuers.includes(payload.iss)) throw new Error(`발급자가 다르다 (${payload.iss})`);
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
  // 사람이 아니라 프로그램(팀원의 Claude)이 붙을 때 쓰는 서비스 토큰.
  // 토큰 하나가 사람 하나를 가리키므로 신원 판정은 이메일일 때와 똑같다.
  const byToken = {};
  for (const [clientId, name] of Object.entries(cfg.tokens || {})) {
    byToken[String(clientId).trim().toLowerCase()] = String(name).trim();
  }
  const admins = (cfg.admins || []).map((e) => String(e).trim().toLowerCase());
  if (!Object.keys(byEmail).length) {
    throw new IdentityError("팀에 등록된 사람이 없다", "TEAM 시크릿의 members를 채운다.");
  }
  return { byEmail, byToken, admins };
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
    payload = await verifyAccessJwt(jwt, env.ACCESS_DOMAIN, env.ACCESS_AUD, allowedIssuers(env));
  } catch (e) {
    throw new IdentityError("로그인을 확인하지 못했다", String(e.message || e));
  }

  // 사람이면 email, 서비스 토큰이면 common_name이 온다. 둘 중 있는 쪽을 쓴다.
  const email = String(payload.email || "").trim().toLowerCase();
  const token = String(payload.common_name || "").trim().toLowerCase();
  const who = email || token;
  const name = email ? team.byEmail[email] : team.byToken[token];
  if (!name) {
    throw new IdentityError(
      "등록되지 않은 사용자다",
      email
        ? `${email} 을 TEAM 시크릿의 members에 추가한다.`
        : `${token || "(신원 없음)"} 을 TEAM 시크릿의 tokens에 추가한다.`
    );
  }
  const admin = team.admins.includes(who);
  // 팀이 서로의 할 일을 보기로 했다. 그래서 사람 목록은 전원이 받는다.
  // 고치는 것은 여전히 자기 것만이다 — assertOwned가 막는다.
  const people = [...new Set(Object.values(team.byEmail))];
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

/* 화면이 말이 안 되는 값을 보냈을 때. 노션까지 가져가 봐야 404/400을 받고
   "노션에 연결하지 못했다"가 뜰 뿐이라, 여기서 끊고 진짜 이유를 말한다. */
function badInput(message, hint) {
  const e = new Error(message);
  e.bad = [message, hint || ""];
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
const LOG_DAYS = 7;          // 인자 없이 부를 때(= MCP의 list_done) 거슬러 보는 날 수
const LOG_MAX_PAGES = 12;    // 한 DB에서 넘길 페이지 한도. 100줄씩이니 1200줄에서 멈춘다

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

/* 오늘부터 며칠 전. days가 0이면 빈 문자열 — 자르지 않는다는 뜻이다. */
function sinceISO(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(Date.now() - (n - 1) * 86400000).toISOString().slice(0, 10);
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

/* 거르는 조건은 화면이 아니라 노션 질의에 건다. 남의 줄은 워커 메모리에도
   올라오지 않는다. */
function allOf(conditions) {
  const list = conditions.filter(Boolean);
  return list.length === 1 ? list[0] : { and: list };
}

function ownerCond(owner) {
  return owner ? { property: "담당자", select: { equals: owner } } : null;
}

async function fetchRows(token, dbId, owner) {
  const payload = {
    filter: allOf([{ property: "완료", checkbox: { equals: false } }, ownerCond(owner)]),
    page_size: 100,
  };
  const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
  return r.results;
}

/* 완료일로 거르지 않고 정렬만 시킨 뒤 여기서 자른다. 완료일이 비어 있는
   줄(노션에서 체크만 하고 버튼을 안 눌렀을 때)이 필터에 걸리면 통째로
   사라지기 때문이다. 대신 기간 밖으로 넘어가면 더 넘기지 않는다 —
   기록이 몇 년 쌓여도 불러오는 양은 보는 기간에 비례한다. */
async function fetchDoneRows(token, dbId, owner, since) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < LOG_MAX_PAGES; page++) {
    const payload = {
      filter: allOf([{ property: "완료", checkbox: { equals: true } }, ownerCond(owner)]),
      sorts: [{ property: "완료일", direction: "descending" }],
      page_size: 100,
    };
    if (cursor) payload.start_cursor = cursor;
    const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
    rows.push(...r.results);
    if (!r.has_more || !r.next_cursor) break;
    const last = r.results[r.results.length - 1];
    const lastDone = (last?.properties?.["완료일"]?.date?.start || "").slice(0, 10);
    // 완료일이 빈 줄은 내림차순 맨 뒤다. 거기까지 왔으면 더 볼 것이 없다.
    if (!lastDone) break;
    if (since && lastDone < since) break;
    cursor = r.next_cursor;
  }
  return rows;
}

/* 누구 것만 볼지. 아무 말이 없거나 "all"이면 조건을 걸지 않는다 —
   팀이 서로의 할 일을 보기로 했기 때문이다. 이름을 주면 그 사람 것만 본다. */
function ownerLimit(who, dbId, want) {
  if (!who.team || dbId !== TEAM_DB) return null;
  const name = String(want || "").trim();
  return name && name !== "all" ? name : null;
}

async function loadItems(token, who, owner) {
  const items = [];
  for (const [tag, dbId] of sourcesFor(who)) {
    await ensureOptions(token, dbId);
    const rows = await fetchRows(token, dbId, ownerLimit(who, dbId, owner));
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

async function loadDone(token, who, owner, days) {
  // days를 안 주면 예전처럼 일주일이다. 화면(기록 탭)은 90/180/365/0을 준다.
  const cutoff = sinceISO(days === undefined || days === null || days === "" ? LOG_DAYS : days);
  const rows = [];
  for (const [tag, dbId] of sourcesFor(who)) {
    const raw = await fetchDoneRows(token, dbId, ownerLimit(who, dbId, owner), cutoff);
    for (const r of raw) {
      const item = parseDone(r, tag, who.name);
      if (item.done && (!cutoff || item.done >= cutoff)) rows.push(item);
    }
  }
  rows.sort((a, b) => (a.done < b.done ? 1 : a.done > b.done ? -1 : 0));
  return rows;
}

async function snapshot(token, who, owner) {
  const sources = sourcesFor(who);
  const items = await loadItems(token, who, owner);
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

async function complete(env, token, pageId) {
  await patch(token, pageId, {
    완료: { checkbox: true },
    완료일: { date: { start: todayISO() } },
    "오늘의 3": { checkbox: false },
  });
  syncTodo(env, "remove", { pageId });
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

async function setDue(env, token, pageId, due) {
  const d = String(due || "").trim();
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw badInput("날짜를 알아보지 못했다", "YYYY-MM-DD 형식이어야 합니다.");
  }
  await patch(token, pageId, { 마감일: d ? { date: { start: d } } : { date: null } });
  syncTodo(env, d ? "upsert" : "remove", { pageId, due: d });
}

async function setMemo(token, pageId, text) {
  text = (text || "").trim();
  const rich = text ? [{ text: { content: text.slice(0, 2000) } }] : [];
  await patch(token, pageId, { 메모: { rich_text: rich } });
}

async function createItem(env, token, who, tag, title, due, quadrant) {
  const dbId = dbFor(who, tag);
  const properties = {
    "할 일": { title: [{ text: { content: title.slice(0, 2000) } }] },
    완료: { checkbox: false },
  };
  if (due) properties["마감일"] = { date: { start: due } };
  if (quadrant) properties["우선순위"] = { select: { name: quadrant } };
  // 담당자는 화면이 보낸 값이 아니라 로그인한 사람으로 정한다.
  if (dbId === TEAM_DB && who.name) properties["담당자"] = { select: { name: who.name } };
  const made = await notionCall(
    token,
    "https://api.notion.com/v1/pages",
    { parent: { database_id: dbId }, properties },
    "POST"
  );
  if (due) syncTodo(env, "upsert", { pageId: made.id, title, due, owner: who.name });
}

async function trash(env, token, pageId) {
  // 완전 삭제가 아니라 노션 휴지통으로 보낸다.
  await notionCall(token, `https://api.notion.com/v1/pages/${pageId}`, { archived: true }, "PATCH");
  syncTodo(env, "remove", { pageId });
}

/* 구글 캘린더가 읽어 가는 문.
   **Access 밖이다** — 구글 서버는 로그인을 못 한다. 문을 지키는 것은 주소에
   박힌 난수뿐이라, 여기서는 세 가지를 지킨다:
   1. ICS_TOKEN 시크릿이 없으면 아예 없는 길이다 (404)
   2. 토큰이 틀려도 404다. 403을 주면 "주소는 맞다"를 알려 주는 셈이다
   3. 나가는 것은 개인 DB의 미완료 항목뿐이다. 팀 DB는 이 문으로 안 나간다 */
async function serveFeed(env, url) {
  const secret = env.ICS_TOKEN;
  const gone = () => new Response("Not Found", { status: 404 });
  if (!secret) return gone();

  const given = url.pathname.slice("/feed/".length).replace(/\.ics$/, "");
  if (given.length !== secret.length || given !== secret) return gone();
  if (!env.NOTION_TOKEN) return new Response("토큰이 없다", { status: 500 });

  const rows = await fetchRows(env.NOTION_TOKEN, FEED_DB, null);
  const items = rows.map((r) => parseRow(r, "개인", ""));
  const body = buildIcs(items, { name: "개인 할 일 (Ulick)" });
  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "private, max-age=600",
      // 이 주소가 검색에 잡히는 일은 없어야 한다
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function describe(err) {
  if (err.denied) return ["내 항목이 아니다", "새로고침하면 지금 볼 수 있는 것만 다시 불러옵니다."];
  if (err.bad) return err.bad;
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

/* 핸들러는 (env, who, args)를 받는다. env가 필요한 것은 노션 토큰과,
   캘린더 커넥터(worker/connectors/calendar.js)뿐이다. */
const HANDLERS = {
  data: (env, token, who, [owner]) => guarded(token, () => snapshot(token, who, owner)),
  log: (env, token, who, [owner, days]) => guarded(token, () => loadDone(token, who, owner, days)),
  done: (env, token, who, [pageId]) => owned(token, who, pageId, () => complete(env, token, pageId)),
  undo: (env, token, who, [pageId]) => owned(token, who, pageId, () => uncomplete(token, pageId)),
  setpri: (env, token, who, [pageId, num, tag]) =>
    owned(token, who, pageId, () => {
      const n = Number(num);
      const name = QUADRANT_NUMS.includes(n) ? optionName(dbFor(who, tag), n) : null;
      return setPriority(token, pageId, name);
    }),
  star: (env, token, who, [pageId, on]) => owned(token, who, pageId, () => setTodayFlag(token, pageId, !!on)),
  waiting: (env, token, who, [pageId, on]) => owned(token, who, pageId, () => setWaiting(token, pageId, !!on)),
  setmemo: (env, token, who, [pageId, text]) => owned(token, who, pageId, () => setMemo(token, pageId, text)),
  setdue: (env, token, who, [pageId, due]) => owned(token, who, pageId, () => setDue(env, token, pageId, due)),
  add: async (env, token, who, [title, tag, due, quadrant]) => {
    title = (title || "").trim();
    if (!title) return { ok: false, error: "할 일을 적어주세요", hint: "" };
    const sources = sourcesFor(who);
    if (!sources.some(([t]) => t === tag)) tag = sources[0][0];
    const num = Number(quadrant);
    const name = QUADRANT_NUMS.includes(num) ? optionName(dbFor(who, tag), num) : null;
    return guarded(token, () =>
      createItem(env, token, who, tag, title, (due || "").trim() || null, name));
  },
  remove: (env, token, who, [pageId]) => owned(token, who, pageId, () => trash(env, token, pageId)),
};

/* ── MCP 창구 ──────────────────────────
   팀원이 자기 Claude에서 말로 할 일을 넣고 볼 수 있게 여는 문이다.
   노션을 직접 열어주는 대신 이 문만 열어 준다 — 신원 확인과 거르기가
   전부 위쪽 코드를 그대로 지나가므로, 여기서도 자기 것만 오간다.

   전송은 Streamable HTTP. 상태를 두지 않고 요청 하나에 답 하나로 끝낸다. */

const MCP_PROTOCOL = "2025-06-18";

const MCP_INSTRUCTIONS = `이 사람의 할 일을 4사분면(중요 × 시급)으로 관리한다.
이 도구 모음의 이름은 **Ulick To-do**다. 사람에게 말할 때는 이 이름을 쓴다.

사분면 판단은 앞 숫자로 한다:
1 지금 당장 (중요+시급)  — 오늘 안 하면 터지는 일
2 핵심 업무 (중요+안시급) — 안 하면 나중에 1번이 되는 일
3 빠르게 쳐낼 (안중요+시급) — 잡무
4 언젠가 (안중요+안시급)   — 지금은 아닌데 버리기 아까운 것

할 일을 적을 때:
- 동사형으로, 무엇을 끝내면 되는지 알 수 있게 쓴다
  ("3PL 검토" 대신 "3PL 견적서 3곳 비교표 1장 만들기")
- 기한이 말에 있으면 제목 앞에 남기고 마감일에도 넣는다
- 결과물이 무엇인지 분명하지 않으면 memo에 "결과물: ..."로 적는다
- 한 문장에 일이 여럿이면 쪼개서 각각 넣는다
- 남의 회신을 기다리는 일은 set_waiting으로 표시한다
- 오늘 반드시 끝낼 것은 set_today로 고정한다. 최대 3개다

고치거나 완료 처리하려면 먼저 list_todos로 id를 확인한다.

팀원끼리 서로의 할 일을 볼 수 있다(owner로 지정). 다만 고치고 완료 처리하는 것은
자기 것만 된다. 남의 항목을 손대려 하면 거부된다 — 그게 정상이고, 그 사람에게
말해서 직접 하게 한다.

## 먼저 권하기

다른 일을 하는 중에도, 이 사람이 **지금 안 하고 나중으로 미룬 일**이 나오면 그 턴
끝에 한 줄로 묻는다. 도구 이름이 아니라 **"Ulick To-do"** 라고 부른다:

  Ulick To-do에 넣어둘까요? — <동사형 제목>

이럴 때만 묻는다:
- "나중에", "다음에", "일단 넘어가자", "이건 따로" 처럼 **미루겠다고 말한** 경우
- 고쳐야 할 것을 찾았는데 **지금 범위 밖이라 안 건드리기로** 한 경우
- 남에게 물어보거나 받아야 끝나는 일이 생긴 경우 (이건 대기중으로 넣는다)
- 이 사람이 누군가에게 하겠다고 **약속한** 일

이럴 때는 묻지 않는다:
- 지금 이 자리에서 끝낸 일. 이미 했으면 할 일이 아니다
- 방금 한 작업을 잘게 쪼갠 것. 한 덩어리로 끝났으면 그냥 끝난 것이다
- 한 번 물어서 거절당한 건. 같은 세션에서 다시 꺼내지 않는다
- 한 턴에 두 개 넘게. 많으면 묶어서 하나로 묻는다

거절하면 그걸로 끝이다. 설득하지 않는다. 받아들이면 add_todo로 넣고 한 줄로 알린다.
묻는 것이 본래 하던 일을 끊으면 안 된다 — 하던 답을 다 하고 맨 끝에 덧붙인다.`;

const MCP_TOOLS = [
  {
    name: "list_todos",
    description:
      "할 일(아직 안 끝낸 것)을 사분면별로 모아 본다. 기본은 내 것이고, owner에 동료 이름이나 \"all\"을 주면 그쪽도 볼 수 있다. 고치기 전에 id를 얻는 용도로도 쓴다.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "동료 이름, 또는 전원을 보려면 \"all\". 비우면 내 것" },
      },
    },
  },
  {
    name: "list_done",
    description: "최근 일주일 동안 끝낸 일을 본다. 기본은 내 것이고, owner로 동료나 \"all\"을 볼 수 있다.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "동료 이름, 또는 전원을 보려면 \"all\". 비우면 내 것" },
      },
    },
  },
  {
    name: "add_todo",
    description: "할 일을 새로 넣는다. 담당자는 로그인한 본인으로 자동으로 정해진다.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "할 일. 동사형으로, 기한이 있으면 앞에 남긴다" },
        quadrant: { type: "integer", description: "사분면 1~4. 모르면 비운다", minimum: 1, maximum: 4 },
        due: { type: "string", description: "마감일 YYYY-MM-DD" },
        memo: { type: "string", description: "결과물 정의나 비고" },
        source: { type: "string", description: "넣을 곳. 고를 수 있을 때만 쓴다" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_todo",
    description: "할 일을 완료 처리한다. 완료일도 같이 기록된다.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "uncomplete_todo",
    description: "완료 처리를 되돌린다.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "set_priority",
    description: "할 일을 다른 사분면으로 옮긴다.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, quadrant: { type: "integer", minimum: 1, maximum: 4 } },
      required: ["id", "quadrant"],
    },
  },
  {
    name: "set_memo",
    description: "메모(비고)를 쓰거나 고친다. 빈 문자열을 주면 지운다.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, memo: { type: "string" } },
      required: ["id", "memo"],
    },
  },
  {
    name: "set_today",
    description: "오늘 반드시 끝낼 것으로 고정하거나 푼다. 최대 3개까지가 원칙이다.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, on: { type: "boolean" } },
      required: ["id", "on"],
    },
  },
  {
    name: "set_waiting",
    description: "남의 회신을 기다리는 중으로 표시하거나 푼다.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, on: { type: "boolean" } },
      required: ["id", "on"],
    },
  },
  {
    name: "set_due",
    description: "마감일을 옮기거나 지운다. 빈 문자열을 주면 날짜를 지운다.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        due: { type: "string", description: "YYYY-MM-DD. 비우면 날짜 없음" },
      },
      required: ["id", "due"],
    },
  },
  {
    name: "remove_todo",
    description: "할 일을 지운다(노션 휴지통으로 보낸다). 완료가 아니라 아예 없애는 경우에만 쓴다.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

/* 하루의 시작과 끝. MCP 프롬프트로 실어 보내면 Claude Code의 / 메뉴에 슬래시
   명령으로 뜬다 — 팀원이 따로 설치할 것이 없다. */
const MCP_PROMPTS = [
  {
    name: "morning",
    title: "아침 정리",
    description: "남은 할 일을 훑고 오늘 끝낼 3개를 고른다. 하루 시작할 때.",
    arguments: [],
    text: `지금부터 아침 정리를 한다. 순서대로 한다.

1. list_todos로 남은 할 일을 불러온다.
2. **마감이 지난 것**이 있으면 맨 먼저 짚는다. 오늘 할지, 날짜를 옮길지, 접을지 묻는다.
3. **오늘 끝낼 3개**를 고르게 한다. \`1 지금 당장\`에서 먼저 고르고,
   \`2 핵심 업무\`에서 **최소 하나**는 넣는다. 3개를 넘기지 않는다.
   정해지면 set_today로 켠다.
4. 사분면이 없는 항목이 있으면 "미분류 N건, 지금 나눌까요" 하고 묻는다.
   하겠다고 하면 하나씩 제안하고 set_priority로 넣는다.
5. \`대기중\`인 것 중 오래된 게 있으면 "이건 다시 찔러볼 때 아닌가요" 하고 짚는다.
6. 마지막에 **한 줄로 오늘 배치를 제안한다.** 오전에는 머리 쓰는 일(1·2번),
   오후에는 잡무(3번)를 몰아서.

\`2 핵심 업무\`가 오늘의 3에 하나도 없으면 그냥 넘어가지 말고 한 번 짚는다.
그날은 잡무로만 끝난다.

길게 늘어놓지 않는다. 짧게 묻고 빠르게 정한다.`,
  },
  {
    name: "evening",
    title: "퇴근 정리",
    description: "오늘 한 일을 정리하고 내일로 넘길 것을 추린다. 하루 끝낼 때.",
    arguments: [],
    text: `지금부터 퇴근 정리를 한다. 순서대로 한다.

1. list_done으로 오늘 끝낸 것을 확인하고 짧게 읊어준다. 한 줄 칭찬은 해도 좋지만
   과하게 하지 않는다.
2. list_todos로 남은 것을 본다. **오늘의 3 중 못 끝낸 것**을 먼저 짚는다.
   - 오늘 늦게라도 할 것인지, 내일로 넘길 것인지 묻는다
   - 내일로 넘기면 set_today를 꺼서 고정을 푼다
3. **오늘 새로 생긴 일**이 있는지 묻는다. 회의에서 받은 것, 누가 부탁한 것,
   하다가 발견한 것. 있으면 정리해서 add_todo로 넣는다.
4. 남 회신을 기다리는 게 생겼으면 set_waiting으로 표시한다.
5. 마지막에 **내일 아침 첫 번째로 할 일 하나**를 짚어준다. 그거 하나만 정해두면
   내일 아침이 편하다.

오늘 아무것도 못 끝냈어도 나무라지 않는다. 뭐가 막았는지 한 번 묻고,
그게 할 일로 만들 만한 것이면 넣는다.`,
  },
  {
    name: "weekly",
    title: "주간 보고",
    description: "이번 주 한 일, 진행 중, 막힌 것을 본부장 보고용 초안으로 정리한다. 금요일에.",
    arguments: [],
    text: `지금부터 주간 보고 초안을 만든다. 이건 팀장이 본부장에게 올리는 문서다.
할 일 목록을 그대로 옮기는 것이 아니라, 읽는 사람이 알고 싶은 것으로 바꾼다.

1. list_done에 owner "all"을 주고 이번 주에 끝낸 것을 가져온다.
2. list_todos에 owner "all"을 주고 남은 것을 가져온다.
3. 아래 네 덩어리로 정리한다.

**끝낸 것** — 이번 주 완료. 담당자별로 묶는다. 잡무는 "정산·회신 등 잡무 N건"처럼
한 줄로 합친다. 개별로 적는 것은 의미 있는 것만.

**진행 중** — 1·2사분면의 미완료. 무엇을 언제까지 끝낼 건지가 보이게 쓴다.
3·4사분면은 보고에 넣지 않는다.

**막힌 것** — 대기중이 켜진 것, 마감일이 지난 것. **여기가 보고의 핵심이다.**
누구의 회신을 기다리는지, 무엇 때문에 멈췄는지 쓴다. 본부장이 풀어줄 수 있는 것이면
그렇게 보이게 쓴다. 없으면 "없음"이라고 쓴다.

**다음 주** — 다음 주 마감인 것, 이번 주에 못 끝내고 넘어가는 것.

규칙:
- 사분면 이름, "오늘의 3" 같은 내부 용어를 쓰지 않는다. 본부장은 이 도구를 모른다
- 40줄을 나열하지 않는다. 묶고 줄인다. 네 덩어리 합쳐 20줄을 넘기지 않는다
- 숫자로 포장하지 않는다. "12건 완료"보다 무엇이 끝났는지가 중요하다
- 이모지를 쓰지 않는다
- 그대로 붙여넣을 수 있게 완성된 문서로 낸다

마지막에 한 줄 덧붙인다: 이 초안에서 **빼야 할 것이 있는지** 묻는다. 팀원의 개인
사정이나 아직 위로 올리기 이른 것이 섞였을 수 있다. 무엇을 내보낼지는 팀장이 정한다.`,
  },
];

function formatItems(data) {
  const { items, quads, today } = data;
  if (!items.length) return "남은 할 일이 없다.";
  const lines = [`오늘 ${today}. 남은 할 일 ${items.length}건.`];
  const label = (n) => {
    const q = quads.find((x) => x.n === n);
    return q ? `${n} ${q.name} (${q.axis})` : `${n}`;
  };
  for (const n of [1, 2, 3, 4, null]) {
    const cell = items.filter((i) => i.q === n);
    if (!cell.length) continue;
    lines.push("", n ? `[${label(n)}]` : "[미분류]");
    for (const i of cell) {
      const bits = [];
      if (i.today) bits.push("오늘의3");
      if (i.wait) bits.push("대기중");
      if (i.due) bits.push(`마감 ${i.due}`);
      if (i.owner) bits.push(i.owner);
      lines.push(`- ${i.title}${bits.length ? `  (${bits.join(", ")})` : ""}`);
      if (i.memo) lines.push(`    메모: ${i.memo}`);
      lines.push(`    id: ${i.id}`);
    }
  }
  return lines.join("\n");
}

function formatDone(rows) {
  if (!rows.length) return "최근 일주일 동안 끝낸 일이 없다.";
  return rows.map((r) => `- ${r.done}  ${r.title}${r.owner ? `  (${r.owner})` : ""}`).join("\n");
}

/* 도구 하나하나를 새로 짜지 않는다. 화면이 쓰는 것과 똑같은 핸들러를 부른다 —
   그래야 웹에서 한 일과 Claude로 한 일이 어긋나지 않는다. */
async function runTool(env, who, name, args) {
  const token = env.NOTION_TOKEN;
  const call = (handler, list) => HANDLERS[handler](env, token, who, list);
  const id = String(args.id || "");

  switch (name) {
    // 말로 물을 때는 보통 자기 것을 묻는다. 동료 것은 owner를 줘야 본다.
    case "list_todos": {
      const r = await call("data", [args.owner || who.name]);
      return r.ok ? formatItems(r.data) : r;
    }
    case "list_done": {
      const r = await call("log", [args.owner || who.name]);
      return r.ok ? formatDone(r.data) : r;
    }
    case "add_todo": {
      const tag = args.source || sourcesFor(who)[0][0];
      const r = await call("add", [args.title, tag, args.due, args.quadrant]);
      if (!r.ok) return r;
      // 메모는 만들면서 같이 넣을 수 없다. 방금 만든 줄을 찾아 붙인다.
      if (args.memo) {
        const back = await call("data", []);
        const made = back.ok && back.data.items.find((i) => i.title === String(args.title).trim());
        if (made) await call("setmemo", [made.id, args.memo]);
      }
      return `넣었다: ${args.title}`;
    }
    case "complete_todo":   return unwrap(await call("done", [id]), "완료 처리했다.");
    case "uncomplete_todo": return unwrap(await call("undo", [id]), "완료를 되돌렸다.");
    case "set_priority":    return unwrap(await call("setpri", [id, args.quadrant, args.source]), `${args.quadrant}번으로 옮겼다.`);
    case "set_memo":        return unwrap(await call("setmemo", [id, args.memo]), "메모를 저장했다.");
    case "set_due":         return unwrap(await call("setdue", [id, args.due]), args.due ? `마감일을 ${args.due}로 옮겼다.` : "마감일을 지웠다.");
    case "set_today":       return unwrap(await call("star", [id, args.on]), args.on ? "오늘의 3에 고정했다." : "고정을 풀었다.");
    case "set_waiting":     return unwrap(await call("waiting", [id, args.on]), args.on ? "대기중으로 표시했다." : "대기중을 풀었다.");
    case "remove_todo":     return unwrap(await call("remove", [id]), "지웠다(노션 휴지통).");
    default:
      return { ok: false, error: `모르는 도구다: ${name}`, hint: "" };
  }
}

function unwrap(result, message) {
  return result.ok ? message : result;
}

const rpc = (id, payload) => Response.json({ jsonrpc: "2.0", id, ...payload });

async function handleMcp(request, env, who) {
  let msg;
  try {
    msg = await request.json();
  } catch (_) {
    return rpc(null, { error: { code: -32700, message: "JSON을 읽지 못했다" } });
  }
  // 알림(응답을 기다리지 않는 메시지)은 받기만 하고 끝낸다.
  if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 });

  switch (msg.method) {
    case "initialize":
      return rpc(msg.id, {
        result: {
          protocolVersion:
            typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : MCP_PROTOCOL,
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: "ulick-todo", version: "1.4.0" },
          instructions: MCP_INSTRUCTIONS,
        },
      });
    case "ping":
      return rpc(msg.id, { result: {} });
    case "tools/list":
      return rpc(msg.id, { result: { tools: MCP_TOOLS } });
    case "prompts/list":
      return rpc(msg.id, {
        result: {
          prompts: MCP_PROMPTS.map(({ name, title, description, arguments: args }) => ({
            name,
            title,
            description,
            arguments: args,
          })),
        },
      });
    case "prompts/get": {
      const found = MCP_PROMPTS.find((p) => p.name === msg.params?.name);
      if (!found) {
        return rpc(msg.id, { error: { code: -32602, message: `모르는 프롬프트다: ${msg.params?.name}` } });
      }
      return rpc(msg.id, {
        result: {
          description: found.description,
          messages: [{ role: "user", content: { type: "text", text: found.text } }],
        },
      });
    }
    case "tools/call": {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};
      if (!MCP_TOOLS.some((t) => t.name === name)) {
        return rpc(msg.id, { error: { code: -32602, message: `모르는 도구다: ${name}` } });
      }
      let out;
      try {
        out = await runTool(env, who, name, args);
      } catch (e) {
        out = { ok: false, error: "처리하지 못했다", hint: String(e.message || e) };
      }
      // 실패는 프로토콜 오류가 아니라 도구 결과로 돌려준다. 그래야 Claude가 읽고 고친다.
      const failed = out && out.ok === false;
      const text = failed ? [out.error, out.hint].filter(Boolean).join(" — ") : String(out);
      return rpc(msg.id, { result: { content: [{ type: "text", text }], isError: !!failed } });
    }
    default:
      return rpc(msg.id, { error: { code: -32601, message: `모르는 요청이다: ${msg.method}` } });
  }
}

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

    // 구글 캘린더가 구독하는 .ics. 로그인 없이 읽히는 유일한 길이므로
    // 신원 확인보다 먼저 받아 끝낸다. 지키는 것은 주소의 난수뿐이다.
    if (url.pathname.startsWith("/feed/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET" } });
      }
      try {
        return await serveFeed(env, url);
      } catch (e) {
        return new Response("일정을 만들지 못했다", { status: 502 });
      }
    }

    // 팀원의 Claude가 붙는 문. 화면과 같은 신원·같은 거르기를 지난다.
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
      }
      let who;
      try {
        who = await identify(request, env);
      } catch (e) {
        if (!(e instanceof IdentityError)) throw e;
        return rpc(null, { error: { code: -32001, message: `${e.message} — ${e.hint}` } });
      }
      return handleMcp(request, env, who);
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
      const result = await handler(env, env.NOTION_TOKEN, who, args);
      return Response.json(result);
    }

    // app.css, app.js, adapter-web.js 같은 정적 파일
    return env.ASSETS.fetch(request);
  },
};
