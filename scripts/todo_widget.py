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

import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
from datetime import date, timedelta
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


def asset_path(name):
    """아이콘 같은 동봉 파일을 찾는다. 없으면 None.

    exe 옆 assets/를 먼저 본다. 그래야 다시 빌드하지 않고도
    파일만 갈아끼워 아이콘을 바꿀 수 있다.
    그 다음이 exe 안에 묶여 들어간 사본(PyInstaller가 푸는 _MEIPASS)이다.
    """
    candidates = [SCRIPT_DIR / "assets" / name]
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        candidates.append(Path(bundled) / "assets" / name)
    for path in candidates:
        if path.exists():
            return path
    return None


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

SOURCES = [
    ("업무", "0e928040351d4fdfae49f77e67e914e6"),
    ("개인", "1730d225784340f88e15f9af9d51ea78"),
]
SOURCE_IDS = dict(SOURCES)

# 4사분면. 노션 `우선순위` 옵션은 앞 숫자 1~4로만 매칭한다.
# 숫자 뒤 글자는 노션에서 마음대로 바꿔도 위젯이 따라간다.
QUADRANTS = [
    (1, "지금 당장", "중요+시급"),
    (2, "핵심 업무", "중요+안시급"),
    (3, "빠르게 쳐낼", "안중요+시급"),
    (4, "언젠가", "안중요+안시급"),
]
QUADRANT_NUMS = [num for num, _, _ in QUADRANTS]
LOG_DAYS = 7  # 기록 탭이 거슬러 보는 날 수

# 노션에 실제로 들어 있는 옵션 이름. {db_id: {1: "1 지금 당장 (중요+시급)", ...}}
# 위젯이 값을 쓸 때는 이 이름을 그대로 써야 새 옵션이 생기지 않는다.
option_names = {}


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

    두 DB가 서로 다른 이름을 쓰고 있으면 업무 쪽을 따른다.
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


def fetch_rows(db_id):
    payload = {
        "filter": {"property": "완료", "checkbox": {"equals": False}},
        "page_size": 100,
    }
    return call(f"https://api.notion.com/v1/databases/{db_id}/query", payload, "POST")["results"]


def fetch_done_rows(db_id):
    """최근 완료분. 완료일로 거르지 않고 정렬만 시킨 뒤 여기서 자른다.

    완료일이 비어 있는 줄(노션 화면에서 체크만 하고 버튼을 안 눌렀을 때)이
    필터에 걸리면 통째로 사라져서, 날짜 조건은 서버에 맡기지 않는다.
    """
    payload = {
        "filter": {"property": "완료", "checkbox": {"equals": True}},
        "sorts": [{"property": "완료일", "direction": "descending"}],
        "page_size": 100,
    }
    return call(f"https://api.notion.com/v1/databases/{db_id}/query", payload, "POST")["results"]


def patch(page_id, properties):
    call(f"https://api.notion.com/v1/pages/{page_id}", {"properties": properties}, "PATCH")


def complete(page_id):
    patch(
        page_id,
        {
            "완료": {"checkbox": True},
            "완료일": {"date": {"start": date.today().isoformat()}},
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


def create(tag, title, due, quadrant):
    properties = {
        "할 일": {"title": [{"text": {"content": title[:2000]}}]},
        "완료": {"checkbox": False},
    }
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


def load_done():
    cutoff = (date.today() - timedelta(days=LOG_DAYS - 1)).isoformat()
    rows = []
    for tag, db_id in SOURCES:
        for r in fetch_done_rows(db_id):
            item = parse_done(r, tag)
            if item["done"] and item["done"] >= cutoff:
                rows.append(item)
    rows.sort(key=lambda i: i["done"], reverse=True)
    return rows


def snapshot():
    items = load_items()
    return {
        "today": date.today().isoformat(),
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
                "업무/개인 DB 페이지에서 ... > 연결로 Integration을 추가했는지 확인한다.",
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


SHELL = r"""<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{
  --ink:#141d27; --panel:#1c2835; --panel-2:#223141; --line:#2b3c4d;
  --text:#dce5ec; --muted:#7b91a3;
  --q1:#e8646c; --q2:#5fa3e0; --q3:#eab543; --q4:#74889a;
  --accent:#eab543;
  /* 웹폰트를 받아오지 않는다. 인터넷이 끊겨도 글자 모양이 그대로여야 한다 */
  --kr:"Malgun Gothic","맑은 고딕","Segoe UI",system-ui,sans-serif;
  --mono:Consolas,"D2Coding",ui-monospace,monospace;
}
*{box-sizing:border-box}
/* display를 따로 준 요소는 hidden 속성만으로 안 사라진다.
   더보기로 항목을 접는 것도, 추가 폼을 닫는 것도 전부 이 한 줄에 달려 있다 */
[hidden]{display:none!important}
html,body{height:100%}
body{
  margin:0;background:var(--ink);color:var(--text);
  font-family:var(--kr);font-size:13px;line-height:1.6;overflow:hidden;
}
.widget{position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden}
.widget.pinned::after{
  content:"";position:fixed;inset:0;pointer-events:none;z-index:9;
  box-shadow:0 0 0 1px var(--accent) inset;
}

/* 제목줄 — 여기를 잡고 창을 옮긴다 */
.bar{display:flex;align-items:center;gap:8px;padding:9px 10px 7px;flex:none}
.bar h2{margin:0;font-size:14px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;flex:none}
.bar .sub{
  font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;
  min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.bar .warn{color:var(--q1)}
.bar .spacer{flex:1;min-width:4px}
.pin{
  display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);
  cursor:pointer;user-select:none;padding:3px 6px;border-radius:5px;white-space:nowrap;flex:none;
}
.pin:hover{background:var(--panel);color:var(--text)}
.pin input{accent-color:var(--accent);width:13px;height:13px;margin:0;cursor:pointer}
.iconbtn{
  border:0;background:none;cursor:pointer;color:var(--muted);
  width:24px;height:22px;border-radius:5px;font-size:13px;line-height:1;
  display:grid;place-items:center;font-family:var(--kr);flex:none;
}
.iconbtn:hover{background:var(--panel);color:var(--text)}
.iconbtn.close{color:#cf8b90}
.iconbtn.close:hover{background:var(--q1);color:#fff}
.iconbtn.spin{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* 탭 */
.tabs{display:flex;gap:2px;padding:0 10px 8px;flex:none;align-items:center}
.tabs button{
  border:0;background:none;font:inherit;font-size:12px;color:var(--muted);
  padding:4px 10px;border-radius:6px;cursor:pointer;
}
.tabs button:hover{color:var(--text);background:var(--panel)}
.tabs button[aria-selected="true"]{background:var(--panel-2);color:var(--text);font-weight:500}
.tabs .addbtn{
  margin-left:auto;background:var(--accent);color:#15202b;font-weight:700;
  padding:4px 11px;border-radius:6px;
}
.tabs .addbtn:hover{background:#f2c257}

/* 업무/개인 필터 */
.src{display:flex;gap:2px;padding:0 10px 7px;flex:none;align-items:center}
.src button{
  border:0;background:none;font:inherit;font-size:11px;color:var(--muted);
  padding:3px 9px;border-radius:11px;cursor:pointer;white-space:nowrap;
  display:flex;align-items:baseline;gap:4px;
}
.src button:hover{color:var(--text);background:var(--panel)}
.src button[aria-pressed="true"]{background:var(--panel);color:var(--text);font-weight:500}
.src button[aria-pressed="true"].work{box-shadow:inset 0 0 0 1px var(--q2)}
.src button[aria-pressed="true"].mine{box-shadow:inset 0 0 0 1px #8fb9ab}
.src .n{font-family:var(--mono);font-size:9px;opacity:.65;font-variant-numeric:tabular-nums}
.widget.narrow .src .n{display:none}

/* 추가 폼 — 브라우저 prompt()는 WebView2에서 동작하지 않아 직접 만든다 */
.addform{
  flex:none;margin:0 10px 8px;padding:8px;border-radius:9px;
  background:var(--panel);border:1px solid var(--line);
  display:flex;flex-direction:column;gap:6px;
}
.widget.tight .addform{margin-left:7px;margin-right:7px}
.addform input,.addform select{
  font:inherit;font-size:12px;color:var(--text);background:var(--ink);
  border:1px solid var(--line);border-radius:6px;padding:5px 7px;min-width:0;
}
.addform input:focus,.addform select:focus{outline:1px solid var(--accent);border-color:var(--accent)}
.addform .row{display:flex;gap:5px;flex-wrap:wrap}
.addform .row>*{flex:1 1 70px}
.addform .go,.addform .no{
  flex:0 0 auto;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;font:inherit;font-size:12px;
}
.addform .go{background:var(--accent);color:#15202b;font-weight:700}
.addform .no{background:none;color:var(--muted)}
.addform .no:hover{color:var(--text)}

/* 본문 */
.body{flex:1;overflow-y:auto;padding:0 10px 12px;scrollbar-width:thin}
.body::-webkit-scrollbar{width:7px}
.body::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
.body::-webkit-scrollbar-track{background:transparent}

.pinned-box{
  background:var(--panel);border-radius:9px;padding:8px 10px 6px;margin-bottom:9px;
  border-left:2px solid var(--accent);
}
.pinned-box h3{
  margin:0 0 3px;font-size:11px;font-weight:700;color:var(--accent);
  display:flex;align-items:center;gap:7px;letter-spacing:.01em;
}
.pinned-box h3 .rule{flex:1;height:1px;background:var(--line)}
.pinned-box h3 .cnt{font-variant-numeric:tabular-nums;font-weight:500;color:var(--muted)}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}
.widget.narrow .grid{grid-template-columns:1fr}

/* 400px 아래에서는 2x2를 유지한 채 여백만 조여 제목 폭을 벌어준다 */
.widget.tight .body{padding-left:7px;padding-right:7px}
.widget.tight .bar,.widget.tight .tabs,.widget.tight .src{padding-left:7px;padding-right:7px}
.widget.tight .grid{gap:5px}
.widget.tight .cell{padding:7px 6px 6px}
.widget.tight .pinned-box{padding:7px 8px 5px}
.widget.tight .cell h3{gap:2px 4px}
.widget.tight .cell h3 .axis{font-size:9px}
.widget.tight .item{gap:6px}
.widget.tight .tabs button{padding:4px 8px}
.widget.tight .src button{padding:3px 7px}

.cell{background:var(--panel);border-radius:9px;padding:8px 8px 7px;border-top:2px solid var(--line);min-width:0}
.cell.q1{border-top-color:var(--q1)}
.cell.q2{border-top-color:var(--q2)}
.cell.q3{border-top-color:var(--q3)}
.cell.q4{border-top-color:var(--q4)}
.cell h3{
  margin:0 0 5px;font-size:11px;font-weight:700;
  display:flex;align-items:baseline;gap:3px 6px;flex-wrap:wrap;
  word-break:keep-all;line-height:1.35;
}
.cell h3 .num{
  font-family:var(--mono);font-size:10px;padding:0 4px;border-radius:3px;flex:none;
  background:var(--line);color:var(--text);
}
.cell.q1 h3 .num{background:var(--q1);color:#fff}
.cell.q2 h3 .num{background:var(--q2);color:#fff}
.cell.q3 h3 .num{background:var(--q3);color:#20303f}
.cell.q4 h3 .num{background:var(--q4);color:#fff}
.cell h3 .axis{font-weight:400;color:var(--muted);font-size:10px}
.cell h3 .cnt{margin-left:auto;color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
.cell .empty{color:var(--muted);font-size:11px;padding:3px 0 2px;opacity:.7}
.more{
  display:block;width:100%;margin-top:4px;padding:3px 0;border:0;border-radius:5px;cursor:pointer;
  background:rgba(255,255,255,.045);color:var(--muted);font:inherit;font-size:10.5px;
}
.more:hover{background:rgba(255,255,255,.09);color:var(--text)}

ul{list-style:none;margin:0;padding:0}
.item{
  position:relative;display:flex;gap:7px;align-items:flex-start;padding:5px 0;
  border-bottom:1px solid rgba(255,255,255,.045);
}
.item:last-child{border-bottom:0}
.chk{
  flex:none;width:14px;height:14px;margin-top:2px;border-radius:4px;
  border:1.5px solid var(--line);background:none;cursor:pointer;padding:0;
}
.chk:hover{border-color:var(--accent);background:rgba(234,181,67,.2)}
.chk.done{border-color:var(--q4);background:var(--q4);position:relative}
.chk.done::after{
  content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;
  border:solid #16222e;border-width:0 2px 2px 0;transform:rotate(45deg);
}
.t{flex:1;min-width:0;line-height:1.42;word-break:keep-all;overflow-wrap:normal;hyphens:none}
.cell .t{font-size:12px}
.dt{
  font-family:var(--mono);font-size:10px;color:var(--muted);
  font-variant-numeric:tabular-nums;margin-left:5px;white-space:nowrap;
}
.dt.over{color:var(--q1)}
.tag{
  display:inline-block;margin-right:5px;padding:0 4px;border-radius:3px;vertical-align:1px;
  background:var(--ink);color:var(--muted);font-size:10px;
}
.tag.personal{color:#8fb9ab}
.wait{color:var(--q2);font-size:10px;margin-right:4px;vertical-align:1px}
.item.waiting .t{color:var(--muted)}
.memo{display:block;margin-top:2px;font-size:11px;color:var(--muted);line-height:1.4}
/* 도구 막대는 떠 있다. 가로 공간을 전혀 차지하지 않는다 */
.tools{
  position:absolute;right:-2px;top:2px;z-index:2;
  display:flex;align-items:center;gap:1px;padding:2px 3px;border-radius:6px;
  background:var(--panel-2);box-shadow:0 2px 8px rgba(0,0,0,.45);
  opacity:0;pointer-events:none;transition:opacity .1s;
}
.item:hover .tools,.item:focus-within .tools{opacity:1;pointer-events:auto}
/* 미분류와 기록 탭에서는 도구가 늘 보여야 한다.
   그 두 곳에서는 분류하고 되돌리는 것이 화면의 목적 자체다 */
.unsorted .tools,.tools.always{position:static;opacity:1;pointer-events:auto;background:none;box-shadow:none;padding:0}
.star{
  border:0;background:none;cursor:pointer;color:var(--line);font-size:11px;
  width:16px;height:16px;border-radius:4px;padding:0;line-height:1;
}
.star:hover,.star.on{color:var(--accent)}
.pri{display:flex;gap:1px}
.pri button{
  width:15px;height:16px;border:0;border-radius:4px;cursor:pointer;padding:0;
  font-family:var(--mono);font-size:9px;background:rgba(255,255,255,.05);color:var(--muted);
}
.pri .p1:hover,.pri .p1.on{background:var(--q1);color:#fff}
.pri .p2:hover,.pri .p2.on{background:var(--q2);color:#fff}
.pri .p3:hover,.pri .p3.on{background:var(--q3);color:#20303f}
.pri .p4:hover,.pri .p4.on{background:var(--q4);color:#fff}
.wbtn{
  border:0;background:none;cursor:pointer;color:var(--line);font-size:10px;
  width:16px;height:16px;border-radius:4px;padding:0;line-height:1;
}
.wbtn:hover,.wbtn.on{color:var(--q2)}
.del{
  border:0;background:none;cursor:pointer;color:var(--muted);font-size:14px;
  width:16px;height:16px;border-radius:4px;padding:0;line-height:1;
}
.del:hover{color:#fff;background:var(--q1)}
.undo{
  border:0;background:var(--panel-2);color:var(--muted);font:inherit;font-size:10px;
  padding:2px 7px;border-radius:5px;cursor:pointer;white-space:nowrap;
}
.undo:hover{background:var(--accent);color:#15202b;font-weight:500}

.group{margin-top:11px}
.group:first-child{margin-top:2px}
.group h3{display:flex;align-items:center;gap:7px;margin:0 0 1px;font-size:11px;font-weight:700;color:var(--muted)}
.group.past h3{color:var(--q1)}
.group h3 .rule{flex:1;height:1px;background:var(--line)}
.group h3 .cnt{font-variant-numeric:tabular-nums;font-weight:500}
.unsorted{
  margin-top:11px;background:rgba(234,181,67,.07);border:1px dashed rgba(234,181,67,.3);
  border-radius:9px;padding:7px 9px;
}
.unsorted h3{color:var(--accent)}
.unsorted .tip{margin:1px 0 3px;font-size:10px;color:var(--muted)}

.notice{padding:18px 4px;color:var(--muted);font-size:12px}
.notice b{display:block;color:var(--text);font-size:13px;margin-bottom:5px}

/* 아래에서 올라오는 알림 */
.toast{
  position:fixed;left:10px;right:10px;bottom:10px;z-index:20;
  background:var(--panel-2);border:1px solid var(--line);border-radius:8px;
  padding:7px 10px;font-size:11.5px;color:var(--text);
  box-shadow:0 6px 20px rgba(0,0,0,.5);
}
.toast.bad{border-color:var(--q1)}
.toast .h{color:var(--muted);font-size:10.5px;margin-top:2px}

/* 크기 조절 손잡이 */
.rz{position:absolute;z-index:15}
.rz.e{top:8px;right:0;width:6px;bottom:14px;cursor:ew-resize}
.rz.s{left:8px;bottom:0;height:6px;right:14px;cursor:ns-resize}
.rz.se{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize}
.rz.se::after{
  content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;
  background:
    linear-gradient(135deg,transparent 42%,var(--line) 42%,var(--line) 58%,transparent 58%),
    linear-gradient(135deg,transparent 72%,var(--line) 72%,var(--line) 88%,transparent 88%);
}
.widget.resizing{user-select:none}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style></head><body>

<section class="widget" id="w">
  <div class="bar pywebview-drag-region">
    <h2>할 일</h2>
    <span class="sub" id="stat"></span>
    <span class="spacer"></span>
    <label class="pin" title="다른 창 위에 계속 떠 있게 합니다">
      <input type="checkbox" id="ontop" checked> 항상 위
    </label>
    <button class="iconbtn" id="reload" title="새로고침">&#8635;</button>
    <button class="iconbtn" id="tray" title="트레이로 숨기기">&#9472;</button>
    <button class="iconbtn close" id="quit" title="종료">&#10005;</button>
  </div>

  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-tab="matrix">매트릭스</button>
    <button role="tab" aria-selected="false" data-tab="dates">날짜</button>
    <button role="tab" aria-selected="false" data-tab="log">기록</button>
    <button class="addbtn" id="add">+ 추가</button>
  </div>

  <div class="src" id="src" role="group" aria-label="보기 범위">
    <button data-src="all" aria-pressed="true">전체 <span class="n" id="n-all"></span></button>
    <button data-src="업무" class="work" aria-pressed="false">업무 <span class="n" id="n-work"></span></button>
    <button data-src="개인" class="mine" aria-pressed="false">개인 <span class="n" id="n-mine"></span></button>
  </div>

  <form class="addform" id="addform" hidden>
    <input id="a-title" placeholder="할 일 (동사형으로, 기한까지)" autocomplete="off">
    <div class="row">
      <select id="a-tag"></select>
      <select id="a-q"></select>
      <input id="a-due" type="date">
      <button type="submit" class="go">추가</button>
      <button type="button" class="no" id="a-cancel">취소</button>
    </div>
  </form>

  <div class="body" id="body"><div class="notice">불러오는 중…</div></div>

  <div class="rz e" data-dir="e"></div>
  <div class="rz s" data-dir="s"></div>
  <div class="rz se" data-dir="se"></div>
</section>

<script>
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

const api = () => (window.pywebview && window.pywebview.api) || null;
const md = (iso) => iso ? `${+iso.slice(5,7)}/${+iso.slice(8,10)}` : "";
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

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
  const a = api();
  if (!a) return Promise.resolve({ok:false, error:"준비되지 않았다"});
  return a[name](...args).then(r => {
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
  const a = api();
  if (!a) return;
  busy(true);
  const r = await a.data();
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
  const a = api();
  if (!a) return;
  busy(true);
  const r = await a.log();
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

window.addEventListener("resize", () => { syncNarrow(); if (tab === "matrix") fitCells(); });
window.addEventListener("focus", () => { if (items.length) schedulePull(); });
setInterval(() => { if (!document.hidden) pull(); }, 5 * 60 * 1000);

window.addEventListener("pywebviewready", () => { syncNarrow(); pull(); });
syncNarrow();
</script></body></html>"""


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

    def log(self):
        return guarded(load_done)

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
        window.resize(int(width), int(height))
        return {"ok": True}

    def ontop(self, on):
        window.on_top = bool(on)
        return {"ok": True}

    def minimize(self):
        # 트레이가 없으면 숨길 수 없다. 되살릴 방법이 없어진다.
        if TRAY_AVAILABLE:
            window.hide()
        return {"ok": True}

    def quit(self):
        if TRAY_AVAILABLE:
            quit_app()
        else:
            window.destroy()
        return {"ok": True}


window = webview.create_window(
    "할 일",
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
