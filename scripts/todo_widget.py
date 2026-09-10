"""
바탕화면 To-do 위젯 (Windows)

준비:
    pip install -r requirements.txt
토큰 설정:
    scripts/.env.example을 scripts/.env로 복사하고
    NOTION_TODO_TOKEN=발급받은_토큰 형태로 한 줄 적는다.
    (.env는 git에 올라가지 않는다. 소스에 토큰을 직접 넣지 않는다)
실행:
    python todo_widget.py

두 DB 페이지 각각에서 ... > 연결 > 해당 Integration을 추가해야 동작한다.
체크/추가/삭제 기능을 쓰려면 토큰 권한에 Read content와 Update content,
Insert content가 모두 필요하다.

로컬에는 아무것도 저장하지 않는다. 추가/완료/삭제 모두 노션 API를
바로 호출하므로 위젯 화면이 곧 노션 상태 그대로다.
"""

import json
import os
import sys
import threading
import urllib.error
import urllib.request
from datetime import date, timedelta
from html import escape
from pathlib import Path

import webview

try:
    import pystray
    from PIL import Image, ImageDraw

    TRAY_AVAILABLE = True
except ImportError:
    TRAY_AVAILABLE = False

if getattr(sys, "frozen", False):
    # PyInstaller onefile로 묶인 경우 sys.executable이 실제 exe 위치다.
    # __file__은 매 실행마다 바뀌는 임시 압축 해제 폴더를 가리켜 쓸 수 없다.
    SCRIPT_DIR = Path(sys.executable).resolve().parent
else:
    SCRIPT_DIR = Path(__file__).resolve().parent
ENV_PATH = SCRIPT_DIR / ".env"


def load_token():
    """환경변수를 먼저 보고, 없으면 스크립트(또는 exe) 옆 .env 파일에서 읽는다.

    위젯이 shell:startup 같은 곳에서 단독 실행되면 환경변수가
    잡혀 있지 않을 수 있어 .env 파일 쪽을 실질적인 기본 경로로 둔다.
    """
    env_token = os.environ.get("NOTION_TODO_TOKEN")
    if env_token:
        return env_token.strip()

    if not ENV_PATH.exists():
        return None

    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key.strip() == "NOTION_TODO_TOKEN":
            value = value.strip().strip('"').strip("'")
            return value or None
    return None


TOKEN = load_token()

SOURCES = [
    ("업무", "0e928040351d4fdfae49f77e67e914e6"),
    ("개인", "1730d225784340f88e15f9af9d51ea78"),
]
SOURCE_IDS = dict(SOURCES)

GROUPS = ["지난 것", "오늘", "이번 주", "날짜 미정"]
LATER = ["이번 달", "그 이후"]


def headers():
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }


def call(url, payload, method):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method=method, headers=headers()
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return json.load(res)


def fetch_rows(db_id):
    payload = {
        "filter": {"property": "완료", "checkbox": {"equals": False}},
        "page_size": 100,
    }
    return call(f"https://api.notion.com/v1/databases/{db_id}/query", payload, "POST")["results"]


def complete(page_id):
    payload = {
        "properties": {
            "완료": {"checkbox": True},
            "완료일": {"date": {"start": date.today().isoformat()}},
        }
    }
    call(f"https://api.notion.com/v1/pages/{page_id}", payload, "PATCH")


def create(tag, title, due):
    properties = {
        "할 일": {"title": [{"text": {"content": title[:2000]}}]},
        "완료": {"checkbox": False},
    }
    if due:
        properties["마감일"] = {"date": {"start": due}}
    payload = {"parent": {"database_id": SOURCE_IDS[tag]}, "properties": properties}
    call("https://api.notion.com/v1/pages", payload, "POST")


def trash(page_id):
    # 완전 삭제가 아니라 노션 휴지통으로 보낸다. 실수해도 노션에서 복구 가능.
    call(f"https://api.notion.com/v1/pages/{page_id}", {"archived": True}, "PATCH")


def parse(row, tag):
    p = row["properties"]
    raw = (p["마감일"]["date"] or {}).get("start")
    return {
        "id": row["id"],
        "tag": tag,
        "title": "".join(t["plain_text"] for t in p["할 일"]["title"]) or "(제목 없음)",
        "memo": "".join(t["plain_text"] for t in p["메모"]["rich_text"]),
        "due": date.fromisoformat(raw[:10]) if raw else None,
    }


def bucket(due, today):
    if due is None:
        return "날짜 미정"
    if due < today:
        return "지난 것"
    if due == today:
        return "오늘"
    if due <= today + timedelta(days=6 - today.weekday()):
        return "이번 주"
    if due <= (today.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1):
        return "이번 달"
    return "그 이후"


def render_item(item):
    memo = f'<span class="memo">{escape(item["memo"])}</span>' if item["memo"] else ""
    due = f'{item["due"].month}/{item["due"].day}' if item["due"] else ""
    cls = "tag personal" if item["tag"] == "개인" else "tag"
    return (
        f'<li class="item">'
        f'<button class="chk" onclick="done(\'{item["id"]}\')" aria-label="완료"></button>'
        f'<span class="t"><span class="{cls}">{item["tag"]}</span>'
        f'{escape(item["title"])}{memo}</span>'
        f'<span class="d">{due}</span>'
        f'<button class="del" onclick="askDelete(this,\'{item["id"]}\')" aria-label="삭제">×</button>'
        f"</li>"
    )


def render_notice(head, detail):
    return f'<div class="notice"><b>{head}</b><p>{detail}</p></div>'


TAG_OPTIONS = "".join(f'<option value="{tag}">{tag}</option>' for tag, _ in SOURCES)

ADD_FORM = f"""<div class="addform" id="addform" hidden>
  <input id="addtitle" type="text" maxlength="200" placeholder="할 일"
    onkeydown="if(event.key==='Enter')submitAdd(); if(event.key==='Escape')toggleAdd(false)">
  <div class="addrow">
    <select id="addtag">{TAG_OPTIONS}</select>
    <input id="adddue" type="date">
  </div>
  <div class="addbtns">
    <button class="txt primary" onclick="submitAdd()">추가</button>
    <button class="txt" onclick="toggleAdd(false)">취소</button>
  </div>
</div>"""


def build_body():
    if not TOKEN:
        return render_notice(
            "토큰이 아직 비어 있다",
            f"{ENV_PATH.name} 파일을 만들어 NOTION_TODO_TOKEN=토큰값 을 한 줄 적고 위젯을 다시 실행한다. "
            f"({SCRIPT_DIR} 폴더에 .env.example 참고)",
        )
    items = []
    try:
        for tag, db_id in SOURCES:
            items += [parse(r, tag) for r in fetch_rows(db_id)]
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return render_notice("토큰이 거부됐다", "노션 Integration 설정에서 토큰을 다시 복사한다.")
        if e.code == 404:
            return render_notice(
                "DB를 못 찾는다",
                "업무와 개인 DB 각각에서 ... > 연결 을 열고 이 Integration을 추가한다.",
            )
        return render_notice(f"노션이 {e.code}를 반환했다", "잠시 후 새로고침한다.")
    except OSError:
        return render_notice("노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다.")

    today = date.today()
    items.sort(key=lambda i: (i["due"] is None, i["due"] or today, i["tag"]))
    groups = {g: [] for g in GROUPS}
    later = 0
    for i in items:
        b = bucket(i["due"], today)
        if b in LATER:
            later += 1
        else:
            groups[b].append(i)

    late = len(groups["지난 것"])
    line = f'오늘 {len(groups["오늘"])}건'
    if late:
        line += f', <span class="warn">지난 것 {late}건</span>'

    tray_btn = '<button class="txt" onclick="minimize()">트레이로</button>' if TRAY_AVAILABLE else ""

    html = [
        '<div class="bar"><h1>할 일</h1>',
        f'<span class="sub">{line}</span>',
        '<span class="acts">',
        '<button class="txt" onclick="toggleAdd()">추가</button>',
        '<button class="txt" onclick="refresh()">새로고침</button>',
        tray_btn,
        '<button class="txt" onclick="quitApp()" aria-label="종료">종료</button>',
        "</span></div>",
        ADD_FORM,
    ]
    if not items:
        html.append(render_notice("비어 있다", "위 '추가'를 누르거나 클로드에 할 일을 말하면 여기 올라온다."))
    for name in GROUPS:
        if not groups[name]:
            continue
        cls = "group past" if name == "지난 것" else "group"
        html.append(f'<section class="{cls}"><h2>{name}<i></i>{len(groups[name])}</h2><ul>')
        html.extend(render_item(i) for i in groups[name])
        html.append("</ul></section>")
    if later:
        html.append(f'<p class="later">이번 달 이후 {later}건은 노션에서</p>')
    return "".join(html)


SHELL = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
:root{--ink:#16202b;--panel:#1b2734;--line:#2a3b4b;--text:#dae3ea;--muted:#7d93a4;--warn:#f2b134;--accent:#f2b134}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;padding:0 0 16px;background:var(--ink);color:var(--text);
  font-family:"Malgun Gothic","Segoe UI",system-ui,sans-serif;font-size:13px;
  -webkit-user-select:none;overflow-y:auto}
body::-webkit-scrollbar{width:6px}
body::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.bar{display:flex;align-items:baseline;gap:8px;padding:12px 14px 4px;flex-wrap:wrap}
.bar h1{margin:0;font-size:14px;font-weight:700;letter-spacing:-.01em}
.sub{font-size:11px;color:var(--muted)}
.warn{color:var(--warn)}
.acts{margin-left:auto;display:flex;gap:2px;flex-wrap:wrap}
button{border:0;background:none;font:inherit;cursor:pointer;padding:0}
.txt{color:var(--muted);font-size:11px;padding:3px 6px;border-radius:4px;white-space:nowrap}
.txt:hover{color:var(--text);background:var(--panel)}
.txt.primary{color:var(--ink);background:var(--accent);font-weight:700}
.txt.primary:hover{filter:brightness(1.05)}
button:focus-visible{outline:1px solid var(--muted);outline-offset:1px}
.addform{margin:8px 14px 4px;padding:10px;background:var(--panel);border-radius:8px;
  display:flex;flex-direction:column;gap:6px}
.addform input,.addform select{font:inherit;font-size:12px;color:var(--text);
  background:var(--ink);border:1px solid var(--line);border-radius:5px;padding:6px 8px}
.addform input[type=text]{width:100%}
.addrow{display:flex;gap:6px}
.addrow select{flex:none}
.addrow input[type=date]{flex:1;min-width:0}
.addbtns{display:flex;justify-content:flex-end;gap:4px}
.group{padding:0 14px}
.group h2{display:flex;align-items:center;gap:8px;margin:14px 0 2px;
  font-size:11px;font-weight:700;color:var(--muted)}
.group h2 i{flex:1;height:1px;background:var(--line)}
.group.past h2{color:var(--warn)}
ul{margin:0;padding:0;list-style:none}
.item{display:flex;gap:8px;align-items:flex-start;padding:7px 0;
  border-bottom:1px solid rgba(255,255,255,.04)}
.item:last-child{border-bottom:0}
.chk{flex:none;width:14px;height:14px;margin-top:3px;border-radius:3px;
  border:1.5px solid var(--line)}
.chk:hover{border-color:var(--warn);background:rgba(242,177,52,.18)}
.t{flex:1;line-height:1.45;min-width:0}
.tag{display:inline-block;margin-right:6px;padding:1px 5px;border-radius:3px;
  background:var(--panel);color:var(--muted);font-size:10px;vertical-align:1px}
.tag.personal{color:#8fb3a8}
.memo{display:block;margin-top:2px;font-size:11px;color:var(--muted);line-height:1.4}
.d{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;padding-top:2px}
.del{flex:none;width:16px;height:16px;margin-top:2px;color:var(--muted);font-size:14px;
  line-height:1;border-radius:3px}
.del:hover{color:#e5636b;background:rgba(229,99,107,.15)}
.later{margin:16px;font-size:11px;color:var(--muted)}
.notice{margin:20px 14px;padding:14px;background:var(--panel);border-radius:6px;line-height:1.5}
.notice b{display:block;margin-bottom:4px}
.notice p{margin:0;font-size:12px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><div id="root">__BODY__</div>
<script>
const root = () => document.getElementById('root');
async function refresh(){ root().innerHTML = await pywebview.api.body(); }
async function done(id){ root().innerHTML = await pywebview.api.done(id); }
function toggleAdd(show){
  const f = document.getElementById('addform');
  f.hidden = show === false ? true : !f.hidden;
  if (!f.hidden) document.getElementById('addtitle').focus();
}
async function submitAdd(){
  const title = document.getElementById('addtitle').value.trim();
  if (!title) return;
  const tag = document.getElementById('addtag').value;
  const due = document.getElementById('adddue').value;
  root().innerHTML = await pywebview.api.add(title, tag, due);
}
function askDelete(btn, id){
  if (btn.dataset.armed){
    doDelete(id);
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = '✓';
  btn.title = '다시 누르면 삭제';
  setTimeout(() => { btn.dataset.armed = ''; btn.textContent = '×'; }, 3000);
}
async function doDelete(id){ root().innerHTML = await pywebview.api.remove(id); }
function minimize(){ pywebview.api.minimize(); }
function quitApp(){ pywebview.api.quit(); }
window.addEventListener('pywebviewready', () => setInterval(refresh, 300000));
</script></body></html>"""


tray_icon = None


def make_tray_image():
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((3, 3, 60, 60), radius=14, fill=(22, 32, 43, 255))
    d.rounded_rectangle((3, 3, 60, 60), radius=14, outline=(242, 177, 52, 255), width=3)
    d.line((18, 33, 27, 43), fill=(242, 177, 52, 255), width=5)
    d.line((27, 43, 46, 21), fill=(242, 177, 52, 255), width=5)
    return img


def show_window(icon=None, item=None):
    window.show()


def quit_app(icon=None, item=None):
    global tray_icon
    if tray_icon:
        tray_icon.stop()
        tray_icon = None
    window.destroy()


def start_tray():
    global tray_icon
    tray_icon = pystray.Icon(
        "todo_widget",
        make_tray_image(),
        "할 일 위젯",
        menu=pystray.Menu(
            pystray.MenuItem("열기", show_window, default=True),
            pystray.MenuItem("종료", quit_app),
        ),
    )
    tray_icon.run()


class Api:
    def body(self):
        return build_body()

    def done(self, page_id):
        try:
            complete(page_id)
        except urllib.error.HTTPError as e:
            if e.code == 403:
                return render_notice(
                    "완료 처리 권한이 없다",
                    "노션 Integration 설정에서 Update content를 켜고 위젯을 다시 실행한다.",
                )
            return render_notice(f"노션이 {e.code}를 반환했다", "새로고침 후 다시 시도한다.")
        except OSError:
            return render_notice("노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다.")
        return build_body()

    def add(self, title, tag, due):
        title = (title or "").strip()
        if not title:
            return build_body()
        if tag not in SOURCE_IDS:
            tag = SOURCES[0][0]
        due = (due or "").strip() or None
        try:
            create(tag, title, due)
        except urllib.error.HTTPError as e:
            if e.code == 403:
                return render_notice(
                    "추가할 권한이 없다",
                    "노션 Integration 설정에서 Insert content를 켜고 위젯을 다시 실행한다.",
                )
            return render_notice(f"노션이 {e.code}를 반환했다", "새로고침 후 다시 시도한다.")
        except OSError:
            return render_notice("노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다.")
        return build_body()

    def remove(self, page_id):
        try:
            trash(page_id)
        except urllib.error.HTTPError as e:
            if e.code == 403:
                return render_notice(
                    "삭제할 권한이 없다",
                    "노션 Integration 설정에서 Update content를 켜고 위젯을 다시 실행한다.",
                )
            return render_notice(f"노션이 {e.code}를 반환했다", "새로고침 후 다시 시도한다.")
        except OSError:
            return render_notice("노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다.")
        return build_body()

    def minimize(self):
        if TRAY_AVAILABLE:
            window.hide()

    def quit(self):
        if TRAY_AVAILABLE:
            quit_app()
        else:
            window.destroy()


window = webview.create_window(
    "할 일",
    html=SHELL.replace("__BODY__", build_body()),
    width=300,
    height=460,
    min_size=(260, 320),
    resizable=True,
    on_top=True,
    frameless=True,
    easy_drag=True,
    background_color="#16202b",
    js_api=Api(),
)

if __name__ == "__main__":
    if TRAY_AVAILABLE:
        threading.Thread(target=start_tray, daemon=True).start()
    webview.start()
