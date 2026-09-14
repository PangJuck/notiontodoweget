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
 * 이 워커 자체에는 로그인이 없다. 누구든 URL을 알면 내 노션을 읽고 쓸 수
 * 있으므로, 배포 뒤 반드시 Cloudflare Access(Zero Trust)로 본인 계정만
 * 통과하도록 막는다 — worker/README.md 참고.
 */

const SOURCES = [
  ["업무", "0e928040351d4fdfae49f77e67e914e6"],
  ["개인", "1730d225784340f88e15f9af9d51ea78"],
];
const SOURCE_IDS = Object.fromEntries(SOURCES);

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

function quadDefs() {
  return QUADRANTS.map(([num]) => {
    let found = null;
    for (const [, dbId] of SOURCES) {
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

function parseRow(row, tag) {
  const p = row.properties || {};
  const raw = p["마감일"]?.date?.start;
  const select = p["우선순위"]?.select || {};
  return {
    id: row.id,
    tag,
    title: plain(p["할 일"], "title") || "(제목 없음)",
    memo: plain(p["메모"], "rich_text"),
    due: raw ? raw.slice(0, 10) : "",
    q: quadrantNum(select.name),
    today: !!p["오늘의 3"]?.checkbox,
    wait: !!p["대기중"]?.checkbox,
  };
}

function parseDone(row, tag) {
  const p = row.properties || {};
  const raw = p["완료일"]?.date?.start;
  const select = p["우선순위"]?.select || {};
  return {
    id: row.id,
    tag,
    title: plain(p["할 일"], "title") || "(제목 없음)",
    q: quadrantNum(select.name),
    done: raw ? raw.slice(0, 10) : "",
  };
}

async function fetchRows(token, dbId) {
  const payload = { filter: { property: "완료", checkbox: { equals: false } }, page_size: 100 };
  const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
  return r.results;
}

async function fetchDoneRows(token, dbId) {
  // 완료일로 거르지 않고 정렬만 시킨 뒤 여기서 자른다.
  // 완료일이 비어 있는 줄이 필터에 걸리면 통째로 사라지기 때문이다.
  const payload = {
    filter: { property: "완료", checkbox: { equals: true } },
    sorts: [{ property: "완료일", direction: "descending" }],
    page_size: 100,
  };
  const r = await notionCall(token, `https://api.notion.com/v1/databases/${dbId}/query`, payload, "POST");
  return r.results;
}

async function loadItems(token) {
  const items = [];
  for (const [tag, dbId] of SOURCES) {
    await ensureOptions(token, dbId);
    const rows = await fetchRows(token, dbId);
    items.push(...rows.map((r) => parseRow(r, tag)));
  }
  // 마감 가까운 순. 날짜 없는 것은 뒤로. (파이썬과 같은 키: !due, due, tag)
  items.sort((a, b) => {
    if (!a.due !== !b.due) return a.due ? -1 : 1;
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
  });
  return items;
}

async function loadDone(token) {
  const cutoff = new Date(Date.now() - (LOG_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  const rows = [];
  for (const [tag, dbId] of SOURCES) {
    const raw = await fetchDoneRows(token, dbId);
    for (const r of raw) {
      const item = parseDone(r, tag);
      if (item.done && item.done >= cutoff) rows.push(item);
    }
  }
  rows.sort((a, b) => (a.done < b.done ? 1 : a.done > b.done ? -1 : 0));
  return rows;
}

async function snapshot(token) {
  const items = await loadItems(token);
  return { today: todayISO(), quads: quadDefs(), sources: SOURCES.map(([t]) => t), items };
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

async function createItem(token, tag, title, due, quadrant) {
  const properties = {
    "할 일": { title: [{ text: { content: title.slice(0, 2000) } }] },
    완료: { checkbox: false },
  };
  if (due) properties["마감일"] = { date: { start: due } };
  if (quadrant) properties["우선순위"] = { select: { name: quadrant } };
  await notionCall(
    token,
    "https://api.notion.com/v1/pages",
    { parent: { database_id: SOURCE_IDS[tag] }, properties },
    "POST"
  );
}

async function trash(token, pageId) {
  // 완전 삭제가 아니라 노션 휴지통으로 보낸다.
  await notionCall(token, `https://api.notion.com/v1/pages/${pageId}`, { archived: true }, "PATCH");
}

function describe(err) {
  const status = err.status;
  if (status === 401) return ["토큰이 거부됐다", "워커의 NOTION_TOKEN 시크릿을 다시 확인한다."];
  if (status === 403)
    return ["권한이 없다", "노션 Integration 설정에서 Update content와 Insert content를 켜고 다시 실행한다."];
  if (status === 404)
    return ["DB를 찾지 못했다", "업무/개인 DB 페이지에서 ... > 연결로 Integration을 추가했는지 확인한다."];
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

const HANDLERS = {
  data: (token) => guarded(token, () => snapshot(token)),
  log: (token) => guarded(token, () => loadDone(token)),
  done: (token, [pageId]) => guarded(token, () => complete(token, pageId)),
  undo: (token, [pageId]) => guarded(token, () => uncomplete(token, pageId)),
  setpri: (token, [pageId, num, tag]) =>
    guarded(token, () => {
      const n = Number(num);
      const dbId = SOURCE_IDS[tag] || SOURCES[0][1];
      const name = QUADRANT_NUMS.includes(n) ? optionName(dbId, n) : null;
      return setPriority(token, pageId, name);
    }),
  star: (token, [pageId, on]) => guarded(token, () => setTodayFlag(token, pageId, !!on)),
  waiting: (token, [pageId, on]) => guarded(token, () => setWaiting(token, pageId, !!on)),
  add: async (token, [title, tag, due, quadrant]) => {
    title = (title || "").trim();
    if (!title) return { ok: false, error: "할 일을 적어주세요", hint: "" };
    if (!(tag in SOURCE_IDS)) tag = SOURCES[0][0];
    const num = Number(quadrant);
    const name = QUADRANT_NUMS.includes(num) ? optionName(SOURCE_IDS[tag], num) : null;
    return guarded(token, () => createItem(token, tag, title, (due || "").trim() || null, name));
  },
  remove: (token, [pageId]) => guarded(token, () => trash(token, pageId)),
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
      const result = await handler(env.NOTION_TOKEN, args);
      return Response.json(result);
    }

    // app.css, app.js, adapter-web.js 같은 정적 파일
    return env.ASSETS.fetch(request);
  },
};
