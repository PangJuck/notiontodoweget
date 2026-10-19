# ui/characters/lines.json -> docs/캐릭터-대사-목록.md (사람이 읽는 꼴). lines.json 을 고친 뒤 돌린다
import io, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABEL = [
    ("morning", "아침 인사 (5~12시)"), ("lunch", "점심 인사 (12시)"), ("afternoon", "오후 인사 (13~18시)"),
    ("evening", "저녁 인사 (18시 뒤)"), ("todaySome", "오늘의 3 중 일부 끝냈을 때"),
    ("todayNone", "오늘의 3 하나도 못 했을 때"), ("todayAll", "오늘의 3 다 끝냈을 때"),
    ("todayEmpty", "오늘의 3 이 비어 있을 때"), ("todayPick", "오늘의 3 을 고르라고 할 때"),
    ("todoTop", "가장 급한 할 일 알려 줄 때"), ("remind", "할 일 일깨울 때"), ("praiseDone", "끝낸 일 칭찬할 때"),
    ("cheer", "응원 (누를 때, 할 일 끝낼 때, 혼자 말할 때 하나씩 무작위)"), ("sprint", "질주할 때 (늘, 큰 말풍선)"),
    ("shout", "외칠 때 (큰 말풍선이 떨린다)"), ("nonsense", "혼잣말"), ("dodge", "잡으려 하면 피하면서"),
    ("poke", "누르면 반응한다고 알릴 때 (혼자 말할 때 15%)"), ("tap", "눌렀을 때 (몸짓과 함께)"),
]

d = json.load(io.open(os.path.join(ROOT, "ui/characters/lines.json"), encoding="utf-8"))
out = ["# 캐릭터 대사 목록", "",
       "원본 : `ui/characters/lines.json`. 고치려면 그 파일을 고치고 `python scripts/lines_doc.py` 로 이 문서를 다시 뽑는다. "
       "빈 칸은 그 캐릭터에 없어서 응원 중 하나가 무작위로 나온다. 여러 줄이면 그중 하나가 무작위로 나온다.",
       "`{total}` 오늘의 3 개수, `{done}` 끝낸 개수, `{left}` 남은 개수, `{rest}` 남은 일 제목, `{n}` 할 일 개수, "
       "`{title}` 할 일 제목, `{titles}` 끝낸 일 제목들", ""]
for cid, c in d.items():
    out += [f"## {c['name']} (`{cid}`)", ""]
    for k, label in LABEL:
        v = c.get(k)
        if v is None:
            continue
        if isinstance(v, str) or len(v) == 1:
            out.append(f"- {label} : {v if isinstance(v, str) else v[0]}")
        else:
            out.append(f"- {label}")
            out += [f"  - {x}" for x in v]
    out.append("")
io.open(os.path.join(ROOT, "docs/캐릭터-대사-목록.md"), "w", encoding="utf-8", newline="\n").write("\n".join(out))
