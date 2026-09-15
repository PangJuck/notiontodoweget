"""팀원에게 건넬 안내 파일(.md)과 새 TEAM 시크릿을 한 번에 만든다.

안내문 내용만 바뀌었으면 토큰을 다시 넣을 것 없이:

    python scripts\\make_member_guide.py --refresh

이미 만들어 둔 guides\\*.md에서 토큰을 그대로 꺼내 본문만 새로 쓴다.


팀원이 할 일은 받은 .md 하나를 자기 Claude에 던지는 것뿐이다. 그 안에
설정 명령이 토큰까지 채워진 채로 들어 있어서, Claude가 읽고 스스로 붙는다.

쓰는 법:  python scripts\\make_member_guide.py

만들어진 .md에는 그 사람의 서비스 토큰이 들어 있다. 단톡방에 올리지 말고
1:1로 건네고, 다 쓰면 지운다. guides/ 폴더는 git에 올라가지 않는다.
"""
import json
import re
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "guides"
DEFAULT_URL = "https://todo-widget-web.pangtodo.workers.dev"

GUIDE = """# 울릭 할 일 — {name}님

이 파일 하나면 설정이 끝납니다. **Claude Code를 아무 폴더에서나 열고, 이 파일을
끌어다 놓은 뒤 "이거 보고 세팅해줘" 라고 말씀하시면 됩니다.**

---

## Claude에게

아래를 순서대로 해줘.

**1. 이 명령을 실행해줘** (한 줄이다):

```
claude mcp add --transport http --scope user ulick-todo {url}/mcp --header "CF-Access-Client-Id: {client_id}" --header "CF-Access-Client-Secret: {client_secret}"
```

**2.** 성공했으면 `claude mcp list` 로 `ulick-todo` 가 연결됐는지 확인해줘.

**2-1.** 그리고 `~/.claude/commands/scmtodo.md` 파일을 아래 내용으로 만들어줘.
(윈도우면 `C:\\Users\\<사용자>\\.claude\\commands\\scmtodo.md`. 폴더가 없으면 만든다.)
이러면 어느 폴더에서든 `/scmtodo` 로 부를 수 있다.

````markdown
---
description: Ulick To-do - 할 일 넣기, 보기, 끝내기
argument-hint: [할 일이나 질문. 비우면 남은 할 일을 보여줍니다]
---

Ulick To-do(ulick-todo MCP 서버)로 처리한다.

요청: $ARGUMENTS

- 요청이 비어 있으면 list_todos로 내 남은 할 일을 사분면별로 보여준다.
- 새 할 일이면 add_todo로 넣는다. 동사형으로 다듬고, 기한이 있으면 마감일에 넣고,
  사분면을 정한다. 한 문장에 여러 건이 섞여 있으면 쪼갠다.
- "끝냈어" 같은 말이면 list_todos로 그 항목을 찾아 complete_todo 한다.
  어느 것인지 애매하면 후보를 보여주고 고르게 한다.
- 동료 이름이 나오면 owner를 그 사람으로 지정해 조회한다.

짧게 답한다. 넣거나 끝낸 것만 한 줄씩 보여주면 된다.
````

**3.** 연결됐으면 `list_todos` 를 한 번 불러서 지금 남은 할 일을 보여줘.
   (처음이면 비어 있는 게 정상이다.)

**4.** 마지막으로 이 세 가지를 짧게 안내해줘:

   - **그냥 말하면 된다.** 명령어를 외울 필요 없다.
     "오늘 할 일 뭐 남았어?", "○○ 내일까지 넣어줘", "○○ 끝냈어"
   - **`/scmtodo` 로 부를 수 있다.** 뒤에 그냥 말을 붙이면 된다.
     `/scmtodo 3PL 견적서 비교표 내일까지` / 비우고 엔터 치면 남은 할 일
   - **아침·퇴근 정리도 슬래시로 있다.** `/` 치고 `ulick` 이라고 치면 걸러진다.
     `morning` = 아침 정리, `evening` = 퇴근 정리
     목록에 안 보이면 Claude Code를 껐다 켜라고 알려줘.
   - **작업하다 미룬 일이 생기면 내가 먼저 물어본다.** "Ulick To-do에 넣어둘까요?"
     하고 한 줄로. 필요 없으면 아니라고 하면 되고, 그 세션에서 다시 묻지 않는다.

설정은 이 컴퓨터에 한 번만 하면 되고, 다음부터는 어느 폴더에서 Claude를 켜도
바로 쓸 수 있다.

---

## 쓰는 법

### `/scmtodo` — 제일 빠른 길

```
/scmtodo 3PL 견적서 3곳 비교표 내일까지 만들기
```

뒤에 그냥 말을 붙이면 됩니다. **비우고 엔터**만 쳐도 남은 할 일을 보여줍니다.

```
/scmtodo                     남은 할 일 보기
/scmtodo 위클리 양식 끝냈어    완료 처리
/scmtodo 창준님 뭐 하고 있어?  동료 할 일 보기
```

### 하루의 시작과 끝

Claude Code에서 **`/`** 를 치고 **`ulick`** 이라고 쳐보세요. 두 개가 뜹니다.

| | 언제 | 하는 일 |
|---|---|---|
| **아침 정리** (`morning`) | 하루 시작할 때 | 남은 일 훑기 → 지난 마감 짚기 → **오늘 끝낼 3개** 고르기 |
| **퇴근 정리** (`evening`) | 하루 끝낼 때 | 오늘 한 일 정리 → 못 끝낸 것 내일로 → **내일 첫 일** 정하기 |

이 두 개만 습관이 되면 나머지는 저절로 굴러갑니다.

### 평소에는 — 그냥 말하기

설정이 끝나면 Claude에게 그냥 말로 하시면 됩니다.

- **"오늘 할 일 뭐 남았어?"**
- **"3PL 견적서 3곳 비교표 내일까지, 그리고 가영님한테 드랍테스트 일정 물어보기 — 정리해서 넣어줘"**
  → 두 건으로 쪼개서 사분면까지 정해 넣어줍니다
- **"위클리 양식 만들기 끝냈어"**
- **"오늘 이 세 개만 하자"** → 오늘 꼭 끝낼 것으로 고정
- **"물류팀 회신 기다리는 중이야"** → 대기중 표시
- **"이번 주에 뭐 했지?"**

할 일은 **중요도 × 급함**으로 네 칸에 들어갑니다.

| | 급함 | 안 급함 |
|---|---|---|
| **중요** | 1 지금 당장 | 2 핵심 업무 |
| **안 중요** | 3 빠르게 쳐낼 | 4 언젠가 |

2번 칸을 비워두면 나중에 전부 1번이 됩니다. 거기가 제일 중요합니다.

## 브라우저로도 볼 수 있습니다

{url}

같은 데이터라 어느 쪽에서 고쳐도 같이 바뀝니다. 폰에서도 됩니다.
처음 들어가면 회사 메일로 6자리 코드를 받아 입력하시면 됩니다.

## 알아두실 것

- 화면을 열면 **{name}님 할 일부터** 보입니다
- 위쪽 `담당자` 줄에서 **동료 이름을 누르면 그 사람 할 일도 볼 수 있습니다.**
  팀에서 서로 열어두기로 한 부분입니다. Claude에게 "창준님 뭐 하고 있어?" 라고
  물어도 됩니다
- **고치고 완료 처리하는 건 본인 것만 됩니다.** 남의 항목은 막힙니다 — 실수로
  남의 할 일을 지우는 일을 없애려는 것입니다
- **작업하다 미룬 일이 생기면 Claude가 먼저 물어봅니다.** "Ulick To-do에 넣어둘까요?"
  하고 한 줄로요. 필요 없으면 아니라고 하시면 되고, 그 세션에서는 다시 안 묻습니다
- 이 파일에는 {name}님 전용 열쇠가 들어 있습니다. 다른 사람에게 넘기지 마세요
"""


# 안내문 안의 설정 명령에서 토큰을 도로 꺼낸다. --refresh가 이걸로 돈다.
TOKEN_RE = re.compile(
    r'CF-Access-Client-Id:\s*(\S+?)"\s*--header\s*"CF-Access-Client-Secret:\s*(\S+?)"'
)
URL_RE = re.compile(r"(https://\S+?)/mcp\b")


def refresh():
    """토큰은 그대로 두고 안내문만 새 틀로 다시 쓴다."""
    existing = sorted(OUT.glob("*.md")) if OUT.exists() else []
    if not existing:
        sys.exit(f"{OUT} 에 안내 파일이 없다. 먼저 --refresh 없이 한 번 실행하세요.")
    for path in existing:
        old = path.read_text(encoding="utf-8")
        token = TOKEN_RE.search(old)
        url = URL_RE.search(old)
        if not token or not url:
            print(f"   건너뜀 ({path.name}): 토큰을 찾지 못했다")
            continue
        path.write_text(
            GUIDE.format(name=path.stem, url=url.group(1),
                         client_id=token.group(1), client_secret=token.group(2)),
            encoding="utf-8",
        )
        print(f"   다시 씀 -> {path.name}")
    print("\n토큰은 그대로다. 팀원에게 새 파일을 다시 보내면 된다.")
    print("(이미 세팅을 마친 사람은 다시 할 필요 없다 — 안내문만 바뀌었다.)")


def ask(prompt, default=""):
    got = input(f"{prompt}{f' [{default}]' if default else ''}: ").strip()
    return got or default


def main():
    print(__doc__)
    if "--refresh" in sys.argv:
        refresh()
        return
    print("먼저 지금 쓰고 있는 TEAM 시크릿을 한 줄로 붙여넣으세요.")
    print("(모르면 취소하고 worker/README.md의 '팀 모드'를 보세요.)\n")
    raw = input("TEAM JSON> ").strip()
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError as e:
        sys.exit(f"\nJSON을 읽지 못했다: {e}\n한 줄 전체를 빠짐없이 붙여넣었는지 확인하세요.")

    members = cfg.get("members") or {}
    if not members:
        sys.exit("members가 비어 있다. TEAM 시크릿을 다시 확인하세요.")

    url = ask("\n웹 주소", DEFAULT_URL).rstrip("/")
    admins = [a.strip().lower() for a in cfg.get("admins", [])]
    tokens = dict(cfg.get("tokens") or {})

    OUT.mkdir(exist_ok=True)
    made = []
    print("\n사람마다 서비스 토큰을 입력하세요. 만들지 않았으면 그냥 엔터로 넘기면 됩니다.")
    print("(Cloudflare: Zero Trust > 액세스 제어 > 서비스 자격 증명)\n")
    for email, name in members.items():
        print(f"── {name} ({email})")
        client_id = ask("   Client ID")
        if not client_id:
            print("   건너뜀\n")
            continue
        client_secret = ask("   Client Secret")
        if not client_secret:
            print("   Secret이 없어 건너뜀\n")
            continue

        key = client_id.strip().lower()
        tokens[key] = name
        # 관리자 본인의 토큰도 관리자여야 한다. 안 그러면 자기 Claude에서만
        # 팀원처럼 보인다 — 알아채기 어려운 함정이라 여기서 자동으로 맞춘다.
        if email.strip().lower() in admins and key not in admins:
            admins.append(key)

        path = OUT / f"{name}.md"
        path.write_text(
            GUIDE.format(name=name, url=url, client_id=client_id.strip(), client_secret=client_secret.strip()),
            encoding="utf-8",
        )
        made.append(path)
        print(f"   -> {path.name}\n")

    if not made:
        sys.exit("만든 것이 없다.")

    cfg["admins"] = admins
    cfg["tokens"] = tokens

    print("=" * 70)
    print("1) 아래 한 줄을 새 TEAM 시크릿으로 넣으세요:\n")
    print("   cd worker")
    print("   npx wrangler secret put TEAM\n")
    print(json.dumps(cfg, ensure_ascii=False, separators=(",", ":")))
    print()
    print("=" * 70)
    print(f"2) guides\\ 안의 파일을 각자에게 1:1로 보내세요 ({len(made)}개):")
    for p in made:
        print(f"   - {p.name}")
    print("\n   토큰이 들어 있는 파일입니다. 단톡방에 올리지 마세요.")


if __name__ == "__main__":
    main()
