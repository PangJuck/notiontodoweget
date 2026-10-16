/* 캐릭터 보기 (웹판만). 그림, 영상, 대사는 시사(cheo0y/shisa-agent)에서 가져왔고,
   치이카와와 농담곰 그림은 박성준이 따로 줬다.
   ui/characters/NOTICE.md 참고.

   - 고르기: 위 막대의 톱니 단추로 여는 창. 30일 동안 안 띄웠으면 페이지를 열 때 저절로 뜬다.
     여러 마리를 같이 고를 수 있다(쉼표로 이은 id 목록). 고르지 않은 사람 화면은 그대로다. 고른 값은 각자 브라우저(localStorage)에만 남는다. 업무 데이터가 아니라 화면 설정이다
   - 걷기: 매트릭스 탭에서는 사분면 칸과 "오늘 끝낼 것" 상자 테두리를 상자 위 벌레처럼 돈다.
     윗변과 바깥에 자리가 있는 옆벽을 걷고, 모서리에서 돌고, 틈은 뛰어 건넌다. 아랫변은 걷지
     않고 바닥(#body 맨 아래)으로 떨어졌다가 조금 뒤 옆벽으로 뛰어올라 다시 올라간다.
     변 1~3개마다 4~12초 쉬고, 20~40초 걸으면 20~60초 앉아 공부(또는 쉼)한다.
     입력칸에 글을 쓰는 동안은 가만히 있는다. 칸 위치는 매 프레임 다시 잰다
   - 글자를 덜 가리게: 40px로 작게, 멈추거나 앉는 것은 글자가 없는 자리에서만, 말풍선은
     위아래 중 글자가 적은 쪽에. 흐려지지는 않는다(2026-10-16 박성준 결정)
   - 끌어서 던지기: 누른 채 끌면 따라오고, 놓으면 날아가 처음 닿는 칸 윗변이나 바닥에 선다.
     빈 자리(글자도 칸도 없는 곳)에 놓거나 떨어지면 거기 떠서 한동안 쉬다가 가까운 변으로 간다.
     끌지 않고 짧게 누르면 말을 건다
   - 여러 마리: 각자 따로 움직이고, 말은 한 번에 한 마리만 한다(말풍선이 겹치지 않는다).
     반응은 한 마리가 영상과 말로, 나머지는 살짝 뛴다. 같은 자리에 서면 나중 쪽이 비킨다
   - 우사기는 가끔 큰 말풍선으로 외친다(말 걸 때 4번에 1번, 5~10분마다, 던지면 가끔)
   - 반응: app.js가 Chars.react("done", 항목) / Chars.react("add")를 부른다. 위젯에는 이
     파일이 안 실려서 거기서는 window.Chars가 없고, 부르는 쪽이 ?.로 넘어간다
   - "애니메이션 줄이기"를 켠 사람에게는 걷지도 날지도 않고 구석에 나란히 서서 말만 한다 */
(function(){
  // 캐릭터 목록. 새 캐릭터는 ui/characters/<id>/ 폴더와 여기 한 줄이면 된다 (고르기 창도 이 순서).
  // done, add, study: 반응에 쓸 것. 이름만 쓰면 <id>/<이름>.webm 영상(video.json 에 있어야 한다.
  //   배경이 칠해진 영상(video.json scene: true)만 카드에 넣고, 투명 영상은 테두리 없이 띄운다),
  //   .jpg 는 카드 안 그림, .png 는 그 그림으로 바꿔 두 번 통통 뛰기. 배열이면 그중 하나,
  //   비었으면 그냥 통통 뛴다(add 는 한 번, done 은 두 번).
  // blink: eyes_closed.png 가 있으면 true. fly: 끌리고 날 때 그림(없으면 감은 눈). hop: 뛸 때 그림.
  // rest: 앉을 때 가끔 공부 대신 쓰는 테두리 없는 그림. night 이면 19시 뒤엔 늘 rest.
  // pics: 말풍선 그림. daily(그날 첫인사), lunch, evening(그 때 인사), lots, none(오늘의 3 하나도 못 함),
  //   remind, cheer(응원 줄에 가끔). 배열이면 번갈아. 없으면 글만
  // 대사는 lines.json 에 캐릭터가 없으면 시사 것을, 키가 없으면 응원 중 하나를 쓴다
  const CHARS = [
    { id: "shisa",   name: "시사",     blink: true,  done: "dance", add: "studying", study: "studying" },
    { id: "hachi",   name: "하치와레", blink: true,  done: "cheer", add: "plan", study: "study" },
    // faceLeft: 그림이 왼쪽을 보고 있어 오른쪽으로 걸을 때 뒤집는다
    { id: "rakko",   name: "랏코",     blink: true,  faceLeft: true, done: "dance", add: "plan", study: "study" },
    { id: "momonga", name: "모몽가",   blink: true,  done: "dance", add: "plan", study: "study" },
    { id: "usagi",   name: "우사기",   blink: false, done: ["cheer", "dance"], add: "plan", study: "study" },
    { id: "chiikawa", name: "치이카와", blink: false, done: null, add: "plan.jpg", study: "study.jpg",
      fly: "fly.png", hop: "hop.png", rest: "sleep.png", night: true,
      pics: { daily: "greet.jpg", lots: "lots.jpg", none: "cheer.jpg", remind: "cheer.jpg" } },
    { id: "jokebear", name: "농담곰", blink: false, done: "dance.png", add: null, study: "study.jpg",
      fly: "fly.png", hop: "hop.png", rest: "sit.png",
      pics: { lunch: "lunch.jpg", evening: "evening.jpg", lots: "lots.jpg", none: ["gloom.jpg", "cannot.jpg"],
              remind: "cheer.jpg", cheer: "cheer.jpg" } },
  ];
  const info = (id) => CHARS.find(c => c.id === id);
  const eyes = (id, closed) => `characters/${id}/${closed && info(id).blink ? "eyes_closed" : "eyes_open"}.png`;
  const flyFace = (id) => info(id).fly ? `characters/${id}/${info(id).fly}` : eyes(id, true);
  const KEY = "ulick.character";
  const ASKED_KEY = "ulick.character.asked", DAILY_KEY = "ulick.character.daily", DONE_KEY = "ulick.character.today3", LOTS_KEY = "ulick.character.lots";
  const SIZE = 40, CARD = 84, SPEED = 45, STEP = .4, G = 1800; // px, px, px/s, 걸음 초, px/s²
  const N = [[0,-1],[1,0],[0,1],[-1,0]]; // 변마다 바깥 방향: 윗변, 오른쪽, 아랫변, 왼쪽
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const ls = {
    get(k){ try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v){ try { v == null || v === "" ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {} },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fill = (s, o) => String(s || "").replace(/\{(\w+)\}/g, (_, k) => o[k] ?? "");
  const quote = (t) => `'${String(t).slice(0, 24)}'`;

  const css = document.createElement("style");
  css.textContent = `
.char-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
  padding:16px;background:rgba(5,10,16,.62);transition:opacity .3s}
.char-modal.out{opacity:0}
.char-pop{width:100%;max-width:460px;padding:18px 16px 14px;border-radius:14px;background:var(--panel);
  border:1px solid var(--line);box-shadow:0 10px 40px rgba(0,0,0,.5);color:var(--text);font:13px/1.5 var(--kr);text-align:center}
.char-pop h2{margin:0 0 14px;font-size:15px;font-weight:600}
.char-cards{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}
.char-cards button{flex:0 0 76px;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;padding:8px 4px 7px;
  border-radius:10px;background:var(--panel-2);border:1px solid var(--line);color:var(--text);font:12px var(--kr);cursor:pointer}
.char-cards button:hover,.char-pop button:focus-visible{border-color:var(--accent);outline:none}
.char-cards button{position:relative}
.char-cards button[aria-pressed=true]{border-color:var(--accent);background:var(--panel)}
.char-cards button[aria-pressed=true]::after{content:"✓";position:absolute;top:4px;right:5px;width:16px;height:16px;
  border-radius:50%;background:var(--accent);color:#141d27;font:700 11px/16px var(--kr)}
.char-acts{display:flex;gap:8px;justify-content:center;margin-top:12px}
.char-go{padding:6px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#141d27;
  font:600 12px var(--kr);cursor:pointer}
.char-cards img{width:100%;max-width:72px;aspect-ratio:1;object-fit:contain;pointer-events:none}
.char-no{padding:6px 14px;border-radius:8px;background:none;border:1px solid var(--line);
  color:var(--muted);font:12px var(--kr);cursor:pointer}
.char-no:hover{color:var(--text)}
.char-pop .sad{display:block;max-width:100%;max-height:60vh;margin:0 auto;border-radius:10px}
.char-layer{position:fixed;inset:0;pointer-events:none;z-index:50}
.char{position:absolute;left:0;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:auto;cursor:grab;
  transform-origin:50% 100%;will-change:transform;user-select:none;-webkit-user-drag:none;touch-action:none}
.char.drag{cursor:grabbing}
.char img,.char video,.char canvas{width:100%;height:100%;display:block;object-fit:contain;pointer-events:none}
.char video.src{position:absolute;width:1px;height:1px;opacity:0}
.char.bare{width:56px;height:56px}
.char.card{width:${CARD}px;height:${CARD}px;border-radius:12px;overflow:hidden;
  border:1px solid var(--line);background:var(--panel-2);box-shadow:0 4px 14px rgba(0,0,0,.35)}
.char-bubble{position:absolute;left:0;top:0;max-width:200px;padding:6px 9px;border-radius:10px;
  background:var(--panel-2);color:var(--text);border:1px solid var(--line);font:12px/1.45 var(--kr);
  box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none;opacity:0;transition:opacity .2s}
.char-bubble.on{opacity:1}
.char-bubble img{display:block;width:170px;max-width:100%;border-radius:8px;margin:1px 0 6px}
.char-bubble.shout{max-width:360px;padding:8px 12px;font:700 28px/1.25 var(--kr)}
.char-bubble.shout span{display:inline-block;animation:char-wobble .12s infinite alternate}
@keyframes char-wobble{from{transform:translate(-1px,0) rotate(-1.5deg)}to{transform:translate(1px,-1px) rotate(1.5deg)}}`;
  document.head.appendChild(css);

  /* ── 앱 데이터 (app.js 의 전역 let) ───────────── */
  function app(){
    const all = typeof items !== "undefined" ? items : [];
    const me = typeof ME !== "undefined" ? ME : "";
    return { list: all.filter(i => !me || !i.owner || i.owner === me), today: typeof TODAY !== "undefined" ? TODAY : "" };
  }
  // 오늘의 3 중 오늘 끝낸 것. 새로고침해도 남게 날짜(TODAY)별로 적어 둔다
  function doneLog(day){
    try { const d = JSON.parse(ls.get(DONE_KEY) || "{}"); if (d.day === day && Array.isArray(d.ids)) return d; } catch (_) {}
    return { day, ids: [], half: false };
  }
  function today3(){
    const { list, today } = app(), left = list.filter(i => i.today), log = doneLog(today);
    const done = log.ids.filter(id => !left.some(i => i.id === id)).length;
    return { list, left, done, total: left.length + done, log };
  }
  // 대사 한 줄. 그 캐릭터에 없는 키는 응원 중 하나로
  const line = (key, o = {}) => cur.lines[key] ? fill(cur.lines[key], o) : pick(cur.lines.cheer);
  // 오늘의 3 상황 한 줄. {rest} 는 남은 일 제목, {left} 는 남은 개수
  function status(){
    const { list, left, done, total } = today3();
    const key = !total ? (list.length ? "todayPick" : "todayEmpty") : !done ? "todayNone" : done >= total ? "todayAll" : "todaySome";
    const rest = left.slice(0, 2).map(i => quote(i.title)).join(", ") + (left.length > 2 ? ` 외 ${left.length - 2}개` : "");
    return { key, text: line(key, { n: list.length, total, done, rest, left: left.length }) };
  }
  // 지금 당장(1사분면) 중 마감이 가장 이른 것. 마감 없는 것은 뒤로
  const urgent = () => app().list.filter(i => i.q == 1).sort((a, b) => (a.due || "9") < (b.due || "9") ? -1 : 1)[0];

  /* ── 걸을 수 있는 변 ─────────────────────────── */
  // 변 하나 = 시계 방향 A -> B. t 는 0..1, 보이는 구간은 t0..t1.
  // 옆벽은 바깥에 몸 놓을 자리가 화면 안에 있을 때만, 아랫변은 아래에 칸이 없을 때만 쓴다
  function edges(){
    const br = document.getElementById("body").getBoundingClientRect();
    const W = innerWidth, H = innerHeight;
    const cells = [...document.querySelectorAll("#body .grid > .cell, #body .pinned-box")].map(c => ({ q: c.dataset.q || "p", r: c.getBoundingClientRect() }));
    const list = [];
    for (const { q, r } of cells) {
      if (r.bottom < br.top || r.top > br.bottom || r.width < SIZE) continue;
      const vt = Math.max(r.top, br.top), vb = Math.min(r.bottom, br.bottom), h = r.height || 1;
      const wall = vb - vt >= SIZE * .6;
      const add = (side, ok, ax, ay, bx, by, t0 = 0, t1 = 1) => {
        if (ok) list.push({ key: q + ":" + side, q, side, ax, ay, bx, by, len: Math.max(1, Math.hypot(bx - ax, by - ay)), t0, t1 });
      };
      add(0, r.top >= br.top && r.top <= br.bottom - 4, r.left, r.top, r.right, r.top);
      add(1, wall && r.right + SIZE <= W, r.right, r.top, r.right, r.bottom, (vt - r.top) / h, (vb - r.top) / h);
      add(3, wall && r.left - SIZE >= 0, r.left, r.bottom, r.left, r.top, (r.bottom - vb) / h, (r.bottom - vt) / h);
    }
    const fy = Math.min(br.bottom, H) - 2;
    const floor = { key: "floor", side: 0, ax: br.left + 8, ay: fy, bx: br.right - 8, by: fy, len: Math.max(1, br.width - 16), t0: 0, t1: 1 };
    const tops = list.filter(e => e.side === 0);
    list.push(floor); tops.push(floor); // 바닥(#body 맨 아래)은 늘 걷는다. 칸 아랫변 대신 여기로 떨어진다
    const map = {};
    list.forEach(e => map[e.key] = e);
    return { list, map, tops, floor, cells: list.length > 1 };
  }
  const at = (e, t) => [e.ax + (e.bx - e.ax) * t, e.ay + (e.by - e.ay) * t];

  // 변 끝에서 뛰어 갈 곳: 같은 방향 변이 틈 건너 바로 있거나(옆 칸, 아래위 칸 옆벽),
  // 윗변끼리 위아래로 가까우면 뛰어내리거나 뛰어오른다
  function hopTargets(E, e, [px, py]){
    const out = [];
    for (const o of E.list) {
      if (o.q === e.q || o.side !== e.side || o.key === "floor") continue;
      const a = at(o, o.t0), b = at(o, o.t1);
      const da = Math.hypot(a[0] - px, a[1] - py), db = Math.hypot(b[0] - px, b[1] - py);
      const [p, t, dir, d] = da <= db ? [a, o.t0, 1, da] : [b, o.t1, -1, db];
      if (d < 60 || (e.side === 0 && Math.abs(p[0] - px) < 60 && Math.abs(p[1] - py) < 400)) out.push({ key: o.key, t, dir, x: p[0], y: p[1] });
    }
    return out;
  }

  /* ── 캐릭터들 ────────────────────────────────── */
  // 여러 마리가 각자 상태, 타이머, 말풍선을 갖고 따로 움직인다. 아래 함수들은 "지금 다루는 캐릭터"
  // cur 를 쓰고, 매 프레임과 타이머와 이벤트에서 as(p, f) 로 cur 를 그 캐릭터로 맞춘 뒤 부른다
  let pets = [], cur = null, linesP = null, group = [], chatTurn = 0;
  const as = (p, f) => (...a) => { const prev = cur; cur = p; try { return f(...a); } finally { cur = prev; } };
  const alive = (p) => pets.includes(p);
  const speaker = () => pick(pets.filter(p => p.lines)); // 말할 한 마리

  function spawnAll(ids){
    group.forEach(clearTimeout); group = [];
    pets.slice().forEach(despawn);
    ids.forEach((id, i) => spawn(id, i));
    if (!pets.length) return;
    startLoop();
    Promise.all(pets.map(p => p.ready)).then(() => whenReady(0));
  }

  function spawn(id, i){
    const layer = document.createElement("div");
    layer.className = "char-layer";
    const el = document.createElement("div");
    el.className = "char";
    el.title = info(id).name;
    const img = new Image();
    img.src = eyes(id, false);
    img.alt = el.title;
    img.draggable = false;
    new Image().src = eyes(id, true); // 깜빡이거나 날 때 늦게 뜨지 않게 미리 받는다
    new Image().src = flyFace(id);
    el.appendChild(img);
    const bubble = document.createElement("div");
    bubble.className = "char-bubble";
    layer.append(el, bubble);
    // body 에는 글자 크기 zoom 이 걸려 있어 그 밖(html)에 붙인다. 좌표가 화면 px 그대로 맞는다
    document.documentElement.appendChild(layer);
    const now = performance.now();
    const me = { id, layer, el, img, bubble, lines: null, video: {}, timers: [], last: 0,
      // 마리마다 나오는 때와 자리, 앉는 때를 엇갈리게 한다
      s: { mode: "pause", until: now + i * rand(600, 1500), key: "", t: rand(.15, .85), dir: Math.random() < .5 ? 1 : -1,
           x: 0, y: 0, ang: 0, phase: 0, squash: 0, ev: 0, sitAt: now + rand(20e3, 40e3) + i * rand(4e3, 9e3),
           overText: false, textAt: 0, seg: 0, segN: 1 + Math.floor(Math.random() * 3) } };
    pets.push(me);
    linesP = linesP || fetch("characters/lines.json").then(r => r.json());
    me.ready = Promise.all([
      linesP,
      // 영상을 쓰는 캐릭터만 video.json 을 받는다(그림만 있는 캐릭터는 그 파일이 없다)
      [info(id).done, info(id).add, info(id).study, info(id).rest].flat().some(n => n && !/\.(png|jpg)$/.test(n))
        ? fetch(`characters/${id}/video.json`).then(r => r.json()).catch(() => ({})) : {},
    ]).then(([all, video]) => {
      me.lines = all[id] || { ...all.shisa, name: info(id).name }; me.video = video;
      if (me.lines.shout) me.timers.push(setTimeout(function again(){ // 보이는 동안 5~10분마다 한 번 외친다
        if (!alive(me)) return;
        as(me, shout)();
        me.timers.push(setTimeout(again, rand(5, 10) * 60e3));
      }, rand(5, 10) * 60e3));
    }).catch(() => {});
    blink(me);
    bindPointer(me);
  }

  function despawn(p){
    p.layer.remove();
    p.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    clearTimeout(p.sayTimer);
    pets = pets.filter(x => x !== p);
  }

  // 한 루프가 모든 캐릭터를 움직인다. 칸 위치는 프레임마다 한 번만 잰다
  // 다시 고를 때마다 새 루프를 돌리고 옛 루프는 다음 프레임에 스스로 멈춘다
  let loopGen = 0;
  function startLoop(){
    const gen = ++loopGen;
    requestAnimationFrame(function loop(now){
      if (gen !== loopGen || !pets.length) return;
      const E = edges();
      pets.forEach(p => as(p, tick)(now, E));
      requestAnimationFrame(loop);
    });
  }

  // 데이터가 들어오고 화면이 보일 때, 한 마리만 첫인사
  function whenReady(n){
    if (!pets.length) return;
    if ((!app().today || document.hidden) && n < 60) { group.push(setTimeout(() => whenReady(n + 1), 1000)); return; }
    const p = speaker(); if (!p) return;
    as(p, hello)();
    group.push(setTimeout(() => { const q = speaker(); if (q) as(q, lots)(); }, 9000));
  }

  // 20분마다 돌아가며 한 마리가 한 줄
  setInterval(() => {
    const ps = pets.filter(p => p.lines); if (!ps.length) return;
    as(ps[chatTurn++ % ps.length], chat)();
  }, 20 * 60e3);

  function blink(me){
    me.timers.push(setTimeout(() => {
      if (!alive(me)) return;
      const m = me.s.mode;
      if (m !== "clip" && m !== "drag" && m !== "fly" && info(me.id).blink) {
        me.img.src = eyes(me.id, true);
        setTimeout(() => { if (alive(me) && me.s.mode !== "drag" && me.s.mode !== "fly") me.img.src = eyes(me.id, false); }, 160);
      }
      blink(me);
    }, rand(2500, 5000)));
  }

  /* ── 말하기 ──────────────────────────────────── */
  // 말풍선 그림: 캐릭터 것(pics)이 있을 때만. 없으면 글만
  let flip = 0;
  function picOf(kind){
    let own = (info(cur.id).pics || {})[kind];
    if (Array.isArray(own)) own = own[flip++ % own.length];
    return own ? `characters/${cur.id}/${own}` : "";
  }
  function say(text, kind = "", big = false){
    if (!cur || !text) return;
    const me = cur, b = me.bubble, pic = kind && picOf(kind), ms = big ? 3500 : pic ? 7000 : 5000;
    pets.forEach(p => p !== me && p.bubble.classList.remove("on")); // 한 번에 한 마리만 말한다
    b.replaceChildren();
    if (pic) {
      const im = new Image();
      im.src = pic;
      im.alt = "";
      im.addEventListener("load", () => { me.side = null; }); // 그림이 뜨면 높이가 바뀌어 자리를 다시 고른다
      b.append(im);
    }
    const tx = document.createElement("span");
    tx.textContent = text;
    b.append(tx);
    b.classList.toggle("shout", big);
    b.classList.add("on");
    me.side = null;
    clearTimeout(me.sayTimer);
    me.sayTimer = setTimeout(() => b.classList.remove("on"), ms);
  }

  function hello(){
    const L = cur && cur.lines; if (!L) return;
    const h = new Date().getHours();
    const part = h >= 5 && h < 12 ? "morning" : h === 12 ? "lunch" : h > 12 && h < 18 ? "afternoon" : "evening";
    const day = app().today || new Date().toDateString();
    const first = ls.get(DAILY_KEY) !== day; // 그날 첫인사에만 그림
    if (first) ls.set(DAILY_KEY, day);
    const st = status();
    const own = info(cur.id).pics || {};
    say(`${line(part)} ${st.text}`, first && own.daily ? "daily" : own[part] ? part : st.key === "todayNone" ? "none" : "");
  }

  // 지금 당장 할 일이 5개 넘게 쌓이면 한 시간에 한 번만
  function lots(){
    const L = cur && cur.lines; if (!L || document.hidden) return false;
    const n = app().list.filter(i => i.q == 1).length, top = urgent();
    if (n < 5 || !top || Date.now() - (+ls.get(LOTS_KEY) || 0) < 3600e3) return false;
    ls.set(LOTS_KEY, String(Date.now()));
    say(line("todoTop", { title: top.title.slice(0, 30) }), "lots");
    return true;
  }

  // 20분마다 한 줄: 가장 급한 일, 오늘 마감인 일, 응원을 돌아가며
  let turn = 0;
  function chat(){
    const L = cur && cur.lines; if (!L || document.hidden || lots()) return;
    if (L.shout && Math.random() < .25 && shout()) return;
    const { list, today } = app(), top = urgent(), due = list.find(i => i.due === today);
    const opts = [
      top && (() => say(line("todoTop", { title: top.title.slice(0, 30) }))),
      due && (() => say(`${line("remind")} ${quote(due.title)}`, "remind")),
      () => say(pick(L.cheer), Math.random() < .3 ? "cheer" : ""),
    ];
    for (let k = 0; k < 3; k++) { const f = opts[(turn + k) % 3]; if (f) { turn = (turn + k + 1) % 3; return f(); } }
  }

  // 외침(우사기): 큰 말풍선이 떨리고, 몸은 부들부들 떨며 크게 뛰고 늘었다 줄었다 한다. 거꾸로는 없다
  function shout(){
    const L = cur && cur.lines; if (!L || !L.shout || document.hidden) return false;
    say(pick(L.shout), "", true);
    const s = cur.s;
    if (!still.matches) {
      s.shake = performance.now() + 1200; s.pop = 1;
      if (s.key && !s.float && (s.mode === "walk" || s.mode === "pause")) hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 36, .55);
    }
    return true;
  }

  function talk(){
    const L = cur && cur.lines; if (!L) return;
    if (L.shout && Math.random() < .25 && shout()) return;
    Math.random() < .5 ? hello() : say(pick(L.cheer), Math.random() < .3 ? "cheer" : "");
  }

  /* ── 반응 영상 ───────────────────────────────── */
  function playClip(kind, loopMs){
    if (!cur || still.matches) return;
    const s = cur.s;
    if (!["walk", "pause", "turn", "clip"].includes(s.mode)) return; // 뛰거나 날거나 끌려가는 중엔 건너뛴다
    if (s.float && kind !== "study" && kind !== "rest") return;     // 떠서 쉬는 중엔 반응 영상 대신 말만
    const me = cur, id = cur.id, c = info(id)[kind], name = Array.isArray(c) ? pick(c) : c;
    const pic = /\.(png|jpg)$/.test(name || ""), bare = /\.png$/.test(name || "");
    const sit = kind === "study" || kind === "rest";
    if (!sit && (bare || !pic) && !(name && cur.video[name])) { // 반응에 영상이 없으면: 그림을 바꿔 쓰고 통통 뛴다
      if (s.mode === "clip") return;
      if (bare) { cur.img.src = `characters/${id}/${name}`; s.face = true; }
      s.bounces = kind === "add" ? 0 : 1;
      return hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 18, .32);
    }
    if (!pic && !(name && cur.video[name])) { s.sitAt = performance.now() + rand(20e3, 40e3); return; } // 앉을 것이 없으면 건너뛴다
    s.studying = sit;
    const card = pic ? !bare : !!cur.video[name].scene; // 카드는 불투명한 그림과 영상만
    s.cw = s.ch = bare ? 56 : CARD;
    let m;
    if (pic) { // 그림: jpg 는 카드 폭을 그림 비율에 맞춘다
      m = new Image();
      m.src = `characters/${id}/${name}`;
      m.alt = ""; m.draggable = false;
      if (card) m.addEventListener("load", () => {
        s.cw = Math.round(CARD * clamp(m.naturalWidth / m.naturalHeight, 1, 1.6));
        if (m.isConnected) me.el.style.width = s.cw + "px";
      });
    } else {
      m = document.createElement("video");
      m.src = `characters/${id}/${name}.webm`;
      m.poster = `characters/${id}/${name}.png`;
      m.muted = true; m.playsInline = true; m.autoplay = true; m.loop = !!loopMs;
      m.addEventListener("ended", () => m.isConnected && as(me, stopClip)());
    }
    m.addEventListener("error", () => m.isConnected && as(me, stopClip)());
    cur.el.classList.remove("card", "bare");
    cur.el.classList.add(card ? "card" : "bare");
    cur.el.style.width = s.cw + "px"; cur.el.style.height = s.ch + "px";
    cur.el.replaceChildren(m);
    if (!pic && !card) cleanAlpha(m);
    s.mode = "clip";
    s.clipEnd = performance.now() + (loopMs || (pic ? 3500 : ((cur.video[name].duration || 8) + 1) * 1000));
  }
  // 투명 영상은 가장자리에 옅은 흰 테가 남는다. 캔버스에 옮겨 그리며 그 픽셀을 걷어 낸다:
  // 알파 110 아래는 지우고, 남은 반투명 픽셀 중 밝은 것은 알파를 세게 줄인다
  function cleanAlpha(v){
    const cv = document.createElement("canvas"), px = Math.round(CARD * (devicePixelRatio || 1));
    cv.width = cv.height = px;
    const g = cv.getContext("2d", { willReadFrequently: true });
    v.classList.add("src");
    v.after(cv);
    let last = -1;
    (function frame(){
      if (!v.isConnected) return;
      if (v.readyState >= 2 && v.currentTime !== last) {
        last = v.currentTime;
        g.clearRect(0, 0, px, px);
        g.drawImage(v, 0, 0, px, px);
        const d = g.getImageData(0, 0, px, px), a = d.data;
        for (let i = 0; i < a.length; i += 4) {
          const al = a[i + 3];
          if (al < 110) a[i + 3] = 0;
          else if (al < 255 && a[i] > 200 && a[i + 1] > 200 && a[i + 2] > 200) a[i + 3] = al * al / 255;
        }
        g.putImageData(d, 0, 0);
      }
      requestAnimationFrame(frame);
    })();
  }
  function stopClip(){
    if (!cur || cur.s.mode !== "clip") return;
    cur.el.classList.remove("card", "bare");
    cur.el.style.width = cur.el.style.height = "";
    cur.el.replaceChildren(cur.img);
    cur.s.mode = "walk";
    cur.s.studying = false;
    cur.s.sitAt = performance.now() + rand(20e3, 40e3);
  }

  function react(kind, it){
    const p = speaker(); if (!p) return;
    pets.forEach(o => o !== p && as(o, smallHop)());
    as(p, reactOne)(kind, it);
  }
  function smallHop(){
    const s = cur.s;
    if (!still.matches && !s.float && s.key && (s.mode === "walk" || s.mode === "pause")) hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 14, .35);
  }
  function reactOne(kind, it){
    const L = cur.lines, me = cur;
    if (kind === "add") {
      say("새 할 일이 들어왔어요.");
      playClip("add");
      me.timers.push(setTimeout(as(me, lots), 8000));
    }
    if (kind === "done") {
      let shown = false;
      if (it && it.today) {
        const log = doneLog(app().today);
        if (!log.ids.includes(it.id)) log.ids.push(it.id);
        ls.set(DONE_KEY, JSON.stringify(log));
        const { done, total } = today3();
        if (done >= total) { say(line("todayAll", { total })); shown = true; }
        else if (done * 2 >= total && !log.half) {
          log.half = true;
          ls.set(DONE_KEY, JSON.stringify(log));
          say(status().text); shown = true;
        }
      }
      if (!shown) say(it && Math.random() < .5 ? line("praiseDone", { titles: quote(it.title) }) : pick(L.cheer));
      playClip("done");
    }
  }

  /* ── 끌기와 던지기 ───────────────────────────── */
  function bindPointer(me){
    const el = me.el, s = me.s;
    let press = null, trail = [];
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (_) {} // 캡처가 안 되는 환경이면 그냥 이 요소 위에서만 받는다
      press = { x: e.clientX, y: e.clientY, drag: false };
      trail = [];
    });
    el.addEventListener("pointermove", as(me, (e) => {
      if (!press) return;
      if (!press.drag && !still.matches && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) {
        press.drag = true;
        stopClip();
        s.float = false;
        s.mode = "drag";
        s.ang = ((s.ang % 360) + 540) % 360 - 180;
        el.classList.add("drag");
        me.img.src = flyFace(me.id);
      }
      if (!press.drag) return;
      const now = performance.now();
      s.x = e.clientX; s.y = e.clientY + SIZE / 2;
      trail.push([now, s.x, s.y]);
      while (trail.length > 2 && now - trail[0][0] > 100) trail.shift();
    }));
    const up = as(me, (e) => {
      if (!press) return;
      const was = press; press = null;
      if (!was.drag) {
        if (e.type === "pointerup") { if (s.mode === "clip" && s.studying) stopClip(); talk(); }
        return;
      }
      el.classList.remove("drag");
      const a = trail[0], b = trail[trail.length - 1], dt = a && b ? (b[0] - a[0]) / 1000 : 0;
      const v = e.type === "pointerup" && dt > .01 ? [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt] : [0, 0];
      if (Math.hypot(v[0], v[1]) < 200 && emptyAt(s.x, s.y - SIZE / 2)) return float();
      fly(clamp(v[0], -2500, 2500), clamp(v[1], -2500, 2500));
      if (Math.random() < .3) shout(); // 던지면 가끔 외친다
    });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function fly(vx, vy){
    const s = cur.s;
    s.mode = "fly"; s.vx = vx; s.vy = vy; s.ft = 0; s.float = false;
    cur.img.src = flyFace(cur.id);
    s.ang = ((s.ang % 360) + 540) % 360 - 180;
  }

  // 빈 자리(글자도 칸도 없는 곳)에 떠서 쉬는 모습을 한동안 보인다. 끝나면 가까운 변으로 내려간다
  function float(){
    const s = cur.s;
    s.float = true; s.drop = false; s.key = "float"; s.ang = 0; s.mode = "pause"; s.until = Infinity;
    cur.img.src = eyes(cur.id, false);
    rest(rand(10e3, 25e3));
    if (s.mode !== "clip") s.until = performance.now() + rand(4e3, 8e3); // 쉬는 그림이 없으면 잠깐만
  }
  function rest(ms){
    const c = info(cur.id), h = new Date().getHours(), nap = c.rest && ((c.night && (h >= 19 || h < 6)) || Math.random() < .3);
    playClip(nap ? "rest" : "study", ms);
  }

  function hop(to, h, dur){
    const s = cur.s;
    const a1 = sideOf(to.key) * 90;
    s.mode = "hop"; s.hopP = 0;
    if (info(cur.id).hop && !s.face) cur.img.src = `characters/${cur.id}/${info(cur.id).hop}`;
    s.hop = { fx: s.x, fy: s.y, ...to, h, dur, n: N[sideOf(s.key)], a0: s.ang, a1: s.ang + (((a1 - s.ang) % 360) + 540) % 360 - 180 };
  }
  const sideOf = (key) => key === "floor" ? 0 : +String(key).split(":")[1] || 0;

  // 바닥에서 쉬다가: 가장 가까운 옆벽 아래 끝으로 뛰어올라 벽을 타고 칸 위로 간다
  function climb(E){
    const s = cur.s;
    let best = null;
    for (const o of E.list) {
      if (o.side !== 1 && o.side !== 3) continue;
      const t = o.side === 1 ? o.t1 : o.t0, [x, y] = at(o, t), d = Math.hypot(x - s.x, y - s.y);
      if (!best || d < best.d) best = { d, key: o.key, t, dir: o.side === 1 ? -1 : 1, x, y };
    }
    if (!best) return backToCells(E);
    hop(best, 40, .5 + best.d / 900);
  }

  // 가장 가까운 윗변(바닥 포함)으로 뛰어간다. 허공에서 쉬고 난 뒤에 쓴다
  function backToCells(E){
    const s = cur.s;
    let best = null;
    s.key = "floor"; // 뛰어오르는 방향(위)을 바닥 기준으로
    for (const o of E.tops) {
      const x = clamp(s.x, o.ax + SIZE / 2, o.bx - SIZE / 2), d = Math.hypot(x - s.x, o.ay - s.y);
      if (!best || d < best.d) best = { d, key: o.key, t: (x - o.ax) / o.len, dir: s.dir, x, y: o.ay };
    }
    hop(best, 40, .5 + best.d / 900);
  }

  /* ── 매 프레임 ───────────────────────────────── */
  function tick(now, E){
    const dt = Math.min(.05, (now - (cur.last || now)) / 1000); cur.last = now;
    const s = cur.s;
    let e = E.map[s.key];

    if (still.matches) { // 움직임 줄이기: 첫 윗변의 오른쪽 끝에 나란히 서 있기만 한다
      e = E.tops[0]; s.key = e.key; s.dir = -1; s.ang = 0; s.mode = "walk";
      [s.x, s.y] = at(e, Math.max(0, 1 - SIZE * (pets.indexOf(cur) + 1) / e.len));
      return draw(E, now, false);
    }
    if (!e && !s.key) { // 처음 나올 때: 아무 윗변의 아무 곳
      e = pick(E.tops); s.key = e.key; s.t = rand(.2, .8);
    }
    if (s.float && s.mode === "walk") { s.float = false; backToCells(E); } // 다 쉬었으면 내려간다
    const onEdge = !s.float && ["walk", "pause", "turn", "clip"].includes(s.mode);
    if (onEdge && !e) { if (s.mode === "clip") stopClip(); fly(0, 0); } // 밟던 변이 사라졌다(탭 이동, 스크롤): 떨어진다
    const typing = !!document.activeElement && document.activeElement.matches("input, textarea, select, [contenteditable]");

    if (s.mode === "walk" && e && typing) {
      s.sitAt += dt * 1000; // 입력하는 동안은 가만히 있는다
    } else if (s.mode === "walk" && e) {
      s.t += s.dir * SPEED * dt / e.len;
      s.phase += dt / STEP;
      if (s.t > e.t1 || s.t < e.t0) edgeEnd(E, e);
      else if (s.wantPause && !s.overText) { // 변 1~3개마다 글자 없는 자리에서 4~12초 멈춘다
        s.wantPause = false; s.mode = "pause"; s.until = now + rand(4e3, 12e3);
      } else if (now > s.ev) { // 가끔 제자리에서 뛴다
        s.ev = now + rand(4e3, 9e3);
        if (Math.random() < .25) hop({ key: s.key, t: s.t, dir: s.dir, ...xy(at(e, s.t)) }, 14, .35);
      }
      if (s.mode === "walk" && now > (s.bumpAt || 0)) { // 먼저 온 캐릭터와 같은 자리면 나중 쪽이 돌아서거나 비켜 뛴다
        const o = pets.slice(0, pets.indexOf(cur)).find(o => o.s.key === s.key && !o.s.float && Math.abs(o.s.t - s.t) * e.len < SIZE * .8);
        if (o) {
          s.bumpAt = now + 1500;
          if (Math.random() < .3) hop({ key: s.key, t: s.t, dir: s.dir, ...xy(at(e, s.t)) }, 22, .4); else s.dir = -s.dir;
        }
      }
      if (s.mode === "walk" && s.key === "floor" && E.cells && now > (s.climbAt || 0)) climb(E);
      else if (s.mode === "walk" && now > s.sitAt && !s.cardText && s.t > e.t0 + .05 && s.t < e.t1 - .05) {
        rest(rand(20e3, 60e3)); // 앉아서 공부(가끔은 rest, night 이면 19시 뒤엔 늘): 글자 없는 자리에서만
      }
    } else if (s.mode === "pause" && now > s.until) s.mode = "walk";
    else if (s.mode === "turn") {
      s.turnP = Math.min(1, s.turnP + dt / .25);
      s.ang = s.ang0 + s.dir * 90 * (1 - Math.cos(Math.PI * s.turnP)) / 2;
      if (s.turnP >= 1) { s.ang = s.ang0 + s.dir * 90; s.mode = !s.overText && Math.random() < .3 ? "pause" : "walk"; s.until = now + rand(1000, 2500); }
    } else if (s.mode === "clip") {
      if (now > s.clipEnd) stopClip();
    } else if (s.mode === "hop") {
      const H = s.hop;
      s.hopP = Math.min(1, s.hopP + dt / H.dur);
      const p = s.hopP, arc = 4 * H.h * p * (1 - p);
      s.x = H.fx + (H.x - H.fx) * p + H.n[0] * arc;
      s.y = H.fy + (H.y - H.fy) * p + H.n[1] * arc;
      s.ang = H.a0 + (H.a1 - H.a0) * p;
      if (p >= 1) {
        s.key = H.key; s.t = H.t; s.dir = H.dir; s.mode = "walk"; s.squash = 1;
        if (s.key === "floor") s.climbAt = now + rand(6e3, 15e3);
        if (s.bounces > 0) { s.bounces--; hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 18, .32); }
        else { s.face = false; cur.img.src = eyes(cur.id, false); } // 뛰는 그림이나 반응 그림에서 원래 모습으로
      }
    } else if (s.mode === "fly") {
      s.vy += G * dt;
      const py = s.y;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const W = innerWidth;
      if (s.x < SIZE / 2) { s.x = SIZE / 2; s.vx = Math.abs(s.vx) * .6; }
      if (s.x > W - SIZE / 2) { s.x = W - SIZE / 2; s.vx = -Math.abs(s.vx) * .6; }
      if (s.y < SIZE && s.vy < 0) { s.y = SIZE; s.vy = -s.vy * .4; }
      s.ft += dt;
      s.ang += (0 - s.ang) * Math.min(1, dt * 10);
      if (!s.drop && s.vy > 0 && s.ft > .25 && emptyAt(s.x, s.y - SIZE / 2)) { float(); s.squash = 1; } // 빈 자리면 떨어지지 않고 떠서 쉰다
      else if (s.vy > 0) {
        const land = E.tops.find(o => py <= o.ay && s.y >= o.ay && s.x >= o.ax - SIZE / 4 && s.x <= o.bx + SIZE / 4);
        if (land) {
          s.key = land.key; s.t = clamp((s.x - land.ax) / land.len, 0, 1); s.y = land.ay; s.ang = 0;
          s.dir = s.vx < 0 ? -1 : 1; s.mode = "walk"; s.squash = 1; s.drop = false;
          if (s.key === "floor") s.climbAt = now + rand(6e3, 15e3);
          cur.img.src = eyes(cur.id, false);
        } else if (s.y >= E.floor.ay) { // 바닥 밖으로 떨어졌으면 바닥 끝에 세운다
          s.key = "floor"; s.y = E.floor.ay; s.x = clamp(s.x, E.floor.ax, E.floor.bx); s.t = (s.x - E.floor.ax) / E.floor.len;
          s.ang = 0; s.squash = 1; s.mode = "walk"; s.drop = false; s.climbAt = now + rand(6e3, 15e3);
          cur.img.src = eyes(cur.id, false);
        }
      }
    }
    if (!s.float && ["walk", "pause", "turn", "clip"].includes(s.mode) && (e = E.map[s.key])) [s.x, s.y] = at(e, clamp(s.t, 0, 1));
    s.squash = Math.max(0, s.squash - dt * 5);
    s.pop = Math.max(0, (s.pop || 0) - dt * 2.5);
    draw(E, now, s.mode === "walk");
  }
  const xy = ([x, y]) => ({ x, y });

  // 변 끝에 닿았을 때: 모서리를 돌거나, 틈을 뛰어 건너거나, 돌아선다
  function edgeEnd(E, e){
    const s = cur.s;
    s.t = clamp(s.t, e.t0, e.t1);
    if (++s.seg >= s.segN) { s.seg = 0; s.segN = 1 + Math.floor(Math.random() * 3); s.wantPause = true; }
    const corner = s.dir > 0 ? e.t1 >= 1 : e.t0 <= 0;
    const next = e.key !== "floor" && E.map[e.q + ":" + ((e.side + s.dir + 4) % 4)];
    if (corner && next && (s.dir > 0 ? next.t0 <= 0 : next.t1 >= 1) && Math.random() < .85) {
      s.key = next.key; s.t = s.dir > 0 ? 0 : 1;
      s.mode = "turn"; s.turnP = 0; s.ang0 = s.ang;
      return;
    }
    const to = hopTargets(E, e, at(e, s.t));
    if (to.length && Math.random() < .8) {
      const o = pick(to), d = Math.hypot(o.x - s.x, o.y - s.y);
      return hop(o, clamp(18 + d * .2, 18, 60), .35 + d / 700);
    }
    // 옆벽을 타고 내려와 칸 아래 모서리에 닿았다: 아랫변은 걷지 않고 아래로 떨어진다
    if (corner && ((e.side === 1 && s.dir > 0) || (e.side === 3 && s.dir < 0))) {
      s.drop = true;
      return fly(N[e.side][0] * 40, 0);
    }
    s.dir = -s.dir;
  }

  function draw(E, now, walking){
    const s = cur.s, el = cur.el, W = innerWidth, H = innerHeight;
    const jx = now < (s.shake || 0) ? rand(-3, 3) : 0, jy = now < (s.shake || 0) ? rand(-3, 3) : 0; // 외칠 때 떨림
    const pop = Math.sin(Math.PI * (s.pop || 0)); // 외칠 때 늘었다 줄었다
    let cx, cy, half;
    if (s.mode === "clip") { // 영상 카드는 똑바로 세워 변 바깥쪽에 붙인다
      const n = N[sideOf(s.key)], hw = s.cw / 2, hh = s.ch / 2;
      half = hh;
      cx = clamp(s.x + n[0] * (hw + 2), hw, W - hw);
      cy = clamp(s.y + n[1] * (hh + 2), hh, H - hh);
      el.style.transform = `translate(${cx - hw + jx}px,${cy - hh + jy}px)`;
    } else {
      const sw = Math.sin(Math.PI * s.phase);
      const tilt = walking ? 8 * sw : s.mode === "fly" ? clamp(s.vx / 50, -25, 25) : 0;
      const bob = walking ? 5 * Math.abs(sw) : 0;
      const q = Math.max(walking ? Math.max(0, 1 - Math.abs(sw) / .3) : 0, s.squash); // 발 디딜 때 살짝 눌린다
      el.style.transform = `translate(${s.x - SIZE / 2 + jx}px,${s.y - SIZE + jy}px) rotate(${s.ang}deg) translateY(${-bob}px) ` +
        `rotate(${tilt}deg) scale(${((s.dir < 0) !== !!info(cur.id).faceLeft && !s.face ? -1 : 1) * (1 + .06 * q - .12 * pop)},${1 - .08 * q + .22 * pop})`;
      const a = s.ang * Math.PI / 180;
      half = SIZE / 2;
      cx = s.x + Math.sin(a) * half; cy = s.y - Math.cos(a) * half;
    }

    // 글자 위인지는 150ms 마다 잰다. 카드를 펼칠 자리도 같이 본다
    if (now - s.textAt > 150) {
      s.textAt = now;
      s.overText = textAt(cx, cy);
      const n = N[sideOf(s.key)];
      s.cardText = s.mode === "clip" ? false : [[0, 0], [-.6, -.6], [.6, .6], [.6, -.6], [-.6, .6]]
        .some(([u, v]) => textAt(s.x + n[0] * (CARD / 2 + 2) + u * CARD / 2, s.y + n[1] * (CARD / 2 + 2) + v * CARD / 2));
    }

    // 말풍선: 위아래 중 글자가 적은 쪽(같으면 위), 화면 안으로
    const b = cur.bubble;
    if (b.classList.contains("on")) {
      const bw = b.offsetWidth, bh = b.offsetHeight, bx = clamp(cx - bw / 2, 4, W - bw - 4);
      const upY = cy - half - bh - 8, downY = cy + half + 8;
      if (cur.side == null) {
        const cnt = (y) => [[.15, .25], [.5, .25], [.85, .25], [.15, .75], [.5, .75], [.85, .75]]
          .filter(([u, v]) => textAt(bx + u * bw, y + v * bh)).length;
        cur.side = upY < 4 ? "down" : downY + bh > H - 4 ? "up" : cnt(downY) < cnt(upY) ? "down" : "up";
      }
      b.style.transform = `translate(${bx}px,${clamp(cur.side === "up" ? upY : downY, 4, H - bh - 4)}px)`;
    }
  }

  // 그 점이 빈 자리인가: 맨 위 요소가 #body 바탕이나 칸 사이 틈(글자도 칸도 아님)
  function emptyAt(x, y){
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    for (const e of document.elementsFromPoint(x, y)) {
      if (e.closest(".char-layer")) continue;
      return e.id === "body" || e.classList.contains("grid");
    }
    return false;
  }

  // 그 점의 맨 위 요소가 #body 안의 글자(항목, 제목)인가. 캐릭터 자신과 말풍선은 건너뛴다
  function textAt(x, y){
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    for (const e of document.elementsFromPoint(x, y)) {
      if (e.closest(".char-layer")) continue;
      return !!(e.closest("li, h2, h3, .notice") && e.closest("#body"));
    }
    return false;
  }

  /* ── 캐릭터 고르기 창 ────────────────────────── */
  // 톱니 단추나, 30일 동안 안 띄웠으면 페이지를 열 때 저절로 뜬다. 카드는 눌러서 여러 마리를 고르고
  // "같이 일하기"로 저장한다. "필요 없어"는 다 빼고 저장, Esc나 바깥을 누르면 저장 없이 닫는다.
  // 저장 값은 쉼표로 이은 id 목록이다(예전의 한 마리 값도 그대로 읽힌다)
  const chosen = () => (ls.get(KEY) || "").split(",").filter(id => info(id));
  let modal = null, back = null;
  function openPicker(){
    if (modal) return;
    ls.set(ASKED_KEY, new Date().toISOString().slice(0, 10)); // 그냥 닫아도 다음 열 때 또 뜨지 않게
    const now = chosen();
    back = document.activeElement;
    new Image().src = "characters/reactions/no_thanks.png"; // 「필요 없어」 그림을 미리 받아 둔다
    modal = document.createElement("div");
    modal.className = "char-modal";
    modal.innerHTML = `<div class="char-pop" role="dialog" aria-modal="true" aria-labelledby="char-pop-h">
      <h2 id="char-pop-h">같이 일할 캐릭터 고르기</h2>
      <div class="char-cards">${CHARS.map(c =>
        `<button type="button" data-v="${c.id}" aria-pressed="${now.includes(c.id)}"><img src="${eyes(c.id, false)}" alt="">${c.name}</button>`).join("")}</div>
      <div class="char-acts"><button type="button" class="char-go">같이 일하기</button>
        <button type="button" class="char-no">필요 없어</button></div></div>`;
    modal.addEventListener("click", (e) => {
      if (modal.classList.contains("bye")) return;
      if (e.target === modal) return closePicker();
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.v) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
      else if (b.classList.contains("char-go")) {
        const ids = [...modal.querySelectorAll('.char-cards button[aria-pressed="true"]')].map(x => x.dataset.v);
        ls.set(KEY, ids.join(","));
        spawnAll(ids);
        closePicker();
      } else noThanks();
    });
    modal.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!modal.classList.contains("bye")) closePicker(); }
      if (e.key !== "Tab") return;
      const bs = [...modal.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === bs.length - 1) { e.preventDefault(); bs[e.shiftKey ? bs.length - 1 : 0].focus(); }
    });
    document.documentElement.appendChild(modal);
    modal.querySelector(".char-cards button").focus();
  }
  function closePicker(){
    if (!modal) return;
    modal.remove(); modal = null;
    if (back && back.focus) back.focus();
  }
  // 필요 없어: 저장하고, 우는 하치와레를 잠깐 보여 준 뒤 사라진다
  function noThanks(){
    ls.set(KEY, "");
    spawnAll([]);
    const m = modal;
    m.classList.add("bye");
    m.querySelector(".char-pop").innerHTML = `<img class="sad" src="characters/reactions/no_thanks.png" alt="우는 하치와레">`;
    const im = m.querySelector(".sad"), go = () => setTimeout(() => {
      m.classList.add("out"); setTimeout(() => { if (modal === m) closePicker(); }, 300);
    }, 1500); // 그림이 뜬 뒤부터 1.5초
    im.complete ? go() : (im.onload = im.onerror = go);
  }

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "iconbtn";
  gear.title = "환경설정";
  gear.setAttribute("aria-label", "환경설정");
  gear.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke-width="3.5" stroke-dasharray="3.534 3.534"/><circle cx="12" cy="12" r="6" stroke-width="3"/></svg>`;
  gear.addEventListener("click", openPicker);
  const reload = document.getElementById("reload");
  reload.parentNode.insertBefore(gear, reload);

  spawnAll(chosen());
  // 저장이 안 되는 브라우저(개인정보 보호 모드 등)에는 저절로 띄우지 않는다. 열 때마다 뜨게 된다
  const storable = (() => { try { localStorage.setItem("ulick.t", "1"); localStorage.removeItem("ulick.t"); return true; } catch (_) { return false; } })();
  const asked = Date.parse(ls.get(ASKED_KEY) || "");
  if (storable && !(Date.now() - asked < 30 * 864e5)) openPicker();

  window.Chars = { react };
})();
