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
function tools(it){
  const pri = Q.map(q =>
    `<button class="p${q.n}${it.q===q.n?" on":""}" title="${esc(q.n+" "+q.name+" ("+q.axis+")")}"
      onclick="setQ('${it.id}',${q.n})">${q.n}</button>`).join("");
  return `<span class="tools">
    <button class="star${it.today?" on":""}" title="오늘의 3" onclick="star('${it.id}')">&#9733;</button>
    <span class="pri">${pri}</span>
    <button class="wbtn${it.wait?" on":""}" title="대기중" onclick="wait('${it.id}')">&#9203;</button>
    <button class="del" title="삭제" onclick="del('${it.id}')">&#215;</button>
  </span>`;
}

function row(it, compact){
  const over = it.due && it.due < TODAY;
  const tag = compact ? "" : `<span class="tag${it.tag==="개인"?" personal":""}">${esc(it.tag)}</span>`;
  const memo = (!compact && it.memo) ? `<span class="memo">${esc(it.memo)}</span>` : "";
  const wait = it.wait ? `<span class="wait">대기</span>` : "";
  const dt = it.due ? `<span class="dt${over?" over":""}">${md(it.due)}</span>` : "";
  return `<li class="item${it.wait?" waiting":""}">
    <button class="chk" title="완료" onclick="complete('${it.id}')"></button>
    <span class="t" title="${esc(it.title)}">${wait}${tag}${esc(it.title)}${dt}${memo}</span>
    ${tools(it)}
  </li>`;
}

const view  = () => source === "all" ? items : items.filter(i => i.tag === source);
const vdone = () => source === "all" ? doneItems : doneItems.filter(i => i.tag === source);

function renderMatrix(){
  const list = view();
  let h = "";
  const pin = list.filter(i => i.today);
  if (pin.length){
    h += `<div class="pinned-box"><h3>오늘 끝낼 것<span class="rule"></span>
      <span class="cnt">${pin.length}/3</span></h3><ul>${pin.map(i=>row(i,false)).join("")}</ul></div>`;
  }
  h += `<div class="grid">`;
  for (const q of Q){
    // 마감이 가까운 순. 지난 것이 자연히 맨 위로 온다. 마감 없는 것은 뒤로
    const cell = list.filter(i => i.q === q.n).sort((a,b) => {
      if (!a.due !== !b.due) return a.due ? -1 : 1;
      return (a.due || "").localeCompare(b.due || "");
    });
    h += `<section class="cell ${q.key}" data-q="${q.n}">
      <h3><span class="num">${q.n}</span>${esc(q.name)}
        <span class="axis">(${esc(q.axis)})</span><span class="cnt">${cell.length}</span></h3>
      <ul>${cell.length ? cell.map(i=>row(i,true)).join("") : `<li class="empty">비어 있음</li>`}</ul>
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
   창을 키우면 저절로 더 보인다. */
function fitCells(){
  const grid = body.querySelector(".grid");
  if (!grid) return;
  grid.querySelectorAll(".more").forEach(b => b.remove());
  grid.querySelectorAll(".item").forEach(li => { li.hidden = false; });

  // 1열로 접힌 좁은 상태에서는 굳이 자르지 않는다. 어차피 세로로 훑는다
  if (widget.classList.contains("narrow")) return;

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

function moreBtn(n, hidden){
  const b = document.createElement("button");
  b.className = "more";
  b.textContent = hidden > 0 ? `+${hidden}개 더보기` : "접기";
  b.addEventListener("click", () => expand(n));
  return b;
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
  if (e.key === "Escape" && !el("#addform").hidden) openAdd(false);
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
  syncNarrow();
  pull();
});
syncNarrow();
