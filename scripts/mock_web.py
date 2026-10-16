"""Ulick 웹판 미리보기용 가짜 서버 (로컬 확인 전용, 배포 X).
/size-tuner.html 은 scripts/ 의 캐릭터 크기 맞추기 화면을 낸다. 노션 대신 예시 할 일을 돌려준다.
worker/index.js 의 renderShell 과 같은 순서로 화면을 조립한다.
usage: python -I mock_ulick.py <ui 폴더> <port>"""
import json, sys, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial

UI, PORT = sys.argv[1], int(sys.argv[2])
today = datetime.date.today()
d = lambda n: (today + datetime.timedelta(days=n)).isoformat()
ITEMS = [
    {"id": "a1", "tag": "업무", "title": "견적서 3곳 비교표 1장 만들기", "due": d(0), "q": 1, "today": True},
    {"id": "a2", "tag": "업무", "title": "발주 일정 회신 받기", "due": d(1), "q": 1, "wait": True},
    {"id": "b1", "tag": "업무", "title": "주간 보고 초안 쓰기", "due": d(3), "q": 2, "today": True},
    {"id": "b2", "tag": "개인", "title": "책 3장 읽기", "due": "", "q": 2},
    {"id": "b3", "tag": "업무", "title": "재고 시트 열 이름 정리", "due": d(6), "q": 2},
    {"id": "c1", "tag": "업무", "title": "회의실 예약하기", "due": d(0), "q": 3},
    {"id": "d1", "tag": "개인", "title": "사진 정리", "due": "", "q": 4},
]
for i in ITEMS:
    i.setdefault("owner", ""); i.setdefault("memo", ""); i.setdefault("today", False); i.setdefault("wait", False)
QUADS = [{"n": 1, "key": "q1", "name": "지금 당장", "axis": "중요, 시급"},
         {"n": 2, "key": "q2", "name": "핵심 업무", "axis": "중요"},
         {"n": 3, "key": "q3", "name": "빠르게 쳐낼", "axis": "시급"},
         {"n": 4, "key": "q4", "name": "언젠가", "axis": "나중"}]

class H(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def send_json(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(200); self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path in ("/", "/index.html"):
            r = lambda p: open(f"{UI}/{p}", encoding="utf-8").read()
            html = (f'<!doctype html><html lang="ko"><head><meta charset="utf-8">'
                    f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ulick To-do</title>'
                    f'<style>\n{r("app.css")}\n</style></head><body>\n{r("body.html")}\n'
                    f'<script>\n{r("adapter-web.js")}\n</script>\n<script>\n{r("app.js")}\n</script>\n'
                    f'<script>\n{r("characters.js")}\n</script></body></html>').encode()
            self.send_response(200); self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(html))); self.end_headers(); self.wfile.write(html)
            return
        if self.path.split("#")[0] == "/size-tuner.html":
            import os
            b = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "size-tuner.html"), "rb").read()
            self.send_response(200); self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
    def do_POST(self):
        name = self.path.removeprefix("/api/")
        n = int(self.headers.get("content-length") or 0)
        args = (json.loads(self.rfile.read(n) or b"{}").get("args") or []) if n else []
        if name == "data":
            return self.send_json({"ok": True, "data": {"today": today.isoformat(), "quads": QUADS, "sources": ["업무", "개인"],
                                                      "items": ITEMS, "me": "", "team": False, "admin": True, "people": []}})
        if name == "log":
            return self.send_json({"ok": True, "data": []})
        if name == "done" and args:
            ITEMS[:] = [i for i in ITEMS if i["id"] != args[0]]
        if name == "add" and args:
            ITEMS.append({"id": f"n{len(ITEMS)}", "tag": args[1], "owner": "", "title": args[0], "memo": "",
                          "due": args[2] or "", "q": int(args[3]) if args[3] else 0, "today": False, "wait": False})
        return self.send_json({"ok": True})

ThreadingHTTPServer(("127.0.0.1", PORT), partial(H, directory=UI)).serve_forever()
