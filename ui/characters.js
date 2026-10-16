/* 캐릭터 보기 (웹판만). 그림, 영상, 대사는 시사(cheo0y/shisa-agent)에서 가져왔고,
   치이카와와 농담곰 그림은 박성준이 따로 줬다.
   ui/characters/NOTICE.md 참고.

   - 고르기: 위 막대의 톱니 단추로 여는 창. 30일 동안 안 띄웠으면 페이지를 열 때 저절로 뜬다.
     여러 마리를 같이 고를 수 있다(쉼표로 이은 id 목록). 고르지 않은 사람 화면은 그대로다. 고른 값은 각자 브라우저(localStorage)에만 남는다. 업무 데이터가 아니라 화면 설정이다
   - 걷기: 매트릭스 탭에서는 사분면 칸과 "오늘 끝낼 것" 상자 테두리를 상자 위 벌레처럼 돈다.
     윗변과 바깥에 자리가 있는 옆벽을 걷고, 모서리에서 돌고, 틈은 뛰어 건넌다. 아랫변은 걷지
     않고 바닥(#body 맨 아래)으로 떨어졌다가 조금 뒤 옆벽으로 뛰어올라 다시 올라간다.
     변 1~2개마다 8~20초 쉬고, 12~25초 걸으면 30~90초 앉아 공부(또는 쉼)한다. 여럿이면 절반 남짓만 움직인다.
     입력칸에 글을 쓰는 동안은 가만히 있는다. 칸 위치는 매 프레임 다시 잰다
   - 글씨를 가리지 않는다: 움직이는 동안은 지나가도 되지만, 멈추는 것(쉬기, 앉기, 반응, 입력 중 기다리기)은
     몸 전체가 글자 요소와 안 겹치는 자리에서만 한다(free()). 큰 동작은 그 크기만큼 빈 자리로 옮겨 가서 하고,
     멈춘 뒤에도 0.5초마다 다시 봐서 밑에 글자가 생기면 비킨다. 말풍선은 글자를 가장 덜 덮는 쪽에.
     흐려지지는 않는다(2026-10-16 박성준 결정)
   - 끌어서 던지기: 누른 채 끌면 따라오고, 놓으면 날아가 처음 닿는 칸 윗변이나 바닥에 선다.
     빈 자리(글자도 칸도 없는 곳)에 놓거나 떨어지면 거기 떠서 한동안 쉬다가 가까운 변으로 간다.
     끌지 않고 짧게 누르면 말을 건다
   - 여러 마리: 각자 따로 움직이고, 말은 한 번에 한 마리만 한다(말풍선이 겹치지 않는다).
     반응은 한 마리가 영상과 말로, 나머지는 살짝 뛴다. 같은 자리에 서면 나중 쪽이 비킨다
   - 성격: 혼자 말하는 간격이 캐릭터마다 다르다(talk). 우사기는 대개 알 수 없는 소리를 하고 가끔 큰 말풍선으로
     외치며, 3~6분마다 아래 막대 위를 질주한다. 랏코는 모서리 사이를 샥샥 옮겨 다니고(잔상), 모몽가는 포인터를
     피해 뛰고, 치이카와는 포인터가 오면 떨며 물러선다
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
  // talk: 혼자 말하는 간격(분). sprint, cornerDash, dodge, scared: 성격 동작(아래 「성격」 절)
  // scale, foot: 보이는 몸 크기를 랏코에 맞춘 배율과 그림 아래 빈 여백(비율). eyes_open.png 의 알파 상자로
  //   쟀다(높이 비 0.6, 폭 비 0.4 가중). 몸 그림과 투명한 영상에 같이 쓰고, 카드 그림에는 안 쓴다
  // scale: 2026-10-16 박성준이 size-tuner 로 「키」가 비슷해 보이게 눈으로 맞춘 값 (넓이나 얼굴 폭으로 맞추면 오히려 어색했다)
  const CHARS = [
    { id: "shisa",   name: "시사",     scale: 1.08, foot: 0.107, talk: [10, 15], blink: true,  done: "dance", add: "studying", study: "studying" },
    { id: "hachi",   name: "하치와레", scale: 1.01, foot: 0.037, talk: [6, 10], blink: true,  faceLeft: true, done: "cheer", add: "plan", study: "study" },
    // faceLeft (하치와레, 랏코): 그림이 왼쪽을 보고 있어 오른쪽으로 걸을 때 뒤집는다
    { id: "rakko",   name: "랏코",     scale: 0.94, foot: 0.035, talk: [15, 25], cornerDash: true, blink: true,  faceLeft: true, done: "dance", add: "plan", study: "study" },
    { id: "momonga", name: "모몽가",   scale: 0.97, foot: 0.035, talk: [6, 10], dodge: true, blink: true,  done: "dance", add: "plan", study: "study" },
    { id: "usagi",   name: "우사기",   scale: 1.39, foot: 0.096, talk: [2, 4], sprint: true, blink: false, done: ["cheer", "dance"], add: "plan", study: "study" },
    { id: "chiikawa", name: "치이카와", scale: 0.83, talk: [15, 25], scared: true, blink: false, done: null, add: "plan.jpg", study: "study.jpg",
      fly: "fly.png", hop: "hop.png", rest: "sleep.png", night: true,
      pics: { daily: "greet.jpg", lots: "lots.jpg", none: "cheer.jpg", remind: "cheer.jpg" } },
    { id: "jokebear", name: "농담곰", scale: 0.87, talk: [12, 18], blink: false, done: "dance.png", add: null, study: "study.jpg",
      fly: "fly.png", hop: "hop.png", rest: "sit.png",
      pics: { lunch: "lunch.jpg", evening: "evening.jpg", lots: "lots.jpg", none: ["gloom.jpg", "cannot.jpg"] } },
  ];
  const info = (id) => CHARS.find(c => c.id === id);
  const eyes = (id, closed) => `characters/${id}/${closed && info(id).blink ? "eyes_closed" : "eyes_open"}.png`;
  const flyFace = (id) => info(id).fly ? `characters/${id}/${info(id).fly}` : eyes(id, true);
  const KEY = "ulick.character";
  const ASKED_KEY = "ulick.character.asked", DAILY_KEY = "ulick.character.daily", DONE_KEY = "ulick.character.today3", LOTS_KEY = "ulick.character.lots";
  const MIN = 60e3; // 성격 타이머(말하기, 질주, 샥샥샥)의 1분
  const SIZE = 40, CARD = 84, SPEED = 29, STEP = .5, G = 1800; // px(기준 크기), px, px/s, 걸음 초, px/s²
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
.char.dash::before{content:"";position:absolute;left:-14px;top:38%;width:16px;height:2px;border-radius:1px;
  background:var(--muted);box-shadow:-6px 8px 0 var(--muted),-2px -8px 0 var(--muted);opacity:.85}
.char-ghost{opacity:.45;transition:opacity .3s;pointer-events:none!important}
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
    const fy = Math.min(br.bottom, H) - 8; // 그림 아래 여백까지 #body 안에 들게 조금 올린다
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
  let pets = [], cur = null, linesP = null, group = [];
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
    const now = performance.now(), size = Math.round(SIZE * scaleOf(id));
    el.style.width = el.style.height = size + "px";
    const me = { id, layer, el, img, bubble, lines: null, video: {}, timers: [], last: 0, size, foot: Math.round((info(id).foot || 0) * size),
      // 마리마다 나오는 때와 자리, 앉는 때를 엇갈리게 한다
      s: { mode: "pause", until: now + i * rand(600, 1500), key: "", t: rand(.15, .85), dir: Math.random() < .5 ? 1 : -1,
           x: 0, y: 0, ang: 0, phase: 0, squash: 0, ev: 0, sitAt: now + rand(12e3, 25e3) + i * rand(4e3, 9e3),
           seg: 0, segN: 1 + Math.floor(Math.random() * 2) } };
    pets.push(me);
    linesP = linesP || fetch("characters/lines.json").then(r => r.json());
    me.ready = Promise.all([
      linesP,
      // 영상을 쓰는 캐릭터만 video.json 을 받는다(그림만 있는 캐릭터는 그 파일이 없다)
      [info(id).done, info(id).add, info(id).study, info(id).rest].flat().some(n => n && !/\.(png|jpg)$/.test(n))
        ? fetch(`characters/${id}/video.json`).then(r => r.json()).catch(() => ({})) : {},
    ]).then(([all, video]) => {
      me.lines = all[id] || { ...all.shisa, name: info(id).name }; me.video = video;
      chatter(me);
      if (me.lines.shout) every(me, [5, 10], () => shout(true)); // 보이는 동안 5~10분마다 한 번 외친다
      if (info(id).sprint) every(me, [3, 6], sprint);
      if (info(id).cornerDash) every(me, [1.5, 4], cornerDash);
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
      textCache = null; // 글자 자리는 프레임마다 새로 잰다
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

  // 혼자 하는 한 줄: 가장 급한 일, 오늘 마감인 일, 응원을 돌아가며. 우사기는 대개 알 수 없는 소리
  let turn = 0;
  function chat(){
    const L = cur && cur.lines; if (!L || document.hidden || lots()) return;
    if (L.shout && Math.random() < .25 && shout()) return;
    if (L.nonsense && Math.random() < .7) return say(pick(L.nonsense));
    const { list, today } = app(), top = urgent(), due = list.find(i => i.due === today);
    const opts = [
      top && (() => say(line("todoTop", { title: top.title.slice(0, 30) }))),
      due && (() => say(`${line("remind")} ${quote(due.title)}`, "remind")),
      () => say(pick(L.cheer), Math.random() < .3 ? "cheer" : ""),
    ];
    for (let k = 0; k < 3; k++) { const f = opts[(turn + k) % 3]; if (f) { turn = (turn + k + 1) % 3; return f(); } }
  }

  // 외침(우사기): 큰 말풍선이 떨리고, 몸은 부들부들 떨며 크게 뛰고 늘었다 줄었다 한다. 거꾸로는 없다
  function shout(polite){
    const L = cur && cur.lines; if (!L || !L.shout || document.hidden || (polite && othersTalking())) return false;
    say(pick(L.shout), "", true);
    const s = cur.s;
    if (!still.matches && s.key && (s.mode === "walk" || s.mode === "pause")) { // 크게 뛰는 몸짓은 빈 자리에서만
      const pose = () => { s.shake = performance.now() + 1200; s.shakeA = 3; s.pop = 1; hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 36, .55); };
      atSpot(cur.size * 2, cur.size * 2, pose, smallHop);
    }
    return true;
  }

  function talk(){
    const L = cur && cur.lines; if (!L) return;
    if (L.shout && Math.random() < .25 && shout()) return;
    if (L.nonsense && Math.random() < .6) return say(pick(L.nonsense));
    Math.random() < .5 ? hello() : say(pick(L.cheer), Math.random() < .3 ? "cheer" : "");
  }

  /* ── 글자 자리 ───────────────────────────────── */
  // 대원칙: 움직이는 동안은 글자 위를 지나가도 되지만, 멈출 때는 몸 전체가 글자와 안 겹치는 자리에서만.
  // 글자 자리 = #body 안의 글자 요소 사각형 + #body 밖 전부(위 막대, 탭, 필터 줄, 아래 링크).
  // 사각형은 프레임마다 한 번 잰다(loop 가 textCache 를 비운다)
  const TEXT = "li, h1, h2, h3, h4, .notice, button, input, select, textarea, label, a";
  let textCache = null;
  function texts(){
    if (textCache) return textCache;
    const br = document.getElementById("body").getBoundingClientRect();
    const rs = [...document.querySelectorAll(`#body :is(${TEXT})`)].map(e => e.getBoundingClientRect())
      .filter(r => r.width && r.height && r.bottom > br.top && r.top < br.bottom);
    return textCache = { br, rs };
  }
  const overlap = (a, r) => Math.max(0, Math.min(a[2], r.right) - Math.max(a[0], r.left)) * Math.max(0, Math.min(a[3], r.bottom) - Math.max(a[1], r.top));
  const quiet = (p) => p.s.mode === "pause" || p.s.mode === "clip";
  // 빈 자리인가: 글자와 안 겹치고, #body 안이고, 멈춰 있는 다른 캐릭터 자리와도 안 겹친다
  function free(a){
    const { br, rs } = texts();
    if (a[0] < br.left || a[2] > br.right || a[1] < br.top || a[3] > Math.min(br.bottom, innerHeight)) return false;
    const R = (b) => ({ left: b[0], top: b[1], right: b[2], bottom: b[3] });
    return !rs.some(r => overlap(a, r) > 0) && !pets.some(p => p !== cur && p.fp && quiet(p) && overlap(a, R(p.fp)) > 0);
  }
  // 그 사각형이 덮는 글자 넓이 (#body 밖도 글자로 친다). 말풍선 자리를 고를 때 쓴다
  function cover(a){
    const { br, rs } = texts();
    return rs.reduce((n, r) => n + overlap(a, r), 0) + (a[2] - a[0]) * (a[3] - a[1]) - overlap(a, br);
  }
  // 변 위 한 점에서 바깥(n) 쪽으로 붙인 w×h 상자(똑바로 선 사각형)
  function boxAt(x, y, n, w, h){
    const cx = x + n[0] * (w / 2 + 2), cy = y + n[1] * (h / 2 + 2);
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
  }
  const normal = () => N[cur.s.float ? 0 : sideOf(cur.s.key)];
  // 지금 몸이 차지하는 자리(영상이나 카드를 띄웠으면 그 크기)
  function footprint(){
    const s = cur.s, clip = s.mode === "clip";
    return boxAt(s.x, s.y, normal(), clip ? s.cw : cur.size, clip ? s.ch : cur.size);
  }
  // 가장 가까운 빈 자리(w×h 상자의 가운데). 없으면 null
  function findSpot(w, h, ok = () => true){
    const { br } = texts(), s = cur.s, out = [];
    for (let y = br.top + h / 2 + 2; y <= Math.min(br.bottom, innerHeight) - h / 2 - 2; y += 20)
      for (let x = br.left + w / 2 + 2; x <= br.right - w / 2 - 2; x += 20) out.push([x, y, Math.hypot(x - s.x, y - s.y)]);
    out.sort((a, b) => a[2] - b[2]);
    const p = out.find(([x, y]) => ok([x, y]) && free([x - w / 2, y - h / 2, x + w / 2, y + h / 2]));
    return p ? [p[0], p[1]] : null;
  }

  // 멈추기: 지금 자리가 비었으면 바로, 아니면 걸으면서 빈 자리를 찾아 거기서 멈춘다(8초 못 찾으면 빈 자리로 떠 간다)
  function stop(ms){
    const s = cur.s;
    if (free(footprint())) { s.mode = "pause"; s.until = performance.now() + ms; s.seek = 0; return; }
    s.seek = ms; s.seekUntil = performance.now() + 8000;
  }
  // 큰 동작은 그 크기만큼 빈 자리에서. 지금 자리가 안 되면 가장 가까운 빈 자리로 떠 가서 하고,
  // 빈 자리가 없으면 none()(말풍선과 작은 뜀만)
  function atSpot(w, h, act, none){
    const s = cur.s;
    if (free(boxAt(s.x, s.y, normal(), w, h))) return act();
    const p = findSpot(w, h);
    if (!p) return none();
    const fx = p[0], fy = p[1] + h / 2 + 2; // 상자 아래 가운데가 발
    s.float = false;
    hop({ key: "float", t: 0, dir: s.dir, x: fx, y: fy }, 30, .45 + Math.hypot(fx - s.x, fy - s.y) / 900, () => {
      s.float = true; s.mode = "pause"; s.until = performance.now() + 3000;
      act();
    });
  }

  /* ── 반응 영상과 그림 ────────────────────────── */
  const scaleOf = (id) => info(id).scale || 1;
  // 그 동작에 쓸 것. small 은 몸 그림만 바꿔 뛰는 반응(png), 나머지는 카드나 테두리 없는 큰 그림
  function visual(kind){
    const c = info(cur.id)[kind], name = Array.isArray(c) ? pick(c) : c;
    if (!name) return null;
    const pic = /\.(png|jpg)$/.test(name), bare = /\.png$/.test(name), sit = kind === "study" || kind === "rest";
    if (!pic && !cur.video[name]) return null;
    if (bare && !sit) return { name, small: true };
    const card = pic ? !bare : !!cur.video[name].scene; // 카드는 불투명한 그림과 영상만
    // 투명한 것(공부 영상, sit/sleep 같은 쉬는 그림)은 카드 없이 같은 큰 크기로, 캐릭터 크기 비율대로
    const z = card ? CARD : Math.round(CARD * scaleOf(cur.id));
    return { name, pic, bare, card, w: card && pic ? Math.round(CARD * 1.6) : z, h: z };
  }
  // 앉기, 반응: 빈 자리를 찾아 거기서 한다
  function big(kind, ms){
    if (!cur || still.matches) return;
    const s = cur.s, sit = kind === "study" || kind === "rest";
    if (!["walk", "pause", "turn", "clip"].includes(s.mode)) return; // 뛰거나 날거나 끌려가는 중엔 건너뛴다
    const v = visual(kind);
    const later = () => { s.sitAt = performance.now() + rand(20e3, 40e3); if (s.float) s.mode = "walk"; };
    if (!v || v.small) { // 쓸 큰 그림이 없으면: 반응은 (그림을 바꿔) 통통, 앉기는 다음에
      if (sit) return later();
      if (s.mode === "clip") return;
      if (v) { cur.img.src = `characters/${cur.id}/${v.name}`; s.face = true; }
      s.bounces = kind === "add" ? 0 : 1;
      return hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 18, .32);
    }
    atSpot(v.w, v.h, () => playClip(kind, ms, v), sit ? later : smallHop);
  }
  function playClip(kind, loopMs, v){
    const s = cur.s, me = cur, id = cur.id, { name, pic, card } = v;
    s.studying = kind === "study" || kind === "rest";
    s.cw = v.w; s.ch = v.h;
    if (card && pic) s.cw = CARD; // jpg 카드 폭은 그림이 뜨면 비율에 맞춘다
    let m;
    if (pic) {
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
    me.el.classList.remove("card", "bare");
    me.el.classList.add(card ? "card" : "bare");
    me.el.style.width = s.cw + "px"; me.el.style.height = s.ch + "px";
    me.el.replaceChildren(m);
    if (!pic && !card) cleanAlpha(m, s.ch);
    s.mode = "clip";
    s.clipEnd = performance.now() + (loopMs || (pic ? 3500 : ((cur.video[name].duration || 8) + 1) * 1000));
  }
  // 투명 영상은 가장자리에 옅은 흰 테가 남는다. 캔버스에 옮겨 그리며 그 픽셀을 걷어 낸다:
  // 알파 110 아래는 지우고, 남은 반투명 픽셀 중 밝은 것은 알파를 세게 줄인다
  function cleanAlpha(v, css){
    const cv = document.createElement("canvas"), px = Math.round(css * (devicePixelRatio || 1));
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
    cur.el.style.width = cur.el.style.height = cur.size + "px";
    cur.el.replaceChildren(cur.img);
    cur.s.mode = "walk";
    cur.s.studying = false;
    cur.s.sitAt = performance.now() + rand(12e3, 25e3);
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
      big("add");
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
      big("done");
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
        s.float = false; s.seek = 0;
        s.mode = "drag";
        s.ang = ((s.ang % 360) + 540) % 360 - 180;
        el.classList.add("drag");
        me.img.src = flyFace(me.id);
      }
      if (!press.drag) return;
      const now = performance.now();
      s.x = e.clientX; s.y = e.clientY + me.size / 2;
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
      if (Math.hypot(v[0], v[1]) < 200 && emptyAt(s.x, s.y - me.size / 2)) return float();
      fly(clamp(v[0], -2500, 2500), clamp(v[1], -2500, 2500));
      if (Math.random() < .3) shout(); // 던지면 가끔 외친다
    });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function fly(vx, vy){
    const s = cur.s;
    s.mode = "fly"; s.vx = vx; s.vy = vy; s.ft = 0; s.float = false; s.seek = 0;
    cur.img.src = flyFace(cur.id);
    s.ang = ((s.ang % 360) + 540) % 360 - 180;
  }

  // 빈 자리(글자도 칸도 없는 곳)에 떠서 쉰다. 쉬는 그림 크기만큼 비어 있지 않으면 가까운 빈 자리로 옮겨 간다
  function float(){
    const s = cur.s;
    s.float = true; s.drop = false; s.key = "float"; s.ang = 0; s.mode = "pause"; s.until = performance.now() + 3000;
    cur.img.src = eyes(cur.id, false);
    rest(rand(20e3, 40e3));
  }
  function rest(ms){
    const c = info(cur.id), h = new Date().getHours(), nap = c.rest && ((c.night && (h >= 19 || h < 6)) || Math.random() < .3);
    big(nap ? "rest" : "study", ms);
  }

  function hop(to, h, dur, then){
    const s = cur.s;
    const a1 = sideOf(to.key) * 90;
    s.mode = "hop"; s.hopP = 0; s.seek = 0;
    if (info(cur.id).hop && !s.face) cur.img.src = `characters/${cur.id}/${info(cur.id).hop}`;
    s.hop = { fx: s.x, fy: s.y, ...to, h, dur, then, n: N[s.float ? 0 : sideOf(s.key)], a0: s.ang, a1: s.ang + (((a1 - s.ang) % 360) + 540) % 360 - 180 };
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
    hop(best, 40, .6 + best.d / 700);
  }

  // 가장 가까운 윗변(바닥 포함)으로 뛰어간다. 허공에서 쉬고 난 뒤에 쓴다
  function backToCells(E){
    const s = cur.s;
    let best = null;
    s.float = false; s.key = "floor"; // 뛰어오르는 방향(위)을 바닥 기준으로
    for (const o of E.tops) {
      const x = clamp(s.x, o.ax + SIZE / 2, o.bx - SIZE / 2), d = Math.hypot(x - s.x, o.ay - s.y);
      if (!best || d < best.d) best = { d, key: o.key, t: (x - o.ax) / o.len, dir: s.dir, x, y: o.ay };
    }
    hop(best, 40, .6 + best.d / 700);
  }

  // 움직임 줄이기: 글자 없는 자리 중 첫 윗변 오른쪽부터 나란히 선다. 없으면 가장 가까운 빈 자리
  function placeStill(E){
    const s = cur.s, z = cur.size;
    s.mode = "pause"; s.until = Infinity; s.ang = 0; s.dir = -1; s.float = false;
    for (const e of E.tops) for (let t = 1 - z / 2 / e.len; t >= 0; t -= z / e.len) {
      const [x, y] = at(e, t);
      if (free(boxAt(x, y, N[0], z, z))) { s.key = e.key; s.t = t; s.x = x; s.y = y; return; }
    }
    const p = findSpot(z, z);
    if (p) { s.key = "float"; s.float = true; s.x = p[0]; s.y = p[1] + z / 2 + 2; }
  }

  /* ── 성격 ────────────────────────────────────── */
  let ptr = [-1e4, -1e4];
  document.addEventListener("pointermove", (e) => { ptr = [e.clientX, e.clientY]; }, { passive: true });
  const typingNow = () => !!document.activeElement && document.activeElement.matches("input, textarea, select, [contenteditable]");
  const othersTalking = () => pets.some(p => p !== cur && p.bubble.classList.contains("on"));
  // 한가한가: 걷거나 쉬는 중이고, 떠 있지 않고, 사용자가 입력하고 있지 않다
  const idle = () => { const s = cur.s; return !still.matches && !s.float && !s.seek && (s.mode === "walk" || s.mode === "pause") && !!s.key && s.key !== "float" && !typingNow(); };
  // [a, b] 분 간격으로 fn 을 되풀이한다(그 캐릭터가 있는 동안, 화면이 보일 때만)
  function every(me, [a, b], fn){
    me.timers.push(setTimeout(function again(){
      if (!alive(me)) return;
      if (!document.hidden) as(me, fn)();
      me.timers.push(setTimeout(again, rand(a, b) * MIN));
    }, rand(a, b) * MIN));
  }
  // 혼자 말하기: 캐릭터마다 간격(talk)이 다르다. 다른 캐릭터가 말하는 중이면 20~40초 기다렸다 다시
  function chatter(me){
    const [a, b] = info(me.id).talk || [15, 20];
    me.timers.push(setTimeout(function again(){
      if (!alive(me)) return;
      if (document.hidden || as(me, othersTalking)()) return me.timers.push(setTimeout(again, rand(20e3, 40e3)));
      as(me, chat)();
      me.timers.push(setTimeout(again, rand(a, b) * MIN));
    }, rand(a, b) * MIN));
  }
  // 빠르게 곧게 옮겨 가기. 점마다 속도 v(px/s), 기울기 lean(도), 닿은 뒤 쉬는 rest(ms). 다 가면 then
  function dash(pts, then){
    const s = cur.s;
    s.ang = ((s.ang % 360) + 540) % 360 - 180;
    s.mode = "dash"; s.seek = 0; s.dash = { pts, i: 0, wait: 0, then, ghost: 0 };
  }
  // 잔상: 지금 모습을 본떠 두고 0.3초에 걸쳐 사라지게 한다
  function ghost(){
    const g = cur.el.cloneNode(true);
    g.classList.add("char-ghost");
    cur.layer.insertBefore(g, cur.el);
    setTimeout(() => { g.style.opacity = "0"; }, 20);
    setTimeout(() => g.remove(), 340);
  }

  // 우사기 질주: 아래 "웹 비서 사용하기" 막대 윗변으로 뛰어올라 끝에서 끝까지 한 번 왕복하고, 빈 자리로 내려간다.
  // 막대 글자 위를 지나가는 것은 괜찮고, 거기서 멈추지는 않는다
  function sprint(){
    const s = cur.s, bar = document.getElementById("assistant-link");
    if (!idle() || !bar) return;
    const r = bar.getBoundingClientRect();
    if (r.width < 120 || r.top > innerHeight) return;
    const z = cur.size, y = r.top, ends = [r.left + z / 2, r.right - z / 2];
    if (Math.abs(s.x - ends[1]) < Math.abs(s.x - ends[0])) ends.reverse();
    s.float = false;
    hop({ key: "float", t: 0, dir: s.dir, x: ends[0], y }, 50, .6, () => dash([
      { x: ends[1], y, v: rand(300, 400), lean: 15 },
      { x: ends[0], y, v: rand(300, 400), lean: 15, rest: 200 },
    ], () => atSpot(z, z, () => { s.until = performance.now() + rand(3e3, 6e3); }, () => backToCells(edges()))));
  }

  // 랏코 샥샥샥: 칸과 상자의 위 모서리 사이를 2~4번 곧게 빠르게(한 번에 0.18초) 옮겨 다니고(잔상),
  // 마지막 모서리에서 빈 자리를 찾아 멈춘다
  function cornerDash(){
    const s = cur.s;
    if (!idle()) return;
    const cs = [];
    edges().list.forEach(e => { if (e.side === 0 && e.key !== "floor") cs.push({ x: e.ax, y: e.ay, key: e.key, t: 0 }, { x: e.bx, y: e.by, key: e.key, t: 1 }); });
    const pts = [];
    let from = [s.x, s.y];
    for (let k = 2 + Math.floor(Math.random() * 3); k > 0; k--) {
      const d = (c) => Math.hypot(c.x - from[0], c.y - from[1]);
      const c = pick(cs.filter(c => d(c) > 20).sort((a, b) => d(a) - d(b)).slice(0, 4));
      if (!c) break;
      pts.push({ ...c, v: d(c) / .18, lean: 10, rest: 150 });
      from = [c.x, c.y];
    }
    if (!pts.length) return;
    const last = pts[pts.length - 1];
    dash(pts, () => { s.key = last.key; s.t = last.t; s.dir = last.t ? -1 : 1; stop(rand(3e3, 8e3)); });
  }

  // 모몽가: 포인터가 다가오면 포인터에서 먼 가장 가까운 빈 자리로 피해 뛴다(2초에 한 번). 가끔 한마디
  function dodge(now){
    const s = cur.s, z = cur.size;
    s.ptrAt = now + 2000;
    if (s.mode === "clip") stopClip();
    const p = findSpot(z, z, ([x, y]) => Math.hypot(x - ptr[0], y - ptr[1]) > 140);
    if (!p) return smallHop();
    const fx = p[0], fy = p[1] + z / 2 + 2;
    s.float = false;
    hop({ key: "float", t: 0, dir: fx < s.x ? -1 : 1, x: fx, y: fy }, 30, .35 + Math.hypot(fx - s.x, fy - s.y) / 1200, () => {
      s.float = true; s.mode = "pause"; s.until = performance.now() + rand(3e3, 6e3);
    });
    if (cur.lines && cur.lines.dodge && Math.random() < .5 && !othersTalking()) say(pick(cur.lines.dodge));
  }

  // 치이카와: 포인터가 다가오면 떨고 살짝 움츠리며 반대쪽으로 물러선다(3초에 한 번, 말은 없다).
  // <id>/scared.png 가 있으면 그동안 그 그림을 쓴다(처음 놀랄 때 한 번 있는지 본다)
  function scare(now, E){
    const s = cur.s, me = cur, c = info(me.id), e = E.map[s.key];
    s.ptrAt = now + 3000;
    s.shake = now + 800; s.shakeA = 2; s.squash = 1;
    if (e && !s.float && s.mode !== "clip") {
      const [px, py] = at(e, s.t), tx = (e.bx - e.ax) / e.len, ty = (e.by - e.ay) / e.len;
      s.dir = (px - ptr[0]) * tx + (py - ptr[1]) * ty >= 0 ? 1 : -1;
      s.mode = "walk";
    }
    if (c.scaredOk === undefined) {
      c.scaredOk = false;
      const im = new Image();
      im.onload = () => { c.scaredOk = true; };
      im.src = `characters/${me.id}/scared.png`;
    }
    if (c.scaredOk) {
      me.img.src = `characters/${me.id}/scared.png`; s.face = true;
      me.timers.push(setTimeout(() => { if (s.face && s.mode !== "hop") { s.face = false; me.img.src = eyes(me.id, false); } }, 900));
    }
  }

  /* ── 매 프레임 ───────────────────────────────── */
  function tick(now, E){
    const dt = Math.min(.05, (now - (cur.last || now)) / 1000); cur.last = now;
    const s = cur.s;
    let e = E.map[s.key];

    if (still.matches) { // 움직임 줄이기: 걷지도 날지도 않는다. 0.5초마다 자리가 아직 빈 곳인지 본다
      if (!s.key || now - (s.chk || 0) > 500) { s.chk = now; if (!s.key || !free(footprint())) placeStill(E); }
      return draw(E, now, false);
    }
    if (!e && !s.key) { // 처음 나올 때: 아무 윗변의 아무 곳
      e = pick(E.tops); s.key = e.key;
    }
    if (s.float && s.mode === "walk") { backToCells(E); } // 다 쉬었으면 내려간다
    const onEdge = !s.float && ["walk", "pause", "turn", "clip"].includes(s.mode);
    if (onEdge && !e) { if (s.mode === "clip") stopClip(); fly(0, 0); } // 밟던 변이 사라졌다(탭 이동, 스크롤): 떨어진다
    // 멈춰 있는 동안 0.5초마다: 밑에 글자가 생겼으면(목록 바뀜, 스크롤, 창 크기) 빈 자리로 옮긴다
    if (quiet(cur) && cur.fp && now - (s.chk || 0) > 500) {
      s.chk = now;
      if (!free(cur.fp)) {
        if (s.mode === "clip") stopClip();
        if (!s.float) { s.mode = "walk"; s.seek = rand(8e3, 20e3); s.seekUntil = now + 8000; }
        else s.mode = "walk"; // 떠 있었으면 가까운 변으로
      }
    }
    const typing = typingNow();
    let stepped = false;
    // 포인터가 가까우면: 모몽가는 피해 뛰고, 치이카와는 떨며 물러선다
    const c = info(cur.id);
    if ((c.dodge || c.scared) && cur.fp && ["walk", "pause", "clip"].includes(s.mode) && now > (s.ptrAt || 0)) {
      const [x0, y0, x1, y1] = cur.fp;
      if (Math.hypot(ptr[0] - (x0 + x1) / 2, ptr[1] - (y0 + y1) / 2) < 60) c.dodge ? dodge(now) : scare(now, E);
    }

    if (s.mode === "walk" && e && !s.float) {
      const fp = footprint();
      if (s.seek && (free(fp))) { s.mode = "pause"; s.until = now + s.seek; s.seek = 0; } // 찾던 빈 자리
      else if (s.seek && now > s.seekUntil) { // 걸어서는 못 찾았다: 가장 가까운 빈 자리로 떠 가서 멈춘다
        const ms = s.seek; s.seek = 0;
        atSpot(cur.size, cur.size, () => { s.mode = "pause"; s.until = performance.now() + ms; }, () => {});
      } else if (typing && free(fp)) {
        s.sitAt += dt * 1000; // 입력하는 동안은 빈 자리에서 가만히 있는다
      } else {
        stepped = true;
        s.t += s.dir * SPEED * dt / e.len;
        s.phase += dt / STEP;
        if (s.t > e.t1 || s.t < e.t0) edgeEnd(E, e);
        else if (s.wantPause && !s.seek) { s.wantPause = false; stop(rand(8e3, 20e3)); } // 변 1~2개마다 8~20초 쉰다
        else if (now > s.ev) { // 가끔 쉬거나 제자리에서 뛴다
          s.ev = now + rand(4e3, 9e3);
          const r = Math.random();
          if (r < .3 && !s.seek) stop(rand(8e3, 20e3));
          else if (r < .4) hop({ key: s.key, t: s.t, dir: s.dir, ...xy(at(e, s.t)) }, 14, .35);
        }
        // 여럿이면 한꺼번에 절반 남짓만 움직인다
        if (s.mode === "walk" && !s.seek && pets.length > 1 &&
            pets.filter(p => p !== cur && ["walk", "turn", "hop", "fly", "drag", "dash"].includes(p.s.mode)).length >= Math.ceil(pets.length / 2)) stop(rand(8e3, 20e3));
        if (s.mode === "walk" && now > (s.bumpAt || 0)) { // 먼저 온 캐릭터와 같은 자리면 나중 쪽이 돌아서거나 비켜 뛴다
          const o = pets.slice(0, pets.indexOf(cur)).find(o => o.s.key === s.key && !o.s.float && Math.abs(o.s.t - s.t) * e.len < SIZE * .8);
          if (o) {
            s.bumpAt = now + 1500;
            if (Math.random() < .3) hop({ key: s.key, t: s.t, dir: s.dir, ...xy(at(e, s.t)) }, 22, .4); else s.dir = -s.dir;
          }
        }
        if (s.mode === "walk" && s.key === "floor" && E.cells && now > (s.climbAt || 0)) climb(E);
        else if (s.mode === "walk" && now > s.sitAt) rest(rand(30e3, 90e3)); // 앉아서 공부(가끔은 rest, night 이면 19시 뒤엔 늘)
      }
    } else if (s.mode === "pause" && now > s.until) s.mode = "walk";
    else if (s.mode === "turn") {
      s.turnP = Math.min(1, s.turnP + dt / .3);
      s.ang = s.ang0 + s.dir * 90 * (1 - Math.cos(Math.PI * s.turnP)) / 2;
      if (s.turnP >= 1) { s.ang = s.ang0 + s.dir * 90; s.mode = "walk"; if (Math.random() < .3) stop(rand(3e3, 8e3)); }
    } else if (s.mode === "clip") {
      if (now > s.clipEnd) stopClip();
    } else if (s.mode === "dash") { // 빠르게 곧게 옮겨 가기(우사기 질주, 랏코 샥샥샥)
      const D = s.dash, p = D.pts[D.i];
      s.ang += (0 - s.ang) * Math.min(1, dt * 15);
      if (now >= D.wait) {
        const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), step = p.v * dt;
        if (Math.abs(dx) > 1) s.dir = dx > 0 ? 1 : -1;
        s.lean = s.dir * (p.lean || 0);
        if (d <= step) {
          s.x = p.x; s.y = p.y; s.lean = 0; D.i++; D.wait = now + (p.rest || 0);
          if (D.i >= D.pts.length) { s.ang = 0; s.mode = "walk"; if (D.then) D.then(); }
        } else {
          s.x += dx / d * step; s.y += dy / d * step; s.phase += dt / .12;
          if (c.cornerDash && now - D.ghost > 60) { D.ghost = now; D.trail = true; } // 잔상
        }
      }
    } else if (s.mode === "hop") {
      const H = s.hop;
      s.hopP = Math.min(1, s.hopP + dt / H.dur);
      const p = s.hopP, arc = 4 * H.h * p * (1 - p);
      s.x = H.fx + (H.x - H.fx) * p + H.n[0] * arc;
      s.y = H.fy + (H.y - H.fy) * p + H.n[1] * arc;
      s.ang = H.a0 + (H.a1 - H.a0) * p;
      if (p >= 1) {
        s.key = H.key; s.t = H.t; s.dir = H.dir; s.mode = "walk"; s.squash = 1;
        if (s.key === "floor") s.climbAt = now + rand(8e3, 20e3);
        if (s.bounces > 0) { s.bounces--; hop({ key: s.key, t: s.t, dir: s.dir, x: s.x, y: s.y }, 18, .32); }
        else { s.face = false; cur.img.src = eyes(cur.id, false); } // 뛰는 그림이나 반응 그림에서 원래 모습으로
        if (H.then && s.mode === "walk") H.then();
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
      if (!s.drop && s.vy > 0 && s.ft > .25 && emptyAt(s.x, s.y - cur.size / 2)) { float(); s.squash = 1; } // 빈 자리면 떨어지지 않고 떠서 쉰다
      else if (s.vy > 0) {
        const land = E.tops.find(o => py <= o.ay && s.y >= o.ay && s.x >= o.ax - SIZE / 4 && s.x <= o.bx + SIZE / 4);
        if (land) {
          s.key = land.key; s.t = clamp((s.x - land.ax) / land.len, 0, 1); s.y = land.ay; s.ang = 0;
          s.dir = s.vx < 0 ? -1 : 1; s.mode = "walk"; s.squash = 1; s.drop = false;
          if (s.key === "floor") s.climbAt = now + rand(8e3, 20e3);
          cur.img.src = eyes(cur.id, false);
        } else if (s.y >= E.floor.ay) { // 바닥 밖으로 떨어졌으면 바닥 끝에 세운다
          s.key = "floor"; s.y = E.floor.ay; s.x = clamp(s.x, E.floor.ax, E.floor.bx); s.t = (s.x - E.floor.ax) / E.floor.len;
          s.ang = 0; s.squash = 1; s.mode = "walk"; s.drop = false; s.climbAt = now + rand(8e3, 20e3);
          cur.img.src = eyes(cur.id, false);
        }
      }
    }
    if (!s.float && ["walk", "pause", "turn", "clip"].includes(s.mode) && (e = E.map[s.key])) [s.x, s.y] = at(e, clamp(s.t, 0, 1));
    s.squash = Math.max(0, s.squash - dt * 5);
    s.pop = Math.max(0, (s.pop || 0) - dt * 2.5);
    draw(E, now, stepped && s.mode === "walk");
  }
  const xy = ([x, y]) => ({ x, y });

  // 변 끝에 닿았을 때: 모서리를 돌거나, 틈을 뛰어 건너거나, 돌아선다
  function edgeEnd(E, e){
    const s = cur.s;
    s.t = clamp(s.t, e.t0, e.t1);
    if (++s.seg >= s.segN) { s.seg = 0; s.segN = 1 + Math.floor(Math.random() * 2); s.wantPause = true; }
    const corner = s.dir > 0 ? e.t1 >= 1 : e.t0 <= 0;
    const next = e.key !== "floor" && E.map[e.q + ":" + ((e.side + s.dir + 4) % 4)];
    if (corner && next && (s.dir > 0 ? next.t0 <= 0 : next.t1 >= 1) && Math.random() < .85) {
      s.key = next.key; s.t = s.dir > 0 ? 0 : 1;
      s.mode = "turn"; s.turnP = 0; s.ang0 = s.ang;
      return;
    }
    const to = hopTargets(E, e, at(e, s.t));
    if (to.length && Math.random() < .45) { // 칸 사이 건너뛰기는 가끔만
      const o = pick(to), d = Math.hypot(o.x - s.x, o.y - s.y);
      return hop(o, clamp(18 + d * .2, 18, 60), .45 + d / 600);
    }
    // 옆벽을 타고 내려와 칸 아래 모서리에 닿았다: 아랫변은 걷지 않고 아래로 떨어진다
    if (corner && ((e.side === 1 && s.dir > 0) || (e.side === 3 && s.dir < 0))) {
      s.drop = true;
      return fly(N[e.side][0] * 40, 0);
    }
    s.dir = -s.dir;
  }

  function draw(E, now, walking){
    const s = cur.s, el = cur.el, W = innerWidth, H = innerHeight, z = cur.size;
    const A = now < (s.shake || 0) ? s.shakeA || 3 : 0, jx = rand(-A, A), jy = rand(-A, A); // 외칠 때, 놀랄 때 떨림
    const pop = Math.sin(Math.PI * (s.pop || 0)); // 외칠 때 늘었다 줄었다
    if (s.mode === "clip") { // 영상과 카드는 똑바로 세워 변 바깥쪽(떠 있으면 위)에 붙인다
      const [x0, y0] = boxAt(s.x, s.y, normal(), s.cw, s.ch);
      el.style.transform = `translate(${clamp(x0, 0, W - s.cw) + jx}px,${clamp(y0, 0, H - s.ch) + jy}px)`;
    } else {
      const sw = Math.sin(Math.PI * s.phase);
      const tilt = walking ? 8 * sw : s.mode === "fly" ? clamp(s.vx / 50, -25, 25) : s.mode === "dash" ? s.lean || 0 : 0;
      const bob = walking ? 5 * Math.abs(sw) : 0;
      const q = Math.max(walking ? Math.max(0, 1 - Math.abs(sw) / .3) : 0, s.squash); // 발 디딜 때 살짝 눌린다
      // foot: 그림 아래 빈 여백만큼 내려 발이 변에 닿게 한다
      el.style.transform = `translate(${s.x - z / 2 + jx}px,${s.y - z + jy}px) rotate(${s.ang}deg) translateY(${cur.foot - bob}px) ` +
        `rotate(${tilt}deg) scale(${((s.dir < 0) !== !!info(cur.id).faceLeft && !s.face ? -1 : 1) * (1 + .06 * q - .12 * pop)},${1 - .08 * q + .22 * pop})`;
    }
    cur.fp = footprint();
    el.classList.toggle("dash", s.mode === "dash" && !!info(cur.id).sprint);
    if (s.dash && s.dash.trail) { s.dash.trail = false; ghost(); }

    // 말풍선: 위, 아래, 오른쪽, 왼쪽 중 글자를 가장 덜 덮는 자리(지금 자리가 크게 나쁘지 않으면 그대로). 0.5초마다 다시 본다
    const b = cur.bubble;
    if (b.classList.contains("on")) {
      const bw = b.offsetWidth, bh = b.offsetHeight, [x0, y0, x1, y1] = cur.fp, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const cand = [[cx - bw / 2, y0 - bh - 8], [cx - bw / 2, y1 + 8], [x1 + 8, cy - bh / 2], [x0 - bw - 8, cy - bh / 2]]
        .map(([x, y]) => [clamp(x, 4, W - bw - 4), clamp(y, 4, H - bh - 4)]);
      if (cur.side == null || now - (cur.sideAt || 0) > 500) {
        cur.sideAt = now;
        const sc = cand.map(([x, y]) => cover([x, y, x + bw, y + bh]));
        const best = sc.indexOf(Math.min(...sc));
        if (cur.side == null || sc[cur.side] > sc[best] + 40) cur.side = best;
      }
      const [bx, by] = cand[cur.side];
      b.style.transform = `translate(${bx}px,${by}px)`;
    }
  }

  // 그 점이 빈 자리인가: 맨 위 요소가 #body 바탕이나 칸 사이 틈(글자도 칸도 아님). 던졌을 때 떠서 쉴지 정한다
  function emptyAt(x, y){
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    for (const e of document.elementsFromPoint(x, y)) {
      if (e.closest(".char-layer")) continue;
      return e.id === "body" || e.classList.contains("grid");
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
