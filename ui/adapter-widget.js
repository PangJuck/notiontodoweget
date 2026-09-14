/* pywebview 어댑터. app.js는 이 파일이 만드는 window.Backend만 안다.
   pywebview.api는 pywebviewready가 뜨기 전엔 없어서, 그 전에 들어온
   호출은 될 때까지 기다렸다가 나간다. */
(function(){
  const METHODS = [
    "data", "log", "done", "undo", "setpri", "star", "waiting",
    "add", "remove", "resize", "ontop", "minimize", "quit", "openlink",
  ];

  let readyResolve;
  const ready = new Promise(r => { readyResolve = r; });

  const backend = { chrome: true };
  METHODS.forEach(name => {
    backend[name] = (...args) => ready.then(() => window.pywebview.api[name](...args));
  });
  window.Backend = backend;

  window.addEventListener("pywebviewready", () => {
    readyResolve();
    document.dispatchEvent(new Event("backendready"));
  });
})();
