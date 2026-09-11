/* 워커 어댑터. app.js는 이 파일이 만드는 window.Backend만 안다.
   위젯 전용 기능(resize/ontop/minimize/quit)은 브라우저 창을 다루는
   방법이 없어 아무 것도 안 하는 자리만 채워둔다. 실제로는 버튼 자체가
   app.css의 .widget.web 규칙으로 숨겨져 눌릴 일이 없다. */
(function(){
  async function call(name, args){
    try {
      const res = await fetch(`/api/${name}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({args}),
      });
      if (!res.ok) return {ok:false, error:`서버가 ${res.status}를 반환했다`};
      return await res.json();
    } catch (e) {
      return {ok:false, error:"서버에 연결하지 못했다", hint:String(e)};
    }
  }

  const METHODS = [
    "data", "log", "done", "undo", "setpri", "star", "waiting", "add", "remove",
  ];
  const backend = { chrome: false };
  METHODS.forEach(name => { backend[name] = (...args) => call(name, args); });
  const noop = async () => ({ok:true});
  backend.resize = noop;
  backend.ontop = noop;
  backend.minimize = noop;
  backend.quit = noop;
  window.Backend = backend;

  const fire = () => document.dispatchEvent(new Event("backendready"));
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fire);
  } else {
    fire();
  }
})();
