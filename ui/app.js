const el = (s) => document.querySelector(s);
const widget = el("#w");
const body = el("#body");

let Q = [];
let TODAY = "";
let SOURCES = ["업무", "개인"];
let items = [];
let doneItems = [];
let logLoaded = false;

let tab = "matrix";
let source = "all";
let expanded = new Set();
let toastTimer = null;
let pullTimer = null;

const md = (iso) => iso ? `${+iso.slice(5,7)}/${+iso.slice(8,10)}` : "";
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
  fillAddForm();
  render();
}

async function pullLog(){
  if (!window.Backend) return;
  busy(true);
  const r = await Backend.log();
  busy(false);
  if (!r.ok){ toast(r.error, r.hint, true); return; }
  doneItems = r.data;
  logLoaded = true;
  render();
}

/* ── 그리기 ───────────────────────────── */
let editingMemo = null; // 지금 메모를 고치고 있는 항목 id

function tools(it){
  const pri = Q.map(q =>
    `<button class="p${q.n}${it.q===q.n?" on":""}" title="${esc(q.n+" "+q.name+" ("+q.axis+")")}"
      onclick="setQ('${it.id}',${q.n})">${q.n}</button>`).join("");
  return `<span class="tools">
    <button class="star${it.today?" on":""}" title="오늘의 3" onclick="star('${it.id}')">&#9733;</button>
    <span class="pri">${pri}</span>
    <button class="wbtn${it.wait?" on":""}" title="대기중" onclick="wait('${it.id}')">&#9203;</button>
    <button class="memobtn${it.memo?" on":""}" title="메모" onclick="toggleMemo('${it.id}')">&#9998;</button>
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
  const edit = (editingMemo === it.id && !pinned) ? memoEditor(it) : "";
  return `<li class="item${it.wait?" waiting":""}${edit?" editing":""}" data-id="${esc(it.id)}">
    ${num}
    <button class="chk" title="완료" onclick="complete('${it.id}')"></button>
    <span class="t" title="${esc(it.title)}">${wait}${tag}${esc(it.title)}${dt}${memo}</span>
    ${tools(it)}
    ${edit}
  </li>`;
}

/* 마감이 가까운 순. 지난 것이 자연히 맨 위로 온다. 마감 없는 것은 뒤로 */
function dateSort(a, b){
  if (!a.due !== !b.due) return a.due ? -1 : 1;
  return (a.due || "").localeCompare(b.due || "");
}

const view  = () => source === "all" ? items : items.filter(i => i.tag === source);
const vdone = () => source === "all" ? doneItems : doneItems.filter(i => i.tag === source);

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

function renderLog(){
  if (!logLoaded) return `<div class="notice">불러오는 중…</div>`;
  const list = vdone();
  const by = {};
  for (const d of list) (by[d.done] ||= []).push(d);
  const days = Object.keys(by).sort().reverse();
  if (!days.length) return `<div class="notice">최근 완료한 항목이 없습니다.</div>`;
  let h = "";
  for (const day of days){
    h += `<div class="group"><h3>${day === TODAY ? "오늘" : md(day)}<span class="rule"></span>
      <span class="cnt">${by[day].length}</span></h3><ul>`;
    for (const d of by[day]){
      h += `<li class="item">
        <button class="chk done" title="되돌리기" onclick="undo('${d.id}')"></button>
        <span class="t" title="${esc(d.title)}">
          <span class="tag${d.tag==="개인"?" personal":""}">${esc(d.tag)}</span>${esc(d.title)}</span>
        <span class="tools always"><button class="undo" onclick="undo('${d.id}')">되돌리기</button></span>
      </li>`;
    }
    h += `</ul></div>`;
  }
  return h;
}

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

  el("#n-all").textContent  = items.length;
  el("#n-work").textContent = items.filter(i=>i.tag==="업무").length;
  el("#n-mine").textContent = items.filter(i=>i.tag==="개인").length;
  document.querySelectorAll("#src button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.src === source)));
  document.querySelectorAll('[role="tab"]').forEach(b =>
    b.setAttribute("aria-selected", String(b.dataset.tab === tab)));

  body.innerHTML = tab === "matrix" ? renderMatrix() : tab === "dates" ? renderDates() : renderLog();
  if (tab === "matrix") requestAnimationFrame(fitCells);
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
function fillAddForm(){
  const tagSel = el("#a-tag");
  if (tagSel.options.length !== SOURCES.length){
    tagSel.innerHTML = SOURCES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  }
  const qSel = el("#a-q");
  qSel.innerHTML = `<option value="">사분면</option>` +
    Q.map(q => `<option value="${q.n}">${q.n} ${esc(q.name)}</option>`).join("");
}

function openAdd(on){
  const f = el("#addform");
  f.hidden = !on;
  if (on){
    if (source !== "all") el("#a-tag").value = source;
    el("#a-title").focus();
  } else {
    f.reset();
  }
  if (tab === "matrix") requestAnimationFrame(fitCells);
}

el("#add").addEventListener("click", () => openAdd(el("#addform").hidden));
el("#a-cancel").addEventListener("click", () => openAdd(false));
el("#addform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = el("#a-title").value.trim();
  if (!title) return;
  const tag = el("#a-tag").value, q = el("#a-q").value, due = el("#a-due").value;
  openAdd(false);
  tab = "matrix";
  // 새 항목의 노션 id는 서버가 정한다. 화면에 미리 그리지 않고 바로 다시 읽는다
  const r = await send("add", title, tag, due, q);
  if (r && r.ok){ toast("추가했습니다."); pull(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!el("#addform").hidden) openAdd(false);
  if (editingMemo) cancelMemo();
});

/* ── 탭 / 필터 ────────────────────────── */
document.querySelectorAll('[role="tab"]').forEach(b =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab;
    render();
    if (tab === "log" && !logLoaded) pullLog();
  }));
document.querySelectorAll("#src button").forEach(b =>
  b.addEventListener("click", () => { source = b.dataset.src; render(); }));

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
