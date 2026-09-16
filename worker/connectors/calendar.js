/* 할 일을 구글 캘린더에 **진짜 일정으로 써넣는다.**
 *
 * .ics 구독(worker/feed.js)과 무엇이 다른가: 구독은 구글이 우리 주소를 읽어
 * 가는 것이라 구글 안에서만 보이고, **구글이 URL로 구독한 캘린더는 모바일
 * 앱으로 안 내려간다.** 아이폰까지 닿으려면 캘린더에 실제 일정이 있어야 하고,
 * 그건 API로 쓰는 수밖에 없다. 둘 다 켜면 같은 할 일이 두 번 보인다.
 *
 * 자격은 **서비스 계정**으로 얻는다. 도메인 전체 위임(남의 자격으로 행세하기)은
 * 쓰지 않는다 — 개인 gmail에서는 되지도 않고, 필요하지도 않다. 대신 사람이
 * 캘린더 하나를 그 서비스 계정 이메일에게 공유해 주면, 서비스 계정이 제
 * 자격으로 거기에 쓴다. 닿는 범위가 그 캘린더 하나로 끝나는 것이 요점이다.
 *
 * 설정은 CALENDAR 시크릿 한 줄:
 *   {"provider":"google",
 *    "client_email":"...@....iam.gserviceaccount.com",
 *    "private_key":"-----BEGIN PRIVATE KEY-----\n...",
 *    "calendar_id":"....@group.calendar.google.com",
 *    "personal_calendar_id":"....@group.calendar.google.com",  // 없으면 위와 한 곳
 *    "owner":"성준"}            // 있으면 팀 DB의 그 사람 항목도 같이 올린다
 *
 * 캘린더를 둘로 나누면 구글에서 개인 쪽만 체크를 꺼 둘 수 있다. 화면을 남에게
 * 보여줄 때 개인 할 일이 같이 뜨지 않는다 — 나누는 이유는 그것 하나다.
 *
 * 없으면 아무 일도 하지 않는다. 자세한 것은 docs/구글-캘린더-연동-계획.md.
 *
 * 물러서지 말아야 할 두 가지:
 * 1. **할 일이 먼저다.** 캘린더가 실패해도 노션 기록은 그대로 끝나야 한다.
 *    그래서 index.js는 syncTodo를 await 하지 않고, 이 파일이 스스로 삼킨다.
 *    캘린더가 안 맞는 것은 불편이고, 할 일이 안 들어가는 것은 고장이다.
 * 2. **나가는 것은 성준 것뿐이다.** 팀원 항목이 성준 캘린더로 새면 안 된다 —
 *    올릴지 말지, 어느 캘린더로 갈지는 아래 target()이 노션에 직접 물어 정한다.
 */

import { PERSONAL_DB, TEAM_DB } from "../dbs.js";

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const bare = (id) => String(id || "").replace(/-/g, "");

export function getCalendar(env) {
  if (!env.CALENDAR) {
    // 조용히 끝내면 "설정을 안 읽은 것"과 "읽고 할 일이 없던 것"을 구분할 수 없다.
    console.log("[calendar] CALENDAR 시크릿이 없다. 연동을 끈 채로 간다");
    return null;
  }
  let cfg;
  try {
    cfg = JSON.parse(env.CALENDAR);
  } catch (_) {
    console.log("[calendar] CALENDAR 시크릿이 JSON이 아니다. 연동을 끈 채로 간다");
    return null;
  }
  if (cfg.provider !== "google") {
    console.log(`[calendar] 모르는 provider다: ${cfg.provider}`);
    return null;
  }
  for (const key of ["client_email", "private_key", "calendar_id"]) {
    if (!cfg[key]) {
      console.log(`[calendar] CALENDAR 시크릿에 ${key}가 없다. 연동을 끈 채로 간다`);
      return null;
    }
  }
  return cfg;
}

/* index.js가 부르는 유일한 문. 커넥터가 없으면 아무 일도 안 일어난다.
   일부러 await 하지 않는다 — 캘린더 때문에 할 일 저장이 늦어지면 안 된다. */
export function syncTodo(env, kind, item) {
  const cfg = getCalendar(env);
  if (!cfg) return;
  const done = run(env, cfg, kind, item).catch((e) =>
    console.log(`[calendar] ${kind} 실패: ${e && e.message}`)
  );
  // 워커는 응답을 보내면 남은 일을 끊을 수 있다. 끊지 말라고 알려 준다.
  if (typeof env.waitUntil === "function") env.waitUntil(done);
  return done;
}

async function run(env, cfg, kind, item) {
  const pageId = bare(item.pageId);
  if (!pageId) return;
  if (kind === "remove") return remove(cfg, pageId);

  // 마감일만 바뀌었을 때는 제목이 안 넘어온다. 어차피 올릴 것인지도 노션에
  // 물어야 하니(남의 항목이면 안 올린다), 한 번에 페이지를 읽어 채운다.
  const page = await notionPage(env, item.pageId);
  const got = fromPage(page);
  const calId = target(cfg, got);
  // 안 올리기로 한 경우가 제일 안 보인다. 실패가 아니라 판단이라 에러도 안 나고,
  // 밖에서 보면 그냥 아무 일도 안 일어난 것처럼 보인다. 그래서 이유를 적는다.
  if (!calId) {
    console.log(`[calendar] 안 올림 — 내 것이 아니다 (담당자 "${got.owner}", 설정 owner "${cfg.owner}")`);
    return remove(cfg, pageId); // 남의 것이 되었으면 치운다
  }
  if (!got.due || got.done) {
    console.log(`[calendar] 안 올림 — ${got.done ? "완료된 일" : "마감일이 없다"}: ${got.title}`);
    return remove(cfg, pageId);
  }
  console.log(`[calendar] 올림 — ${got.title} (${got.due})`);
  // 캘린더가 바뀌었을 때(개인 → 팀 등) 옛 캘린더에 남은 것은 여기서 치우지
  // 않는다. 지울 일이 거의 없는데 매번 호출을 하나 더 쓰게 된다 —
  // 아래 reconcile이 다음 차례에 대조해서 치운다.
  const id = eventId(pageId);
  return putEvent(cfg, calId, id, eventBody(id, got));
}

/* 어느 캘린더로 갈 것인가. 안 올릴 것이면 null이다.
   개인 DB는 전부, 팀 DB는 시크릿에 적힌 사람 것만 — owner를 안 적으면
   팀 항목은 하나도 안 올라간다. */
function target(cfg, got) {
  if (got.parent === bare(PERSONAL_DB)) return cfg.personal_calendar_id || cfg.calendar_id;
  if (got.parent === bare(TEAM_DB)) {
    return cfg.owner && got.owner === cfg.owner ? cfg.calendar_id : null;
  }
  return null;
}

/* 우리가 쓰는 캘린더 전부. 하나로 합쳐 쓸 수도 있어 중복을 지운다. */
const calendars = (cfg) => [...new Set([cfg.calendar_id, cfg.personal_calendar_id].filter(Boolean))];

/* ── 노션에서 한 줄 읽기 ────────────────── */
async function notionPage(env, pageId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
  });
  if (!res.ok) throw new Error(`노션이 ${res.status}를 돌려줬다`);
  return res.json();
}

const plain = (prop, key) => ((prop && prop[key]) || []).map((t) => t.plain_text || "").join("");

function fromPage(page) {
  const p = page.properties || {};
  return {
    parent: bare(page.parent?.database_id),
    owner: p["담당자"]?.select?.name || "",
    title: plain(p["할 일"], "title") || "(제목 없음)",
    memo: plain(p["메모"], "rich_text"),
    due: (p["마감일"]?.date?.start || "").slice(0, 10),
    quad: p["우선순위"]?.select?.name || "",
    done: !!p["완료"]?.checkbox,
    url: page.url || "",
  };
}

/* ── 구글 토큰 ──────────────────────────
   서비스 계정 키로 JWT를 만들어 access_token과 바꾼다. 워커가 살아 있는
   동안만 메모리에 들고 있는다(Access 인증서 캐시와 같은 방식). */
let cached = null;

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signingKey(pem) {
  const body = String(pem)
    .replace(/\\n/g, "\n") // 시크릿에 줄바꿈이 escape 된 채로 들어온 경우
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = atob(body);
  const der = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function accessToken(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === cfg.client_email && cached.exp > now + 60) return cached.value;

  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  // sub(남의 자격으로 행세)를 넣지 않는다. 공유받은 캘린더에 제 자격으로 쓴다.
  const body = b64url(
    enc.encode(
      JSON.stringify({
        iss: cfg.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await signingKey(cfg.private_key),
    enc.encode(`${head}.${body}`)
  );
  const jwt = `${head}.${body}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    cached = null;
    throw new Error(`구글이 토큰을 안 줬다 (${res.status}) ${(await res.text()).slice(0, 200)}`);
  }
  const json = await res.json();
  cached = {
    email: cfg.client_email,
    value: json.access_token,
    exp: now + (Number(json.expires_in) || 3600),
  };
  return cached.value;
}

/* ── 일정 쓰기 ──────────────────────────
   일정 id를 노션 page_id에서 만들어 낸다. 그래야 같은 할 일을 두 번 넣지 않고,
   마감일을 옮길 때 새로 만들지 않고 고칠 수 있다(= 매핑을 저장할 곳이 필요 없다).
   구글 id 규칙은 소문자 a–v와 숫자 0–9. page_id는 16진수라 그대로 들어간다.
   앞에 붙인 todo는 **우리가 만든 일정이라는 표식**이기도 하다 — 주기 동기화가
   지울 것을 고를 때 이걸 보고, 사람이 직접 넣은 일정은 건드리지 않는다. */
const MARK = "todo";
const eventId = (pageId) => `${MARK}${pageId}`;
const eventsUrl = (calId) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventBody(id, got) {
  return {
    id,
    summary: got.title,
    description: [got.memo, got.url].filter(Boolean).join("\n\n"),
    // 마감일 하루짜리 종일 일정. ics와 같이 끝 날짜는 포함되지 않으므로 다음 날이다.
    start: { date: got.due },
    end: { date: nextDay(got.due) },
    // 할 일 때문에 하루가 "바쁨"으로 잡히면 남이 회의를 못 잡는다
    transparency: "transparent",
    source: got.url ? { title: "Ulick To-do", url: got.url } : undefined,
  };
}

async function googleCall(cfg, url, method, payload) {
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken(cfg)}`,
      "content-type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

async function putEvent(cfg, calId, id, body) {
  // 있으면 고치고 없으면 만든다. PUT이 먼저인 이유는, 이미 있는 쪽이 훨씬 잦아서다.
  let res = await googleCall(cfg, `${eventsUrl(calId)}/${id}`, "PUT", body);
  if (res.status === 404) {
    res = await googleCall(cfg, eventsUrl(calId), "POST", body);
    // 지웠다 되살리는 경우 구글이 id가 이미 있다고 한다. 그럼 다시 고치기로 간다.
    if (res.status === 409) res = await googleCall(cfg, `${eventsUrl(calId)}/${id}`, "PUT", body);
  }
  if (!res.ok) throw new Error(`구글이 ${res.status}를 돌려줬다 ${(await res.text()).slice(0, 200)}`);
}

async function dropEvent(cfg, calId, id) {
  const res = await googleCall(cfg, `${eventsUrl(calId)}/${id}`, "DELETE");
  // 이미 없으면 그게 바라던 상태다
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new Error(`구글이 ${res.status}를 돌려줬다 ${(await res.text()).slice(0, 200)}`);
}

/* 어느 캘린더에 들어가 있었는지 모를 때가 있다(완료·삭제는 노션을 읽지
   않는다). 그래서 지울 때는 쓰는 캘린더를 다 훑는다. 없으면 없는 대로 끝난다. */
const remove = (cfg, pageId) =>
  Promise.all(calendars(cfg).map((c) => dropEvent(cfg, c, eventId(pageId))));

/* ── 주기 동기화 ────────────────────────
   클로드(MCP)와 위젯은 노션에 **직접** 쓴다. 워커를 지나가지 않으니 그때는
   위의 syncTodo가 불릴 길이 아예 없다. 그래서 워커가 스스로 몇 분에 한 번
   양쪽을 맞춘다(일정은 wrangler.toml의 [triggers], 문은 index.js의 scheduled).

   맞추는 방식이 요점이다. **무엇이 바뀌었는지를 기억해 두지 않는다** — 기억은
   한 번 틀어지면 영영 틀어진 채로 남고, 그 틀어짐은 아무도 모른다. 대신 매번
   양쪽을 통째로 읽어 같게 만든다. 그래서 어디서 넣었든, 지난번이 실패했든,
   두 번 돌든 결과가 같다.

   지우는 것은 표식(todo)이 붙은 일정뿐이다. 같은 캘린더에 사람이 직접 넣은
   일정은 여기서 사라지지 않는다. */
export async function reconcile(env) {
  const cfg = getCalendar(env);
  if (!cfg) return { ok: false, why: "설정 없음" };

  // owner는 비밀이 아니고, 여기가 어긋나면 팀 항목이 한 건도 안 올라간다.
  // 인코딩이 깨져 들어온 적이 있어서 매번 그대로 찍는다.
  console.log(`[calendar] 동기화 시작 · 캘린더 ${calendars(cfg).join(", ")} · owner "${cfg.owner || "(없음)"}"`);

  // 캘린더마다 "있어야 할 모습"을 따로 만든다. 개인과 팀을 다른 캘린더로
  // 나눠 놓으면, 구글에서 개인 쪽만 체크를 꺼 둘 수 있다.
  const want = new Map(calendars(cfg).map((c) => [c, new Map()]));
  const take = async (dbId, owner) => {
    for (const row of await notionRows(env, dbId, owner)) {
      const got = fromPage(row);
      const calId = target(cfg, got);
      if (!calId || !got.due || got.done) continue;
      want.get(calId).set(eventId(bare(row.id)), got);
    }
  };
  await take(PERSONAL_DB, null);
  // owner를 안 적으면 팀 항목은 하나도 올리지 않는다(위 target과 같은 규칙).
  if (cfg.owner) await take(TEAM_DB, cfg.owner);

  let notion = 0;
  let pushed = 0;
  let removed = 0;
  for (const [calId, mine] of want) {
    const have = await listEvents(cfg, calId);
    for (const [id, got] of mine) {
      const body = eventBody(id, got);
      if (unchanged(have.get(id), body)) continue; // 같은 것을 다시 쓰지 않는다
      await putEvent(cfg, calId, id, body);
      pushed++;
    }
    // 캘린더를 나눈 뒤에는 이 자리가 "옛 캘린더에 남은 것"도 같이 치운다.
    for (const id of have.keys()) {
      if (mine.has(id)) continue;
      await dropEvent(cfg, calId, id);
      removed++;
    }
    notion += mine.size;
  }

  console.log(`[calendar] 동기화: 노션 ${notion}건, 올림 ${pushed}, 지움 ${removed}`);
  return { ok: true, notion, pushed, removed };
}

function unchanged(ev, body) {
  if (!ev) return false;
  return (
    (ev.summary || "") === (body.summary || "") &&
    (ev.description || "") === (body.description || "") &&
    ev.start?.date === body.start.date &&
    ev.end?.date === body.end.date
  );
}

/* 미완료 + 마감일 있는 줄만. 담당자를 주면 그 사람 것만.
   필터를 노션 쪽에 거는 이유는, 안 올릴 줄을 여기까지 들고 오지 않기 위해서다. */
async function notionRows(env, dbId, owner) {
  const filter = [
    { property: "완료", checkbox: { equals: false } },
    { property: "마감일", date: { is_not_empty: true } },
  ];
  if (owner) filter.push({ property: "담당자", select: { equals: owner } });

  const rows = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const payload = { filter: { and: filter }, page_size: 100 };
    if (cursor) payload.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`노션이 ${res.status}를 돌려줬다`);
    const json = await res.json();
    rows.push(...(json.results || []));
    if (!json.has_more || !json.next_cursor) break;
    cursor = json.next_cursor;
  }
  return rows;
}

/* 캘린더에 지금 들어 있는 우리 일정. 우리가 만든 것(todo 표식)만 담아 온다. */
async function listEvents(cfg, calId) {
  const out = new Map();
  let token = null;
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({
      maxResults: "2500",
      showDeleted: "false",
      singleEvents: "false",
      fields: "nextPageToken,items(id,summary,description,start,end)",
    });
    if (token) q.set("pageToken", token);
    const res = await googleCall(cfg, `${eventsUrl(calId)}?${q}`, "GET");
    if (!res.ok) throw new Error(`구글이 ${res.status}를 돌려줬다 ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    for (const ev of json.items || []) if (String(ev.id || "").startsWith(MARK)) out.set(ev.id, ev);
    if (!json.nextPageToken) break;
    token = json.nextPageToken;
  }
  return out;
}
