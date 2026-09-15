const el = (s) => document.querySelector(s);
const widget = el("#w");
const body = el("#body");

let Q = [];
let TODAY = "";
let SOURCES = ["업무", "개인"];
let PEOPLE = [];   // 팀 모드일 때 담당자 목록. 비면 담당자 줄이 안 뜬다
let ME = "";       // 내 담당자 이름 (팀 모드일 때만)
let isAdmin = true;
let isTeam = false;
let items = [];
let doneItems = [];
let logLoaded = false;

let tab = "matrix";
let calMonth = ""; // 캘린더가 보고 있는 달 "YYYY-MM". 비면 오늘이 든 달
let calDay = "";   // 눌러서 펼쳐 둔 날
let logDays = 90;  // 기록 탭이 거슬러 보는 날 수. 0이면 전체
let logGroup = "day"; // 기록 묶는 단위: day | week | month
let source = "all";
let person = "all"; // 담당자 필터
let personSet = false; // 첫 화면의 기본값을 한 번만 정하려고 둔다
let expanded = new Set();
let toastTimer = null;
let pullTimer = null;

const md = (iso) => iso ? `${+iso.slice(5,7)}/${+iso.slice(8,10)}` : "";
/* 위젯(파이썬)에는 아직 없는 창구가 있다. 있는 쪽에서만 그 기능을 켠다 —
   없는 걸 불러서 오류를 내느니 버튼을 안 보이는 편이 낫다. */
const can = (name) => !!(window.Backend && Backend[name]);
const canPriv = (it) => isTeam && it.tag === "팀" && can("setpriv");
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ── 글자 크기 (웹판 전용) ─────────────────
   위젯은 창 크기로 밀도를 조절하지만, 브라우저는 화면이 넓어도 글씨가
   그대로라 휑해 보인다. body에 zoom을 걸어 텍스트와 여백을 함께 키운다. */
const ZOOM_STEPS = [90, 100, 110, 125, 150, 175, 200];
let zoomPct = 100;

function loadZoom(){
  try {
    const saved = Number(localStorage.getItem("todo-widget-zoom"));
    if (ZOOM_STEPS.includes(saved)) zoomPct = saved;
  } catch (_) { /* 개인정보 보호 모드 등에서는 그냥 100%로 시작 */ }
}
function applyZoom(){
  document.body.style.zoom = `${zoomPct}%`;
  const pctEl = el("#zoom-pct");
  if (pctEl) pctEl.textContent = `${zoomPct}%`;
  try { localStorage.setItem("todo-widget-zoom", zoomPct); } catch (_) {}
  if (tab === "matrix") requestAnimationFrame(fitCells);
}
function stepZoom(dir){
  const i = ZOOM_STEPS.indexOf(zoomPct);
  zoomPct = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  applyZoom();
}
el("#zoom-out").addEventListener("click", () => stepZoom(-1));
el("#zoom-in").addEventListener("click", () => stepZoom(1));

/* ── 순서 커스터마이즈 (위젯·웹 공통) ──────────────
   1~4 칸 위치와 칸 안 항목 순서를 드래그로 바꿀 수 있다.
   노션에는 손대지 않는다 — 이 창(브라우저면 그 브라우저, 위젯이면
   그 컴퓨터)에서 보는 순서만 로컬에 따로 기억한다. */
let webQuadOrder = [1, 2, 3, 4];
let webItemOrder = {}; // {1: [id, id, ...], ...}

function loadWebOrder(){
  try {
    const saved = JSON.parse(localStorage.getItem("todo-widget-order") || "{}");
    if (Array.isArray(saved.quads) && new Set(saved.quads).size === 4
        && saved.quads.every(n => [1,2,3,4].includes(n))) {
      webQuadOrder = saved.quads;
    }
    if (saved.items && typeof saved.items === "object") webItemOrder = saved.items;
  } catch (_) { /* 저장된 게 없거나 깨졌으면 기본 순서로 시작 */ }
}
function saveWebOrder(){
  try {
    localStorage.setItem("todo-widget-order", JSON.stringify({quads: webQuadOrder, items: webItemOrder}));
  } catch (_) {}
}
function applyCustomOrder(list, qn){
  const order = webItemOrder[qn] || [];
  const byId = new Map(list.map(i => [i.id, i]));
  const ordered = order.map(id => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map(i => i.id));
  const rest = list.filter(i => !seen.has(i.id)).sort(dateSort);
  return [...ordered, ...rest];
}
function reorderItem(qn, id, beforeId){
  const current = applyCustomOrder(view().filter(i => i.q === qn), qn).map(i => i.id);
  const without = current.filter(x => x !== id);
  const at = beforeId ? without.indexOf(beforeId) : -1;
  without.splice(at < 0 ? without.length : at, 0, id);
  webItemOrder[qn] = without;
  saveWebOrder();
  render();
}
function swapQuadrants(a, b){
  const ia = webQuadOrder.indexOf(a), ib = webQuadOrder.indexOf(b);
  if (ia < 0 || ib < 0 || ia === ib) return;
  [webQuadOrder[ia], webQuadOrder[ib]] = [webQuadOrder[ib], webQuadOrder[ia]];
  saveWebOrder();
  render();
}

/* ── 알림 ─────────────────────────────── */
function toast(msg, hint, bad){
  const old = el(".toast");
  if (old) old.remove();
  const d = document.createElement("div");
  d.className = "toast" + (bad ? " bad" : "");
  d.innerHTML = esc(msg) + (hint ? `<div class="h">${esc(hint)}</div>` : "");
  document.body.appendChild(d);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => d.remove(), bad ? 7000 : 2600);
}

/* ── 파이썬 호출 ──────────────────────────
   화면을 먼저 바꾸고 노션에는 뒤따라 보낸다. 왕복이 1초 가까이 걸려서
   누를 때마다 기다리면 못 쓴다. 실패하면 알리고 진짜 상태를 다시 읽는다. */
function send(name, ...args){
  if (!window.Backend) return Promise.resolve({ok:false, error:"준비되지 않았다"});
  return Backend[name](...args).then(r => {
    if (r && r.ok === false){
      toast(r.error || "실패했다", r.hint, true);
      pull();
    }
    return r;
  }).catch(e => {
    toast("위젯 안에서 오류가 났다", String(e), true);
    return {ok:false};
  });
}

/* 연달아 누르면 마지막 것만 반영해 다시 읽는다 */
function schedulePull(){
  clearTimeout(pullTimer);
  pullTimer = setTimeout(pull, 1500);
}

function busy(on){ el("#reload").classList.toggle("spin", on); }

async function pull(){
  if (!window.Backend) return;
  busy(true);
  const r = await Backend.data();
  busy(false);
  if (!r.ok){
    body.innerHTML = `<div class="notice"><b>${esc(r.error)}</b>${esc(r.hint || "")}</div>`;
    return;
  }
  const d = r.data;
  TODAY = d.today; Q = d.quads; SOURCES = d.sources; items = d.items;
  PEOPLE = d.people || []; ME = d.me || ""; isAdmin = d.admin !== false;
  isTeam = d.team === true;
  // 하단 링크는 성준 개인 claude.ai 프로젝트로 간다. 팀원은 열지 못하므로 숨긴다.
  el("#assistant-link").hidden = d.team === true && !d.admin;
  fillFilters();
  fillAddForm();
  render();
}

async function pullLog(){
  if (!window.Backend) return;
  busy(true);
  const r = await Backend.log("", logDays);
  busy(false);
  if (!r.ok){ toast(r.error, r.hint, true); return; }
  doneItems = r.data;
  logLoaded = true;
  render();
}

/* ── 그리기 ───────────────────────────── */
let editingMemo = null; // 지금 메모를 고치고 있는 항목 id
let editingDue = null;  // 지금 마감일을 고치고 있는 항목 id

function tools(it){
  const pri = Q.map(q =>
    `<button class="p${q.n}${it.q===q.n?" on":""}" title="${esc(q.n+" "+q.name+" ("+q.axis+")")}"
      onclick="setQ('${it.id}',${q.n})">${q.n}</button>`).join("");
  const dueBtn = can("setdue")
    ? `<button class="duebtn${it.due?" on":""}" title="마감일" onclick="toggleDue('${it.id}')">&#128197;</button>` : "";
  const privBtn = canPriv(it)
    ? `<button class="privbtn${it.priv?" on":""}" title="${it.priv?"나만 보입니다":"팀에 보입니다"}"
        onclick="priv('${it.id}')">${it.priv?"&#128274;":"&#128275;"}</button>` : "";
  return `<span class="tools">
    <button class="star${it.today?" on":""}" title="오늘의 3" onclick="star('${it.id}')">&#9733;</button>
    <span class="pri">${pri}</span>
    <button class="wbtn${it.wait?" on":""}" title="대기중" onclick="wait('${it.id}')">&#9203;</button>
    ${dueBtn}
    <button class="memobtn${it.memo?" on":""}" title="메모" onclick="toggleMemo('${it.id}')">&#9998;</button>
    ${privBtn}
    <button class="del" title="삭제" onclick="del('${it.id}')">&#215;</button>
  </span>`;
}

function memoEditor(it){
  return `<div class="memo-edit">
    <textarea data-id="${esc(it.id)}" placeholder="메모">${esc(it.memo || "")}</textarea>
    <div class="memo-edit-btns">
      <button type="button" onclick="saveMemo('${it.id}')">저장</button>
      <button type="button" onclick="cancelMemo()">취소</button>
    </div>
  </div>`;
}

function dueEditor(it){
  return `<div class="memo-edit due-edit">
    <input type="date" data-due-id="${esc(it.id)}" value="${esc(it.due || "")}">
    <div class="memo-edit-btns">
      <button type="button" onclick="saveDue('${it.id}')">저장</button>
      <button type="button" class="ghost" onclick="saveDue('${it.id}', true)">날짜 지우기</button>
      <button type="button" onclick="cancelDue()">취소</button>
    </div>
  </div>`;
}

function row(it, compact, pinned, rank){
  const over = it.due && it.due < TODAY;
  const tag = compact ? "" : `<span class="tag${it.tag==="개인"?" personal":""}">${esc(it.tag)}</span>`;
  const memo = it.memo ? `<span class="memo">${esc(it.memo)}</span>` : "";
  const wait = it.wait ? `<span class="wait">대기</span>` : "";
  const dt = it.due ? `<span class="dt${over?" over":""}">${md(it.due)}</span>` : "";
  const num = rank ? `<span class="rank">${rank}</span>` : "";
  // 오늘의 3에 고정된 항목은 위 고정칸과 사분면 칸에 동시에 나온다.
  // 편집창을 양쪽 다 띄우면 data-id가 겹쳐 저장이 엉뚱한 쪽에서 읽힌다.
  // 고정칸 쪽은 편집창을 띄우지 않는다 — 칸 쪽에서 열린다.
  const lock = it.priv ? `<span class="lock" title="나만 보입니다">&#128274;</span>` : "";
  const edit = pinned ? ""
    : editingMemo === it.id ? memoEditor(it)
    : editingDue === it.id ? dueEditor(it) : "";
  return `<li class="item${it.wait?" waiting":""}${edit?" editing":""}" data-id="${esc(it.id)}">
    ${num}
    <button class="chk" title="완료" onclick="complete('${it.id}')"></button>
    <span class="t" title="${esc(it.title)}">${lock}${wait}${tag}${esc(it.title)}${dt}${memo}</span>
    ${tools(it)}
    ${edit}
  </li>`;
}

/* 마감이 가까운 순. 지난 것이 자연히 맨 위로 온다. 마감 없는 것은 뒤로 */
function dateSort(a, b){
  if (!a.due !== !b.due) return a.due ? -1 : 1;
  return (a.due || "").localeCompare(b.due || "");
}

const mine  = (list) => person === "all" ? list : list.filter(i => i.owner === person);
const view  = () => { const l = mine(items);     return source === "all" ? l : l.filter(i => i.tag === source); };
const vdone = () => { const l = mine(doneItems); return source === "all" ? l : l.filter(i => i.tag === source); };

function renderMatrix(){
  const list = view();
  let h = "";
  const pin = list.filter(i => i.today);
  if (pin.length){
    h += `<div class="pinned-box"><h3>오늘 끝낼 것<span class="rule"></span>
      <span class="cnt">${pin.length}/3</span></h3><ul>${pin.map(i=>row(i,false,true)).join("")}</ul></div>`;
  }
  // 순서(칸 위치, 칸 안 항목)는 드래그로 바꿀 수 있고 위젯/웹 둘 다 기억한다.
  // 아직 아무것도 안 바꿨으면 기본 그대로(1~4 순서, 마감 가까운 순)다.
  const quads = webQuadOrder.map(n => Q.find(q => q.n === n)).filter(Boolean);
  h += `<div class="grid">`;
  for (const q of quads){
    const cell = applyCustomOrder(list.filter(i => i.q === q.n), q.n);
    h += `<section class="cell ${q.key}" data-q="${q.n}">
      <h3><span class="num">${q.n}</span>${esc(q.name)}
        <span class="axis">(${esc(q.axis)})</span><span class="cnt">${cell.length}</span></h3>
      <ul>${cell.length ? cell.map((i,idx)=>row(i,true,false,idx+1)).join("") : `<li class="empty">비어 있음</li>`}</ul>
    </section>`;
  }
  h += `</div>`;
  const rest = list.filter(i => !i.q);
  if (rest.length){
    h += `<div class="unsorted"><h3>미분류<span class="rule"></span>
      <span class="cnt">${rest.length}</span></h3>
      <p class="tip">1~4를 눌러 칸에 넣으세요. 아침 10분이면 끝납니다.</p>
      <ul>${rest.map(i=>row(i,false)).join("")}</ul></div>`;
  }
  return h;
}

function renderDates(){
  const g = {"지난 것":[], "오늘":[], "이번 주":[], "날짜 미정":[]};
  for (const i of view()){
    if (!i.due) g["날짜 미정"].push(i);
    else if (i.due < TODAY) g["지난 것"].push(i);
    else if (i.due === TODAY) g["오늘"].push(i);
    else g["이번 주"].push(i);
  }
  let h = "";
  for (const [name, list] of Object.entries(g)){
    if (!list.length) continue;
    h += `<div class="group${name==="지난 것"?" past":""}">
      <h3>${name}<span class="rule"></span><span class="cnt">${list.length}</span></h3>
      <ul>${list.map(i=>row(i,false)).join("")}</ul></div>`;
  }
  return h || `<div class="notice">보여줄 것이 없습니다.</div>`;
}

/* ── 캘린더 ─────────────────────────────
   마감일을 달에 얹어 본다. 노션 캘린더 보기와 같은 것을 보되, 완료 체크와
   사분면 색은 이 화면 것을 그대로 쓴다. 칸을 누르면 그 날만 아래에 펼친다.
   달에 안 잡히는 두 가지(지난 마감, 날짜 미정)는 달력 아래에 따로 붙인다 —
   달력만 보고 있으면 놓치기 딱 좋은 것들이다. */
const DOW = ["일","월","화","수","목","금","토"];
const CAL_CHIPS = 3; // 한 칸에 미리 보여줄 개수. 나머지는 +N
const isoDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

function calAnchor(){
  return calMonth || (TODAY ? TODAY.slice(0,7) : isoDay(new Date()).slice(0,7));
}
/* 사분면 순으로. 같은 칸 안에서는 급한 것이 위에 있어야 눈에 먼저 들어온다 */
function quadSort(a, b){ return ((a.q || 9) - (b.q || 9)) || a.title.localeCompare(b.title); }

function renderCal(){
  const ym = calAnchor();
  const y = +ym.slice(0,4), m = +ym.slice(5,7);

  const all = view();
  const byDay = {};
  const undated = [];
  for (const i of all){
    if (i.due) (byDay[i.due] ||= []).push(i);
    else undated.push(i);
  }

  const lateCount = all.filter(i => i.due && i.due < TODAY).length;

  const lead = new Date(y, m-1, 1).getDay();          // 1일이 무슨 요일인지
  const days = new Date(y, m, 0).getDate();           // 그 달의 마지막 날
  const weeks = Math.ceil((lead + days) / 7);

  let h = `<div class="cal"><div class="calbar">
    <button type="button" class="calnav" onclick="calShift(-1)" title="이전 달">&#8249;</button>
    <span class="mon">${y}년 ${m}월</span>
    <button type="button" class="calnav" onclick="calShift(1)" title="다음 달">&#8250;</button>
    <button type="button" class="calnow" onclick="calToday()">오늘</button>
    ${lateCount ? `<span class="callate">지난 마감 ${lateCount}</span>` : ""}
  </div><div class="calgrid">`;
  h += DOW.map((d, n) => `<div class="caldow${n===0?" sun":""}">${d}</div>`).join("");

  for (let n = 0; n < weeks * 7; n++){
    const dt = new Date(y, m-1, 1 - lead + n);
    const day = isoDay(dt);
    const list = (byDay[day] || []).slice().sort(quadSort);
    const chips = list.slice(0, CAL_CHIPS).map(i =>
      `<span class="calchip q${i.q || 0}${i.wait?" waiting":""}${i.due < TODAY?" over":""}"
        data-id="${esc(i.id)}" title="${esc(i.title)}${canSetDue()?" — 끌어서 날짜를 옮깁니다":""}">
        <button class="chk" title="완료" onclick="event.stopPropagation();complete('${i.id}')"></button>
        <span class="ct">${i.priv?"&#128274; ":""}${esc(i.title)}</span></span>`).join("");
    const more = list.length > CAL_CHIPS
      ? `<span class="calmore">+${list.length - CAL_CHIPS}</span>` : "";
    const cls = [
      dt.getMonth() + 1 !== m ? "off" : "",
      day === TODAY ? "today" : "",
      day === calDay ? "on" : "",
      dt.getDay() === 0 ? "sun" : "",
    ].filter(Boolean).join(" ");
    h += `<div class="calday${cls?" "+cls:""}" data-day="${day}" onclick="calPick('${day}')">
      <span class="d">${dt.getDate()}</span>
      <div class="calchips">${chips}${more}</div></div>`;
  }
  h += `</div>`;

  if (calDay){
    const list = (byDay[calDay] || []).slice().sort(quadSort);
    const d = new Date(+calDay.slice(0,4), +calDay.slice(5,7)-1, +calDay.slice(8,10));
    h += `<div class="group"><h3>${md(calDay)} (${DOW[d.getDay()]}) 마감<span class="rule"></span>
      <span class="cnt">${list.length}</span></h3>
      <ul>${list.length ? list.map(i=>row(i,false)).join("")
        : `<li class="empty">이 날 마감인 일이 없습니다.</li>`}</ul></div>`;
  }

  // 지금 보고 있는 달에 이미 칸으로 나와 있는 것은 아래에 또 적지 않는다.
  // 펼쳐 둔 날과 겹치는 것도 마찬가지다 — 같은 항목을 두 번 그리면 메모 편집창이 엉킨다.
  const gridStart = isoDay(new Date(y, m-1, 1 - lead));
  const over = all
    .filter(i => i.due && i.due < TODAY && i.due < gridStart && i.due !== calDay)
    .sort(dateSort);
  if (over.length){
    h += `<div class="group past"><h3>지난 마감<span class="rule"></span>
      <span class="cnt">${over.length}</span></h3>
      <ul>${over.map(i=>row(i,false)).join("")}</ul></div>`;
  }
  if (undated.length){
    h += `<div class="group"><h3>날짜 미정<span class="rule"></span>
      <span class="cnt">${undated.length}</span></h3>
      <ul>${undated.map(i=>row(i,false)).join("")}</ul></div>`;
  }
  return h + `</div>`;
}

const canSetDue = () => can("setdue");

/* 칸에서 칸으로 끌면 마감일이 그날로 옮겨간다. 노션까지 같이 바뀐다 —
   매트릭스의 순서 드래그(브라우저에만 기억하는 것)와는 다른 일이다.
   손가락으로는 HTML 드래그가 안 잡히므로, 날짜 버튼(&#128197;)으로도
   똑같이 바꿀 수 있게 열어 뒀다. */
function wireCalDrag(){
  if (!canSetDue()) return;
  const grid = body.querySelector(".calgrid");
  if (!grid) return;
  grid.querySelectorAll(".calchip").forEach(chip => {
    chip.draggable = true;
    chip.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/due", chip.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      chip.classList.add("dragging");
    });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
  });
  grid.querySelectorAll(".calday").forEach(cell => {
    cell.addEventListener("dragover", e => {
      if (!e.dataTransfer.types.includes("text/due")) return;
      e.preventDefault();
      cell.classList.add("drop-day");
    });
    cell.addEventListener("dragleave", e => {
      if (!cell.contains(e.relatedTarget)) cell.classList.remove("drop-day");
    });
    cell.addEventListener("drop", e => {
      cell.classList.remove("drop-day");
      const id = e.dataTransfer.getData("text/due");
      if (!id) return;
      e.preventDefault();
      moveDue(id, cell.dataset.day);
    });
  });
}

window.calShift = (delta) => {
  const [y, m] = calAnchor().split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  calDay = "";
  render();
};
window.calToday = () => { calMonth = ""; calDay = ""; render(); };
window.calPick = (day) => { calDay = calDay === day ? "" : day; render(); };

/* ── 기록 ───────────────────────────────
   일/주/월 중 하나로 묶어 본다. 기본은 최근 3개월치만 불러온다 — 몇 년 쌓인
   뒤에도 탭을 여는 값이 같게 하려는 것이다. 더 옛날 것은 눌러서 늘린다. */
const LOG_STEPS = [[90, "3개월"], [180, "6개월"], [365, "1년"], [0, "전체"]];
const LOG_GROUPS = [["day", "일별"], ["week", "주별"], ["month", "월별"]];

const stepLabel = (days) => (LOG_STEPS.find(([d]) => d === days) || [0, "전체"])[1];

function weekStart(day){
  const d = new Date(+day.slice(0,4), +day.slice(5,7)-1, +day.slice(8,10));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 월요일 시작
  return isoDay(d);
}
function logKey(done){
  if (logGroup === "month") return done.slice(0, 7);
  if (logGroup === "week") return weekStart(done);
  return done;
}
function logLabel(key){
  if (logGroup === "month") return `${+key.slice(0,4)}년 ${+key.slice(5,7)}월`;
  if (logGroup === "week"){
    const d = new Date(+key.slice(0,4), +key.slice(5,7)-1, +key.slice(8,10) + 6);
    return `${md(key)} ~ ${md(isoDay(d))}`;
  }
  return key === TODAY ? "오늘" : md(key);
}

function renderLog(){
  if (!logLoaded) return `<div class="notice">불러오는 중…</div>`;
  const list = vdone();
  const by = {};
  for (const d of list) (by[logKey(d.done)] ||= []).push(d);
  const keys = Object.keys(by).sort().reverse();

  let h = `<div class="logbar"><span class="seg">` +
    LOG_GROUPS.map(([k, name]) =>
      `<button type="button" aria-pressed="${logGroup===k}" onclick="setLogGroup('${k}')">${name}</button>`
    ).join("") +
    `</span><span class="logrange">${logDays ? `최근 ${stepLabel(logDays)}` : "전체 기록"}</span></div>`;

  if (!keys.length){
    h += `<div class="notice">${logDays ? `최근 ${stepLabel(logDays)} 안에 완료한 항목이 없습니다.` : "완료한 항목이 없습니다."}</div>`;
  }
  for (const key of keys){
    h += `<div class="group"><h3>${logLabel(key)}<span class="rule"></span>
      <span class="cnt">${by[key].length}</span></h3><ul>`;
    for (const d of by[key]){
      const when = logGroup === "day" ? "" : `<span class="dt">${md(d.done)}</span>`;
      h += `<li class="item">
        <button class="chk done" title="되돌리기" onclick="undo('${d.id}')"></button>
        <span class="t" title="${esc(d.title)}">
          <span class="tag${d.tag==="개인"?" personal":""}">${esc(d.tag)}</span>${esc(d.title)}${when}</span>
        <span class="tools always"><button class="undo" onclick="undo('${d.id}')">되돌리기</button></span>
      </li>`;
    }
    h += `</ul></div>`;
  }
  // 늘릴 여지가 남아 있을 때만. 전체까지 왔으면 더 볼 것이 없다.
  const next = LOG_STEPS[LOG_STEPS.findIndex(([d]) => d === logDays) + 1];
  if (next) h += `<button class="more wide" onclick="moreLog(${next[0]})">그 이전 기록 보기 (${next[1]})</button>`;
  return h;
}

window.setLogGroup = (k) => { logGroup = k; render(); };
window.moreLog = (days) => { logDays = days; logLoaded = false; render(); pullLog(); };

/* 창 높이에 맞춰, 칸에 들어갈 만큼만 남기고 나머지는 더보기로 접는다.
   창을 키우면 저절로 더 보인다. (위젯 전용 — 웹은 아래 fitCellsWeb) */
function fitCells(){
  const grid = body.querySelector(".grid");
  if (!grid) return;
  grid.querySelectorAll(".more").forEach(b => b.remove());
  grid.querySelectorAll(".item").forEach(li => { li.hidden = false; });

  // 1열로 접힌 좁은 상태에서는 굳이 자르지 않는다. 어차피 세로로 훑는다
  if (widget.classList.contains("narrow")) return;

  wireDrag(grid); // 순서 드래그는 위젯·웹 공통

  if (!Backend.chrome){ fitCellsWeb(grid); return; }

  const pinned = body.querySelector(".pinned-box");
  const unsorted = body.querySelector(".unsorted");
  const gap = parseFloat(getComputedStyle(grid).rowGap) || 6;
  const avail = body.clientHeight
    - (pinned ? pinned.offsetHeight + 9 : 0)
    - (unsorted ? unsorted.offsetHeight + 11 : 0)
    - gap - 4;
  // 아무리 낮아도 포기하지 않는다. 여기서 손을 떼면 3,4번 칸이
  // 화면 밖으로 밀려나고, 그게 애초에 더보기를 만든 이유다.
  // 아래 cut은 최소 1이라 칸마다 한 건은 남는다.
  const rowH = Math.floor(avail / 2);

  const BTN = 25;
  grid.querySelectorAll(".cell").forEach(cell => {
    const n = +cell.dataset.q;
    const lis = [...cell.querySelectorAll(".item")];
    if (!lis.length) return;
    if (expanded.has(n)){ cell.appendChild(moreBtn(n, 0)); return; }

    // 칸 안쪽에서 목록이 쓸 수 있는 높이.
    // 다른 칸의 위치를 참조하지 않아야 자르는 순서에 영향받지 않는다.
    const cs = getComputedStyle(cell);
    const h3 = cell.querySelector("h3");
    const head = h3 ? h3.offsetHeight + (parseFloat(getComputedStyle(h3).marginBottom) || 0) : 0;
    const inner = rowH
      - (parseFloat(cs.paddingTop) || 0)
      - (parseFloat(cs.paddingBottom) || 0)
      - (parseFloat(cs.borderTopWidth) || 0)
      - head;

    let total = 0;
    for (const li of lis) total += li.offsetHeight;
    if (total <= inner) return;              // 전부 들어간다

    let acc = 0, cut = 0;
    for (const li of lis){
      if (acc + li.offsetHeight > inner - BTN) break;
      acc += li.offsetHeight;
      cut++;
    }
    cut = Math.max(cut, 1);                  // 최소 한 건은 보인다
    if (cut >= lis.length) return;
    for (let i = cut; i < lis.length; i++) lis[i].hidden = true;
    cell.appendChild(moreBtn(n, lis.length - cut));
  });
}

function moreBtn(n, hidden, onClick){
  const b = document.createElement("button");
  b.className = "more";
  b.textContent = hidden > 0 ? `+${hidden}개 더보기` : "접기";
  b.addEventListener("click", onClick || (() => expand(n)));
  return b;
}

/* 웹은 화면이 넓어서 높이에 맞춰 자동으로 숨기면 오히려 놓치기 쉽다.
   기본은 전부 펼치고(스크롤은 생겨도 된다), 눌렀을 때만 접는다. */
const WEB_COLLAPSE_SHOW = 2; // 접었을 때 남기는 개수
let webCollapsed = new Set();

function toggleWebCollapse(n){
  webCollapsed.has(n) ? webCollapsed.delete(n) : webCollapsed.add(n);
  render();
}

function fitCellsWeb(grid){
  grid.querySelectorAll(".cell").forEach(cell => {
    const n = +cell.dataset.q;
    const lis = [...cell.querySelectorAll(".item")];
    if (lis.length <= WEB_COLLAPSE_SHOW) return; // 접을 이유가 없다
    if (webCollapsed.has(n)){
      for (let i = WEB_COLLAPSE_SHOW; i < lis.length; i++) lis[i].hidden = true;
      cell.appendChild(moreBtn(n, lis.length - WEB_COLLAPSE_SHOW, () => toggleWebCollapse(n)));
    } else {
      cell.appendChild(moreBtn(n, 0, () => toggleWebCollapse(n)));
    }
  });
}

/* 칸 제목을 잡으면 1~4 위치를 서로 바꾸고, 항목을 잡으면 같은 칸
   안에서 순서를 바꾼다. 다른 칸으로 끌어다 놓는 건 안 받는다 —
   사분면을 옮기는 건 이미 숫자 버튼(1~4)이 있다. */
function wireDrag(grid){
  grid.querySelectorAll(".cell").forEach(cell => {
    const h3 = cell.querySelector("h3");
    if (!h3 || h3.dataset.dragWired) return;
    h3.dataset.dragWired = "1";
    h3.draggable = true;
    h3.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/cell", cell.dataset.q);
      e.dataTransfer.effectAllowed = "move";
    });
    cell.addEventListener("dragover", e => {
      if (!e.dataTransfer.types.includes("text/cell")) return;
      e.preventDefault();
      cell.classList.add("drag-over");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", e => {
      cell.classList.remove("drag-over");
      const from = e.dataTransfer.getData("text/cell");
      if (!from) return;
      e.preventDefault();
      swapQuadrants(+from, +cell.dataset.q);
    });
  });

  grid.querySelectorAll(".cell ul").forEach(ul => {
    const qn = +ul.closest(".cell").dataset.q;
    ul.querySelectorAll(".item").forEach(li => {
      if (li.querySelector(".memo-edit")) return; // 메모 입력 중인 항목은 텍스트 선택과 겹치니 뺀다
      li.draggable = true;
      li.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/item", li.dataset.id);
        e.dataTransfer.effectAllowed = "move";
        e.stopPropagation(); // 칸 드래그와 겹치지 않게
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => { li.classList.remove("dragging"); clearDropMark(grid); });
    });
    ul.addEventListener("dragover", e => {
      if (!e.dataTransfer.types.includes("text/item")) return;
      e.preventDefault();
      markDrop(grid, ul, e.clientY);
    });
    ul.addEventListener("dragleave", e => {
      // ul 안의 자식으로 옮겨간 것뿐이면 표시를 지우지 않는다
      if (!ul.contains(e.relatedTarget)) clearDropMark(grid);
    });
    ul.addEventListener("drop", e => {
      const id = e.dataTransfer.getData("text/item");
      if (!id) return;
      e.preventDefault();
      const after = dropTarget(ul, e.clientY);
      clearDropMark(grid);
      reorderItem(qn, id, after ? after.dataset.id : null);
    });
  });
}

/* 커서 높이 기준으로 어느 항목 앞에 들어갈지 고른다.
   맨 아래로 내리면 null — 끝에 붙인다는 뜻이다. */
function dropTarget(ul, y){
  return [...ul.querySelectorAll(".item:not(.dragging)")].find(li => {
    const box = li.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) || null;
}

function clearDropMark(grid){
  grid.querySelectorAll(".drop-before,.drop-after")
    .forEach(li => li.classList.remove("drop-before", "drop-after"));
}

/* 들어갈 자리를 선 하나로 보여준다. 항목 사이면 그 항목 위쪽에,
   맨 끝이면 마지막 항목 아래쪽에 긋는다. */
function markDrop(grid, ul, y){
  clearDropMark(grid);
  const target = dropTarget(ul, y);
  if (target){
    target.classList.add("drop-before");
    return;
  }
  const rest = [...ul.querySelectorAll(".item:not(.dragging)")];
  if (rest.length) rest[rest.length - 1].classList.add("drop-after");
}

function render(){
  const v = view();
  const pin = v.filter(i=>i.today).length;
  const q1 = v.filter(i=>i.q===1).length;
  const un = v.filter(i=>!i.q).length;
  let s = `${pin}/3`;
  if (q1) s += `, <span class="warn">${esc(Q[0] ? Q[0].name : "1")} ${q1}</span>`;
  if (un) s += `, 미분류 ${un}`;
  const stat = el("#stat");
  stat.innerHTML = s;
  stat.title = `오늘의 3 ${pin}/3` + (q1 ? `, ${Q[0] ? Q[0].name : "1"} ${q1}건` : "")
             + (un ? `, 미분류 ${un}건` : "");

  const pool = mine(items);
  document.querySelectorAll("#src .n").forEach(sp => {
    const k = sp.dataset.count;
    sp.textContent = k === "all" ? pool.length : pool.filter(i => i.tag === k).length;
  });
  document.querySelectorAll("#src button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.src === source)));
  document.querySelectorAll("#who button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.who === person)));
  document.querySelectorAll('[role="tab"]').forEach(b =>
    b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

  body.innerHTML = tab === "matrix" ? renderMatrix()
                 : tab === "dates"  ? renderDates()
                 : tab === "cal"    ? renderCal()
                 : renderLog();
  if (tab === "matrix") requestAnimationFrame(fitCells);
  if (tab === "cal") requestAnimationFrame(wireCalDrag);
}

const find = (id) => items.find(i => i.id === id);

/* ── 조작 ─────────────────────────────── */
window.setQ = (id, n) => {
  const it = find(id); if (!it) return;
  it.q = it.q === n ? null : n;
  render();
  send("setpri", id, it.q, it.tag).then(schedulePull);
};
window.star = (id) => {
  const it = find(id); if (!it) return;
  if (!it.today && items.filter(i=>i.today).length >= 3){
    toast("오늘의 3은 최대 3개입니다.", "하나를 먼저 빼주세요.");
    return;
  }
  it.today = !it.today;
  render();
  send("star", id, it.today).then(schedulePull);
};
window.wait = (id) => {
  const it = find(id); if (!it) return;
  it.wait = !it.wait;
  render();
  send("waiting", id, it.wait).then(schedulePull);
};
window.del = (id) => {
  items = items.filter(i => i.id !== id);
  render();
  send("remove", id).then(schedulePull);
};
window.complete = (id) => {
  const it = find(id); if (!it) return;
  items = items.filter(i => i.id !== id);
  if (logLoaded) doneItems.unshift({id:it.id, tag:it.tag, title:it.title, q:it.q, done:TODAY});
  render();
  send("done", id).then(schedulePull);
};
window.undo = (id) => {
  // 이미 화면에서 뺐으니 logLoaded는 건드리지 않는다.
  // 여기서 false로 두면 기록 탭이 '불러오는 중'에 멈춘 채 남는다
  doneItems = doneItems.filter(x => x.id !== id);
  render();
  send("undo", id).then(() => { pull(); pullLog(); });
};
/* 화면을 먼저 바꾸고 노션에 뒤따라 보낸다 — 다른 조작과 같은 방식이다 */
function moveDue(id, day){
  const it = find(id);
  if (!it || it.due === day) return;
  it.due = day;
  editingDue = null;
  render();
  send("setdue", id, day).then(schedulePull);
}
window.moveDue = moveDue;

window.toggleDue = (id) => {
  editingDue = editingDue === id ? null : id;
  editingMemo = null;
  render();
  if (editingDue){
    requestAnimationFrame(() => {
      const inp = body.querySelector(`.due-edit input[data-due-id="${CSS.escape(id)}"]`);
      if (inp) inp.focus();
    });
  }
};
window.cancelDue = () => { editingDue = null; render(); };
window.saveDue = (id, clear) => {
  const inp = body.querySelector(`.due-edit input[data-due-id="${CSS.escape(id)}"]`);
  const day = clear ? "" : (inp ? inp.value : "");
  const it = find(id);
  if (!it) return;
  it.due = day;
  editingDue = null;
  render();
  send("setdue", id, day).then(schedulePull);
};

window.priv = (id) => {
  const it = find(id);
  if (!it) return;
  it.priv = !it.priv;
  render();
  toast(it.priv ? "나만 보이게 했습니다." : "팀에 다시 열었습니다.");
  send("setpriv", id, it.priv).then(schedulePull);
};

window.expand = (n) => { expanded.has(n) ? expanded.delete(n) : expanded.add(n); render(); };

window.toggleMemo = (id) => {
  editingMemo = editingMemo === id ? null : id;
  render();
  if (editingMemo){
    requestAnimationFrame(() => {
      const ta = body.querySelector(`.memo-edit textarea[data-id="${CSS.escape(id)}"]`);
      if (ta){ ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
    });
  }
};
window.cancelMemo = () => { editingMemo = null; render(); };
window.saveMemo = (id) => {
  const ta = body.querySelector(`.memo-edit textarea[data-id="${CSS.escape(id)}"]`);
  const text = ta ? ta.value.trim() : "";
  const it = find(id);
  if (it) it.memo = text;
  editingMemo = null;
  render();
  send("setmemo", id, text).then(schedulePull);
};

/* ── 추가 폼 ──────────────────────────── */
/* 보기 범위와 담당자 줄은 사람마다 다르므로 받아온 데이터로 그린다.
   팀원은 '팀' 하나만, 관리자는 업무/개인/팀에 담당자 줄까지 본다. */
const SRC_CLASS = {"업무":"work", "개인":"mine", "팀":"team"};

function chip(attr, key, label, count){
  const cls = SRC_CLASS[key] ? ` class="${SRC_CLASS[key]}"` : "";
  const n = count ? ` <span class="n" data-count="${esc(key)}"></span>` : "";
  return `<button type="button" data-${attr}="${esc(key)}"${cls} aria-pressed="false">${esc(label)}${n}</button>`;
}

function fillFilters(){
  const keys = ["all", ...SOURCES];
  const src = el("#src");
  // 고를 DB가 하나뿐이면 '전체'와 그 하나가 같은 말이라 줄이 헷갈리기만 한다.
  src.hidden = SOURCES.length < 2;
  src.innerHTML = src.hidden ? "" : [chip("src", "all", "전체", true),
    ...SOURCES.map(t => chip("src", t, t, true))].join("");
  if (src.hidden || !keys.includes(source)) source = "all";

  const who = el("#who");
  who.hidden = PEOPLE.length < 2; // 혼자뿐이면 고를 것이 없다
  if (who.hidden){
    person = "all";
    who.innerHTML = "";
    return;
  }
  who.innerHTML = [chip("who", "all", "전체"),
    ...PEOPLE.map(p => chip("who", p, p))].join("");
  // 팀원은 자기 것부터 보는 게 자연스럽다. 동료 것은 눌러서 본다.
  // 관리자는 전체를 먼저 본다. 한 번 고른 뒤에는 건드리지 않는다.
  if (!personSet){
    person = !isAdmin && ME && PEOPLE.includes(ME) ? ME : "all";
    personSet = true;
  }
  if (person !== "all" && !PEOPLE.includes(person)) person = "all";
}

/* '나만 보기'는 팀 DB에 넣을 때만 뜻이 있다. 업무·개인 DB에는 그 속성이 없다 */
function syncPrivVisible(){
  const wrap = el("#a-priv-wrap");
  const tagSel = el("#a-tag");
  const going = tagSel.hidden ? (SOURCES[0] || "") : tagSel.value;
  wrap.hidden = !(isTeam && can("setpriv") && going === "팀");
  if (wrap.hidden) el("#a-priv").checked = false;
}

function fillAddForm(){
  const tagSel = el("#a-tag");
  tagSel.hidden = SOURCES.length < 2; // 어차피 갈 곳이 하나뿐이면 고를 이유가 없다
  if (tagSel.options.length !== SOURCES.length){
    tagSel.innerHTML = SOURCES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }
  const qSel = el("#a-q");
  qSel.innerHTML = `<option value="">사분면</option>` +
    Q.map(q => `<option value="${q.n}">${q.n} ${esc(q.name)}</option>`).join("");
  syncPrivVisible();
}

function openAdd(on){
  const f = el("#addform");
  f.hidden = !on;
  if (on){
    if (source !== "all") el("#a-tag").value = source;
    syncPrivVisible();
    el("#a-title").focus();
  } else {
    f.reset();
  }
  if (tab === "matrix") requestAnimationFrame(fitCells);
}

el("#a-tag").addEventListener("change", syncPrivVisible);
el("#add").addEventListener("click", () => openAdd(el("#addform").hidden));
el("#a-cancel").addEventListener("click", () => openAdd(false));
el("#addform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = el("#a-title").value.trim();
  if (!title) return;
  const tag = el("#a-tag").value, q = el("#a-q").value, due = el("#a-due").value;
  // 만들 때 같이 보낸다. 만들고 나서 잠그면 그 사이에 남에게 한 번 보인다.
  const priv = !el("#a-priv-wrap").hidden && el("#a-priv").checked;
  openAdd(false);
  tab = "matrix";
  // 새 항목의 노션 id는 서버가 정한다. 화면에 미리 그리지 않고 바로 다시 읽는다
  const r = await send("add", title, tag, due, q, priv);
  if (r && r.ok){ toast("추가했습니다."); pull(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el("#addform").hidden) openAdd(false);
  if (editingMemo) cancelMemo();
  if (editingDue) cancelDue();
});

/* ── 탭 / 필터 ────────────────────────── */
document.querySelectorAll('[role="tab"]').forEach(b =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    render();
    if (tab === "log" && !logLoaded) pullLog();
  }));
// 버튼을 다시 그리므로 낱개가 아니라 줄에 붙인다.
el("#src").addEventListener("click", e => {
  const b = e.target.closest("button[data-src]");
  if (b){ source = b.dataset.src; render(); }
});
el("#who").addEventListener("click", e => {
  const b = e.target.closest("button[data-who]");
  if (b){ person = b.dataset.who; render(); }
});

/* ── 창 조작 ──────────────────────────── */
el("#reload").addEventListener("click", () => {
  pull();
  // 기록은 열어 볼 때만 읽는다. 지금 보고 있지 않으면 다음에 열 때 다시 읽게 표시만 해둔다
  if (tab === "log") pullLog(); else logLoaded = false;
});
el("#tray").addEventListener("click", () => send("minimize"));
el("#quit").addEventListener("click", () => send("quit"));
el("#ontop").addEventListener("change", e => {
  widget.classList.toggle("pinned", e.target.checked);
  send("ontop", e.target.checked);
});

function syncNarrow(){
  const w = document.documentElement.clientWidth;
  widget.classList.toggle("narrow", w < 320);
  widget.classList.toggle("tight",  w < 400);
}

/* 크기 조절 — 프레임이 없는 창이라 테두리가 없다. 손잡이로 직접 창을 늘린다 */
let drag = null, pending = null;
document.querySelectorAll(".rz").forEach(h => {
  h.addEventListener("pointerdown", e => {
    drag = {dir:h.dataset.dir, x:e.screenX, y:e.screenY,
            w:window.innerWidth, h:window.innerHeight};
    h.setPointerCapture(e.pointerId);
    widget.classList.add("resizing");
    e.preventDefault();
  });
  h.addEventListener("pointermove", e => {
    if (!drag) return;
    const w = drag.dir.includes("e") ? Math.max(280, drag.w + e.screenX - drag.x) : window.innerWidth;
    const ht = drag.dir.includes("s") ? Math.max(340, drag.h + e.screenY - drag.y) : window.innerHeight;
    // 한 프레임에 한 번만 파이썬을 부른다. 매 픽셀마다 부르면 끌리는 게 늦는다
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = null;
      send("resize", Math.round(w), Math.round(ht));
    });
  });
  const stop = e => {
    if (!drag) return;
    drag = null;
    widget.classList.remove("resizing");
    try { h.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  h.addEventListener("pointerup", stop);
  h.addEventListener("pointercancel", stop);
});

/* 위젯 안 브라우저(WebView2)는 target="_blank"를 링크 클릭대로
   처리해주지 않는다. 위젯일 때만 가로채 시스템 기본 브라우저로 연다.
   웹에서는 그냥 새 탭으로 열리게 손대지 않는다. */
el("#assistant-link").addEventListener("click", (e) => {
  if (!Backend.chrome) return;
  e.preventDefault();
  Backend.openlink(el("#assistant-link").href);
});

window.addEventListener("resize", () => { syncNarrow(); if (tab === "matrix") fitCells(); });
window.addEventListener("focus", () => { if (items.length) schedulePull(); });
setInterval(() => { if (!document.hidden) pull(); }, 5 * 60 * 1000);

/* 위젯 전용 기능(항상 위/트레이/종료/크기조절)은 웹에는 없다.
   어댑터가 backendready를 쏘면서 Backend.chrome으로 알려준다. */
document.addEventListener("backendready", () => {
  widget.classList.toggle("web", !Backend.chrome);
  if (!Backend.chrome) { loadZoom(); applyZoom(); }
  loadWebOrder(); // 순서 기억은 위젯·웹 공통
  syncNarrow();
  pull();
});
syncNarrow();
