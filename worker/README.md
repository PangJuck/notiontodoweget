# 웹판 배포 (Cloudflare Workers)

바탕화면 위젯과 화면 코드(`ui/`)를 완전히 같이 쓰는 브라우저판이다. 서버는
토큰을 쥐고 노션과 이야기하는 얇은 중계층 하나뿐이고, 데이터는 노션 그
자체이니 별도 DB가 없다.

**로그인 화면이 없다.** 문을 지키는 것은 Cloudflare Access뿐이므로, 배포하자마자
아래 Access 설정까지 반드시 끝낸다. 그 전까지는 URL을 아무에게도 공유하지 않는다.

여러 사람이 각자 자기 할 일만 보게 하려면 아래 **팀 모드**를 참고한다.

## 사전 준비 (사람이 직접, 한 번만)

1. https://dash.cloudflare.com 에 무료 계정 (신용카드 필요 없음)
2. Node.js 설치 (wrangler가 필요로 한다)

## 배포

```bash
cd worker
npm install
npx wrangler login          # 브라우저가 뜨고 Cloudflare 로그인
npx wrangler secret put NOTION_TOKEN
# 프롬프트가 뜨면 노션 Integration 토큰을 붙여넣는다.
# 이 토큰은 wrangler가 Cloudflare에 암호화해 저장할 뿐, 이 저장소
# 어디에도, 이 터미널 기록에도 평문으로 남지 않는다.
npx wrangler deploy
```

배포가 끝나면 `https://todo-widget-web.<계정이름>.workers.dev` 같은
주소가 나온다. **이 주소를 아직 아무에게도 주지 않는다.**

## Cloudflare Access로 잠그기 (필수)

Cloudflare 대시보드 → Zero Trust → Access → Applications → **Add an
application** → Self-hosted.

- Application domain: 위에서 받은 `*.workers.dev` 주소
- Policy: `Include` → `Emails` → 본인 이메일 하나만
- 세션 길이는 편한 대로 (예: 24시간)

저장하면 그 주소에 접속할 때마다 Cloudflare 로그인 화면이 먼저 뜨고,
등록한 이메일로만 통과한다. 50명까지 무료다.

## 팀 모드 (여러 사람이 각자 자기 것만 보기)

켜기 전까지는 위에 적힌 대로 성준 혼자 쓰는 상태 그대로다. `TEAM` 시크릿을
넣는 순간부터 팀 모드로 바뀐다.

누가 접속했는지는 **Access가 서명해 보낸 토큰**에서만 꺼낸다. 브라우저가
보내는 헤더나 본문 값은 하나도 믿지 않는다. 거르는 일도 전부 워커가 하므로,
남의 항목은 애초에 브라우저로 나가지 않는다 — 개발자도구를 열어도 없다.

| | 보는 것 | 고치는 것 |
|---|---|---|
| 관리자 (admins에 적힌 사람) | 업무 · 개인 · 팀 전체 | 전부 |
| 팀원 | 팀 DB 전체 (담당자 줄로 사람별 전환) | **자기가 담당자인 것만** |

팀이 서로의 할 일을 열어 두기로 해서 보는 것은 전원 공개다. 고치는 것은 자기
것만인데, 남의 할 일을 실수로 완료 처리하거나 지우는 일을 막기 위해서다. 화면은
팀원에게 자기 것부터 보여주고, 동료는 눌러서 본다.

팀 DB는 성준 개인 워크스페이스의 비공개 DB다. **팀원에게 노션 자체는 공유하지
않는다** — 공유하는 순간 워커가 거르는 의미가 없어진다. Integration
(`notion_todo-widget`)만 연결해 두면 된다.

### 1. AUD 태그 채우기

Zero Trust → Access → Applications → 해당 앱 → 개요의 **Application Audience
(AUD) Tag**를 복사해 `wrangler.toml`의 `ACCESS_AUD`에 넣는다. `ACCESS_DOMAIN`은
팀 도메인(`ulicktodo.cloudflareaccess.com`)이다.

둘 중 하나라도 비어 있으면 팀 모드는 **켜지지 않고 막힌다**. 열려버리는 쪽으로
넘어가지 않는다.

### 2. 사람 등록

```bash
cd worker
npx wrangler secret put TEAM
```

프롬프트에 한 줄 JSON을 붙여넣는다. `members`의 값은 노션 팀 DB의 `담당자`
선택지와 **글자까지 똑같아야** 한다.

```json
{"admins":["나@회사.com"],"members":{"나@회사.com":"성준","가영@회사.com":"가영","창준@회사.com":"창준","여림@회사.com":"여림"}}
```

이메일은 시크릿으로 들어가므로 저장소에 남지 않는다. 사람이 바뀌면 이 명령을
다시 실행해 통째로 새로 넣는다.

### 3. Access 정책에 같은 이메일 넣기

Zero Trust → Access → Applications → 앱 → 정책에서 `Emails`에 네 명을 모두
추가한다. **두 군데가 따로 논다** — Access 정책은 "문을 통과할 수 있는가",
`TEAM` 시크릿은 "통과한 사람이 누구인가"다. 정책에만 있고 시크릿에 없으면
"등록되지 않은 사용자다"가 뜬다.

### 4. 배포

```bash
npx wrangler deploy
```

## 팀원이 자기 Claude에서 쓰게 하기 (MCP)

워커의 `/mcp` 가 팀원의 Claude Code가 붙는 문이다. 노션을 직접 열어 주지 않고 이
문만 여는 이유는, 노션에 권한을 주는 순간 그 사람이 **전원 할 일을 다 보게** 되기
때문이다. `/mcp` 는 화면(`/api/*`)과 **똑같은 신원 확인과 거르기**를 지나므로
여기서도 자기 것만 오간다.

사람 대신 프로그램이 Access를 통과해야 하므로 **서비스 토큰**을 쓴다. 토큰
하나가 사람 하나를 가리키고, 워커는 토큰의 Client ID로 누구인지 판단한다.

### 1. 서비스 토큰 만들기 (사람마다 하나)

Zero Trust → 액세스 제어 → **서비스 자격 증명** → 서비스 토큰 만들기.
이름은 사람 이름으로 (`가영`, `창준`, ...). **Client Secret은 만들 때 한 번만
보인다** — 못 받았으면 지우고 다시 만든다.

### 2. Access 정책에 허용 추가

애플리케이션 → `todo-widget-web` → 정책 → **새 정책**:
작업 **서비스 인증(Service Auth)**, 포함 규칙 **서비스 토큰** → 만든 토큰들 선택.

기존 이메일 정책은 그대로 둔다. 사람은 이메일로, 프로그램은 토큰으로 들어온다.

### 3. 안내 파일 만들기

```bash
python scripts/make_member_guide.py
```

지금 쓰는 `TEAM` JSON을 붙여넣고 사람마다 Client ID/Secret을 넣으면,
`guides/<이름>.md` 와 **새 `TEAM` JSON**이 나온다. 팀원은 그 .md 하나를 자기
Claude에 던지면 설정이 끝난다.

`admins`에 있는 사람의 토큰은 스크립트가 알아서 `admins`에도 넣는다. 이걸
빠뜨리면 관리자가 자기 Claude에서만 팀원처럼 보이는데, 알아채기 어렵다.

### 4. 새 TEAM 시크릿 넣기

```bash
cd worker
npx wrangler secret put TEAM
```

배포는 필요 없다. 시크릿은 넣는 즉시 적용된다.

`guides/`는 `.gitignore`에 있다. 토큰이 든 파일이므로 1:1로 건네고, 사람이
바뀌면 Cloudflare에서 그 토큰을 지운 뒤 `TEAM`에서도 빼면 그 순간 막힌다.

## 로컬에서 미리 보기

```bash
cd worker
cp .dev.vars.example .dev.vars   # NOTION_TODO_TOKEN 대신 NOTION_TOKEN 키로 채운다
npx wrangler dev
```

`.dev.vars`는 로컬 전용이고 git에 올라가지 않는다 (`.gitignore` 참고).
배포된 워커에는 영향을 주지 않는다 — 그쪽은 `wrangler secret put`으로
넣은 값을 쓴다.

## 업데이트

화면(`ui/`)이나 노션 호출 로직(`worker/index.js`)을 고친 뒤:

```bash
cd worker
npx wrangler deploy
```

토큰을 다시 넣을 필요는 없다. 시크릿은 배포와 별개로 유지된다.

## 위젯과 다른 점

`ui/app.js`는 `window.Backend`라는 창구 하나만 알고, 그 뒤가 위젯인지
웹인지는 모른다.

- 위젯: `ui/adapter-widget.js`가 `pywebview.api`를 부른다
- 웹: `ui/adapter-web.js`가 `fetch("/api/...")`로 이 워커를 부른다

`Backend.chrome`이 `false`면 항상 위 / 트레이로 숨기기 / 종료 / 크기 조절
손잡이처럼 OS 창에서만 의미 있는 조작을 화면에서 숨긴다(`app.css`의
`.widget.web` 규칙). 브라우저 탭은 원래 있는 새로고침·닫기로 충분하다.
