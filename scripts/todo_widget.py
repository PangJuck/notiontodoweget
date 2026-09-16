"""바탕화면 To-do 위젯 (Windows)

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

로컬에는 아무것도 저장하지 않는다. 추가/완료/삭제/분류 모두 노션 API를
바로 호출하므로 위젯 화면이 곧 노션 상태 그대로다.

화면은 셋이다.
    매트릭스 - 중요/시급 4사분면. 기본값
    날짜     - 지난 것/오늘/이번 주/날짜 미정
    기록     - 최근 완료한 것. 잘못 체크했으면 되돌린다

파이썬은 데이터만 주고 화면은 전부 JS가 그린다. 사분면 칸에 몇 건을
넣을지는 창 높이를 실제로 재서 정하는데, 그 계산은 브라우저 안에서만
할 수 있기 때문이다.
"""

import ctypes
import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
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


def find_dir(name):
    """assets, ui 같은 동봉 폴더를 찾는다.

    exe 옆을 먼저 본다. 그래야 다시 빌드하지 않고도 파일만 갈아끼울 수 있다.
    그 다음이 exe 안에 묶여 들어간 사본(PyInstaller가 푸는 _MEIPASS)이다.
    `ui/`는 웹판(worker/)과 같이 쓰려고 리포 최상위에 두었으므로,
    스크립트를 리포 안에서 직접 돌릴 때는 한 단계 위도 뒤져본다.
    """
    candidates = [SCRIPT_DIR / name, SCRIPT_DIR.parent / name]
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidates.append(Path(bundled) / name)
    for path in candidates:
        if path.is_dir():
            return path
    return SCRIPT_DIR / name


ASSETS_DIR = find_dir("assets")
UI_DIR = find_dir("ui")


def asset_path(name):
    """아이콘 같은 동봉 파일을 찾는다. 없으면 None."""
    path = ASSETS_DIR / name
    return path if path.exists() else None


def read_ui(name):
    return (UI_DIR / name).read_text(encoding="utf-8")


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
        key, value = line.split("=", 1)
        if key.strip() == "NOTION_TODO_TOKEN":
            return value.strip().strip('"').strip("'") or None
    return None


TOKEN = load_token()

WINDOW_TITLE = "할 일"
_instance_mutex = None  # 이 변수가 살아있는 동안만 뮤텍스가 유지된다


def ensure_single_instance():
    """이미 떠 있으면 그 창을 앞으로 불러오고 이 프로세스는 바로 끝낸다.

    시작프로그램 등록과 바로가기 직접 실행이 겹치거나, 트레이로 숨겨둔
    걸 잊고 또 실행하면 위젯이 계속 늘어난다. Windows 뮤텍스 하나로
    한 시점에 하나만 뜨게 막는다.
    """
    if sys.platform != "win32":
        return
    kernel32 = ctypes.windll.kernel32
    ERROR_ALREADY_EXISTS = 183
    mutex = kernel32.CreateMutexW(None, False, "NotionTodoWidget_SingleInstance")
    if kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        user32 = ctypes.windll.user32
        SW_SHOW = 5
        hwnd = user32.FindWindowW(None, WINDOW_TITLE)
        if hwnd:
            user32.ShowWindow(hwnd, SW_SHOW)
            user32.SetForegroundWindow(hwnd)
        sys.exit(0)
    global _instance_mutex
    _instance_mutex = mutex  # 핸들을 계속 들고 있어야 프로세스가 끝날 때까지 뮤텍스가 유지된다


ensure_single_instance()

# 회사 일은 팀 DB에 모여 있다. 위젯은 성준 컴퓨터의 창이므로 그중 성준 것만 본다
# (웹판처럼 로그인이 없어서, 누구 것을 볼지 여기서 이름으로 못박는다).
TEAM_DB = "6f9008aa63f249109b6ed29a374b529d"
ME = "성준"
SOURCES = [
    ("팀", TEAM_DB),
    ("개인", "1730d225784340f88e15f9af9d51ea78"),
]
SOURCE_IDS = dict(SOURCES)
# 담당자 조건을 걸 DB. 개인 DB에는 그 속성이 아예 없다.
OWNED = {TEAM_DB}

# 4사분면. 노션 `우선순위` 옵션은 앞 숫자 1~4로만 매칭한다.
# 숫자 뒤 글자는 노션에서 마음대로 바꿔도 위젯이 따라간다.
QUADRANTS = [
    (1, "지금 당장", "중요+시급"),
    (2, "핵심 업무", "중요+안시급"),
    (3, "빠르게 쳐낼", "안중요+시급"),
    (4, "언젠가", "안중요+안시급"),
]
QUADRANT_NUMS = [num for num, _, _ in QUADRANTS]
LOG_DAYS = 7        # 화면이 기간을 안 주면 거슬러 보는 날 수
LOG_MAX_PAGES = 12  # 한 DB에서 넘길 페이지 한도. 100줄씩이니 1200줄에서 멈춘다

# 노션에 실제로 들어 있는 옵션 이름. {db_id: {1: "1 지금 당장 (중요+시급)", ...}}
# 위젯이 값을 쓸 때는 이 이름을 그대로 써야 새 옵션이 생기지 않는다.
option_names = {}


# 날짜는 전부 한국 시간 기준이다. 컴퓨터 시간대를 그대로 따르면 성준의
# Windows에서는 맞지만, 워커(worker/index.js)는 UTC로 돌아서 00:00~09:00 KST에
# 완료한 것을 전날로 기록했다. 두 얼굴이 같은 DB에 쓰니 기준을 똑같이 못 박는다.
# 한국은 서머타임이 없어 +09:00이 늘 맞다.
KST = timezone(timedelta(hours=9))


def today_kst():
    return datetime.now(KST).date()


def quadrant_num(name):
    """옵션 이름 앞의 1~4를 뽑는다. 없으면 None."""
    m = re.match(r"\s*([1-4])", name or "")
    return int(m.group(1)) if m else None


def quadrant_default(num):
    for n, label, axis in QUADRANTS:
        if n == num:
            return label, axis
    return str(num), ""


def split_option(name, num):
    """'1 지금 당장 (중요+시급)' -> ('지금 당장', '중요+시급').

    노션에서 이름을 바꿔도 칸 제목이 따라가게 하려는 것이다.
    괄호가 없으면 조건만 기본값으로 채운다.
    """
    label, axis = quadrant_default(num)
    if not name:
        return label, axis
    rest = re.sub(r"^\s*[1-4][\s.)\-]*", "", name).strip()
    m = re.match(r"^(.*?)\s*[(（]([^)）]*)[)）]\s*$", rest)
    if m:
        return (m.group(1).strip() or label), (m.group(2).strip() or axis)
    return (rest or label), axis


def load_option_names(db_id):
    """노션 DB 스키마에서 `우선순위` 옵션 이름을 읽어 번호별로 담는다."""
    req = urllib.request.Request(
        f"https://api.notion.com/v1/databases/{db_id}", method="GET", headers=headers()
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        schema = json.load(res)
    options = schema.get("properties", {}).get("우선순위", {}).get("select", {}).get("options", [])
    found = {}
    for opt in options:
        num = quadrant_num(opt.get("name"))
        if num and num not in found:
            found[num] = opt["name"]
    return found


def option_name(db_id, num):
    """번호에 해당하는 실제 옵션 이름. 못 읽었으면 기본값으로 만든다."""
    names = option_names.get(db_id) or {}
    if num in names:
        return names[num]
    label, axis = quadrant_default(num) if num in QUADRANT_NUMS else (None, None)
    return f"{num} {label} ({axis})" if label else None


def quad_defs():
    """칸 제목을 만든다. 노션에 들어 있는 이름을 먼저 쓴다.

    두 DB가 서로 다른 이름을 쓰고 있으면 앞(팀) 쪽을 따른다.
    양쪽을 다 보여줄 자리가 없고, 다르게 쓰는 것 자체가 실수이기 때문이다.
    """
    out = []
    for num, _, _ in QUADRANTS:
        found = None
        for _, db_id in SOURCES:
            found = (option_names.get(db_id) or {}).get(num)
            if found:
                break
        label, axis = split_option(found, num)
        out.append({"n": num, "key": f"q{num}", "name": label, "axis": axis})
    return out


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


def owner_filter(db_id, base):
    """팀 DB는 담당자가 성준인 것만. 개인 DB는 조건을 걸 속성 자체가 없다."""
    if db_id not in OWNED:
        return base
    return {"and": [base, {"property": "담당자", "select": {"equals": ME}}]}


def fetch_rows(db_id):
    payload = {
        "filter": owner_filter(db_id, {"property": "완료", "checkbox": {"equals": False}}),
        "page_size": 100,
    }
    return call(f"https://api.notion.com/v1/databases/{db_id}/query", payload, "POST")["results"]


def fetch_done_rows(db_id, since=""):
    """최근 완료분. 완료일로 거르지 않고 정렬만 시킨 뒤 여기서 자른다.

    완료일이 비어 있는 줄(노션 화면에서 체크만 하고 버튼을 안 눌렀을 때)이
    필터에 걸리면 통째로 사라져서, 날짜 조건은 서버에 맡기지 않는다.
    대신 기간 밖으로 넘어가면 더 넘기지 않는다 — 워커(worker/index.js의
    fetchDoneRows)와 같은 방식이다.
    """
    rows = []
    cursor = None
    for _ in range(LOG_MAX_PAGES):
        payload = {
            "filter": owner_filter(db_id, {"property": "완료", "checkbox": {"equals": True}}),
            "sorts": [{"property": "완료일", "direction": "descending"}],
            "page_size": 100,
        }
        if cursor:
            payload["start_cursor"] = cursor
        r = call(f"https://api.notion.com/v1/databases/{db_id}/query", payload, "POST")
        rows += r["results"]
        if not r.get("has_more") or not r.get("next_cursor"):
            break
        last = (r["results"][-1].get("properties", {}).get("완료일", {}).get("date") or {}).get("start", "")
        last = (last or "")[:10]
        # 완료일이 빈 줄은 내림차순 맨 뒤다. 거기까지 왔으면 더 볼 것이 없다.
        if not last or (since and last < since):
            break
        cursor = r["next_cursor"]
    return rows


def patch(page_id, properties):
    call(f"https://api.notion.com/v1/pages/{page_id}", {"properties": properties}, "PATCH")


def complete(page_id):
    patch(
        page_id,
        {
            "완료": {"checkbox": True},
            "완료일": {"date": {"start": today_kst().isoformat()}},
            "오늘의 3": {"checkbox": False},
        },
    )


def uncomplete(page_id):
    patch(page_id, {"완료": {"checkbox": False}, "완료일": {"date": None}})


def set_priority(page_id, quadrant):
    value = {"select": {"name": quadrant}} if quadrant else {"select": None}
    patch(page_id, {"우선순위": value})


def set_today(page_id, on):
    patch(page_id, {"오늘의 3": {"checkbox": bool(on)}})


def set_waiting(page_id, on):
    patch(page_id, {"대기중": {"checkbox": bool(on)}})


def set_title(page_id, title):
    title = (title or "").strip()
    if not title:
        raise ValueError("빈 제목")
    patch(page_id, {"할 일": {"title": [{"text": {"content": title[:2000]}}]}})


def set_memo(page_id, text):
    text = (text or "").strip()
    rich = [{"text": {"content": text[:2000]}}] if text else []
    patch(page_id, {"메모": {"rich_text": rich}})


def create(tag, title, due, quadrant):
    properties = {
        "할 일": {"title": [{"text": {"content": title[:2000]}}]},
        "완료": {"checkbox": False},
    }
    # 팀 DB는 담당자가 비면 웹판의 사람 필터에서 사라진다. 위젯에서 넣는 것은 성준 것이다.
    if SOURCE_IDS[tag] in OWNED:
        properties["담당자"] = {"select": {"name": ME}}
    if due:
        properties["마감일"] = {"date": {"start": due}}
    if quadrant:
        properties["우선순위"] = {"select": {"name": quadrant}}
    payload = {"parent": {"database_id": SOURCE_IDS[tag]}, "properties": properties}
    call("https://api.notion.com/v1/pages", payload, "POST")


def trash(page_id):
    # 완전 삭제가 아니라 노션 휴지통으로 보낸다. 실수해도 노션에서 복구 가능.
    call(f"https://api.notion.com/v1/pages/{page_id}", {"archived": True}, "PATCH")


def plain(prop, key):
    return "".join(t.get("plain_text", "") for t in (prop or {}).get(key, []) or [])


def parse(row, tag):
    p = row.get("properties", {})
    raw = (p.get("마감일", {}).get("date") or {}).get("start")
    select = p.get("우선순위", {}).get("select") or {}
    qnum = quadrant_num(select.get("name"))
    return {
        "id": row["id"],
        "tag": tag,
        "title": plain(p.get("할 일"), "title") or "(제목 없음)",
        "memo": plain(p.get("메모"), "rich_text"),
        "due": raw[:10] if raw else "",
        "q": qnum,
        "today": bool(p.get("오늘의 3", {}).get("checkbox")),
        "wait": bool(p.get("대기중", {}).get("checkbox")),
    }


def parse_done(row, tag):
    p = row.get("properties", {})
    raw = (p.get("완료일", {}).get("date") or {}).get("start")
    select = p.get("우선순위", {}).get("select") or {}
    return {
        "id": row["id"],
        "tag": tag,
        "title": plain(p.get("할 일"), "title") or "(제목 없음)",
        "q": quadrant_num(select.get("name")),
        "done": raw[:10] if raw else "",
    }


def ensure_options(db_id):
    if db_id in option_names:
        return
    try:
        option_names[db_id] = load_option_names(db_id)
    except (urllib.error.HTTPError, OSError, ValueError):
        # 스키마를 못 읽어도 위젯은 떠야 한다. 칸 제목만 기본값으로 나간다.
        option_names[db_id] = {}


def load_items():
    items = []
    for tag, db_id in SOURCES:
        ensure_options(db_id)
        items += [parse(r, tag) for r in fetch_rows(db_id)]
    # 마감 가까운 순. 날짜 없는 것은 뒤로.
    items.sort(key=lambda i: (not i["due"], i["due"], i["tag"]))
    return items


def load_done(days=LOG_DAYS):
    """days가 0이면 자르지 않는다 — 기록 탭의 '전체'."""
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = LOG_DAYS
    cutoff = (today_kst() - timedelta(days=days - 1)).isoformat() if days > 0 else ""
    rows = []
    for tag, db_id in SOURCES:
        for r in fetch_done_rows(db_id, cutoff):
            item = parse_done(r, tag)
            if item["done"] and (not cutoff or item["done"] >= cutoff):
                rows.append(item)
    rows.sort(key=lambda i: i["done"], reverse=True)
    return rows


def snapshot():
    items = load_items()
    return {
        "today": today_kst().isoformat(),
        "quads": quad_defs(),
        "sources": [tag for tag, _ in SOURCES],
        "items": items,
    }


def describe(exc):
    """노션 쪽 실패를 사람이 읽을 말로 바꾼다."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 401:
            return "토큰이 거부됐다", ".env의 NOTION_TODO_TOKEN을 다시 확인한다."
        if exc.code == 403:
            return (
                "권한이 없다",
                "노션 Integration 설정에서 Update content와 Insert content를 켜고 다시 실행한다.",
            )
        if exc.code == 404:
            return (
                "DB를 찾지 못했다",
                "팀/개인 DB 페이지에서 ... > 연결로 Integration을 추가했는지 확인한다.",
            )
        return f"노션이 {exc.code}를 반환했다", "잠시 뒤 새로고침한다."
    return "노션에 연결하지 못했다", "네트워크를 확인하고 새로고침한다."


def guarded(fn, *args):
    """노션 호출을 감싸 JS가 읽을 결과로 바꾼다."""
    if not TOKEN:
        return {
            "ok": False,
            "error": "토큰이 없다",
            "hint": "scripts/.env에 NOTION_TODO_TOKEN=... 을 적고 다시 실행한다.",
        }
    try:
        return {"ok": True, "data": fn(*args)}
    except (urllib.error.HTTPError, OSError, ValueError) as e:
        error, hint = describe(e)
        return {"ok": False, "error": error, "hint": hint}


SHELL = (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    "<style>\n" + read_ui("app.css") + "\n</style></head><body>\n\n"
    + read_ui("body.html") + "\n\n"
    "<script>\n" + read_ui("adapter-widget.js") + "\n</script>\n"
    "<script>\n" + read_ui("app.js") + "\n</script></body></html>"
)


tray_icon = None


def make_tray_image():
    """트레이 아이콘.

    윈도우 트레이는 16px라 전체 그림을 넣으면 뭉갠다.
    주인공만 잘라둔 app.small.png를 먼저 찾는다.
    """
    for name in ("app.small.png", "app.png"):
        png = asset_path(name)
        if not png:
            continue
        try:
            return Image.open(png).convert("RGBA")
        except OSError:
            pass  # 그림이 깨져 있으면 다음 후보, 없으면 아래 기본 그림으로
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((3, 3, 60, 60), radius=12, fill=(22, 32, 43, 255))
    # 4사분면을 그대로 아이콘으로 쓴다.
    d.rectangle((8, 8, 30, 30), fill=(229, 99, 107, 255))
    d.rectangle((34, 8, 56, 30), fill=(91, 157, 217, 255))
    d.rectangle((8, 34, 30, 56), fill=(242, 177, 52, 255))
    d.rectangle((34, 34, 56, 56), fill=(107, 127, 142, 255))
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
    """JS가 부르는 창구. 화면은 만들지 않고 데이터만 오간다."""

    def data(self):
        return guarded(snapshot)

    def log(self, owner="", days=LOG_DAYS):
        # owner는 팀 모드(웹판)에서만 뜻이 있다. 위젯은 성준 혼자 쓴다.
        return guarded(load_done, days)

    def done(self, page_id):
        return guarded(complete, page_id)

    def undo(self, page_id):
        return guarded(uncomplete, page_id)

    def setpri(self, page_id, num, tag=None):
        """번호(1~4)를 받아 그 DB에 실제로 있는 옵션 이름으로 바꿔 쓴다."""
        try:
            num = int(num)
        except (TypeError, ValueError):
            num = None
        db_id = SOURCE_IDS.get(tag, SOURCES[0][1])
        name = option_name(db_id, num) if num in QUADRANT_NUMS else None
        return guarded(set_priority, page_id, name)

    def star(self, page_id, on):
        return guarded(set_today, page_id, bool(on))

    def waiting(self, page_id, on):
        return guarded(set_waiting, page_id, bool(on))

    def settitle(self, page_id, title):
        if not (title or "").strip():
            return {"ok": False, "error": "할 일을 적어주세요", "hint": ""}
        return guarded(set_title, page_id, title)

    def setmemo(self, page_id, text):
        return guarded(set_memo, page_id, text)

    def add(self, title, tag, due, quadrant=None):
        title = (title or "").strip()
        if not title:
            return {"ok": False, "error": "할 일을 적어주세요", "hint": ""}
        if tag not in SOURCE_IDS:
            tag = SOURCES[0][0]
        try:
            num = int(quadrant)
        except (TypeError, ValueError):
            num = None
        name = option_name(SOURCE_IDS[tag], num) if num in QUADRANT_NUMS else None
        return guarded(create, tag, title, (due or "").strip() or None, name)

    def remove(self, page_id):
        return guarded(trash, page_id)

    def resize(self, width, height):
        # 창을 직접 건드리는 이 네 개는 백그라운드 스레드로 넘긴다.
        # js_api 호출 안에서 곧장 부르면, WebView2가 이 호출의 응답을
        # 기다리는 와중에 창 쪽도 같은 스레드의 응답을 기다리게 되어
        # 서로 물려 위젯이 멈춘다 (항상 위 체크 해제 시 실제로 발생했다).
        threading.Thread(target=window.resize, args=(int(width), int(height)), daemon=True).start()
        return {"ok": True}

    def ontop(self, on):
        threading.Thread(target=lambda: setattr(window, "on_top", bool(on)), daemon=True).start()
        return {"ok": True}

    def minimize(self):
        # 트레이가 없으면 숨길 수 없다. 되살릴 방법이 없어진다.
        if TRAY_AVAILABLE:
            threading.Thread(target=window.hide, daemon=True).start()
        return {"ok": True}

    def quit(self):
        if TRAY_AVAILABLE:
            threading.Thread(target=quit_app, daemon=True).start()
        else:
            threading.Thread(target=window.destroy, daemon=True).start()
        return {"ok": True}

    def openlink(self, url):
        # 위젯 안(WebView2)은 target="_blank"를 그냥 무시하거나 안에서
        # 새 창을 띄우려 든다. 시스템 기본 브라우저로 직접 연다.
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            webbrowser.open(url)
        return {"ok": True}


window = webview.create_window(
    WINDOW_TITLE,
    html=SHELL,
    width=360,
    height=560,
    min_size=(280, 340),
    resizable=True,
    on_top=True,
    frameless=True,
    # easy_drag는 아무 데나 끌어도 창이 따라와 크기 조절 손잡이와 부딪친다.
    # 제목줄에만 pywebview-drag-region을 달아 거기서만 옮긴다.
    easy_drag=False,
    background_color="#141d27",
    js_api=Api(),
)

if __name__ == "__main__":
    if TRAY_AVAILABLE:
        threading.Thread(target=start_tray, daemon=True).start()
    webview.start()
