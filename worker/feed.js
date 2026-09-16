/* 개인 할 일을 달력 한 장(.ics)으로 내보낸다.
 *
 * 구글 캘린더가 이 주소를 **구독**한다(설정 → 다른 캘린더 추가 → URL로 추가).
 * 방향이 한쪽뿐이라는 것이 요점이다 — 노션이 원본이고, 구글은 읽기만 한다.
 * 구글이 주는 개인 iCal 주소(.../basic.ics)로는 반대로 쓸 수가 없다. 읽기
 * 전용이기 때문이다. 그래서 우리 쪽이 내주고 구글이 받아 간다.
 *
 * 이 주소는 **구글 서버가 로그인 없이 읽어야 하므로 Cloudflare Access 밖에
 * 있다.** 문을 지키는 것은 주소에 박힌 긴 난수 하나뿐이다. 그러니:
 *   - 토큰은 길고 무작위여야 한다 (32바이트 이상)
 *   - 나가는 것은 성준의 개인 DB뿐이다. 팀 DB는 이 문으로 나가지 않는다
 *   - 주소를 아는 사람은 제목을 다 본다. 링크를 흘리면 그걸로 끝이다
 * 설정 방법은 worker/README.md의 "개인 할 일을 구글 캘린더에" 절에 있다.
 */

/* ics는 쉼표·세미콜론·역슬래시·줄바꿈에 뜻이 있다. 그대로 두면 한 줄이
   두 값으로 쪼개져 읽힌다. 콜론은 escape 하지 않는다 — 규격에 없다. */
export function icsEscape(text) {
  return String(text == null ? "" : text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/* 한 줄은 75옥텟까지다. 넘으면 다음 줄로 접고 맨 앞에 공백 한 칸을 둔다.
   **글자가 아니라 바이트로 센다** — 한글은 한 글자가 3바이트다. 그렇다고
   바이트로 자르면 글자가 반토막 나므로, 코드포인트 단위로 담다가 넘칠 때
   끊는다. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // 이어지는 줄은 앞의 공백 한 칸까지 합쳐 75옥텟이라 74만 쓸 수 있다
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  if (cur) parts.push(cur);
  return parts[0] + parts.slice(1).map((s) => `\r\n ${s}`).join("");
}

const ymd = (iso) => String(iso || "").slice(0, 10).replace(/-/g, "");

/* 마감일 하루짜리 종일 일정. DTEND는 그 다음 날이다 — ics에서 끝 날짜는
   포함하지 않는다. 하루를 더하지 않으면 구글에서 0일짜리로 보여 사라진다. */
function nextDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/* 항목: {id, title, due, memo, q} — 마감일이 없는 것은 달력에 자리가 없다.
   stamp는 시험에서 고정값을 넣으려고 인자로 뺐다. */
export function buildIcs(items, { name = "할 일", stamp = new Date() } = {}) {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ulick To-do//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(name)}`,
    "X-WR-TIMEZONE:Asia/Seoul",
    // 구글에 "이 캘린더는 30분마다 다시 봐 달라"고 부탁하는 값이다. 부탁일
    // 뿐이고 실제 주기는 구글이 정한다 — 보통 몇 시간이다.
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];
  for (const it of items) {
    if (!it.due) continue;
    const bits = [];
    if (it.q) bits.push(`${it.q}순위`);
    if (it.memo) bits.push(it.memo);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${String(it.id).replace(/-/g, "")}@ulick-todo`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(it.due)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(it.due.slice(0, 10)))}`,
      `SUMMARY:${icsEscape(it.title)}`,
      ...(bits.length ? [`DESCRIPTION:${icsEscape(bits.join(" · "))}`] : []),
      // 종일 할 일 때문에 하루가 "바쁨"으로 잡히면 남이 회의를 못 잡는다
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
