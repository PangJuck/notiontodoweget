"""assets/app.png 을 Windows용 assets/app.ico 로 굽는다.

build_exe.ps1이 빌드 전에 자동으로 부른다. 따로 실행할 일은 거의 없다.

- assets/app.png      : 기본 그림. 48px 이상에서 쓴다
- assets/app.small.png: 16~32px 전용(선택). 작은 데서는 전체 그림이
                        뭉개져서, 주인공만 크게 잘라둔 걸 대신 쓴다.
                        없으면 app.png를 모든 크기에 쓴다
- 둘 다 없으면 4사분면 모양을 그려서 쓴다. 파이썬 기본 깃털 아이콘은
  어떤 경우에도 나오지 않게 한다

.ico 안에 16~256px를 전부 넣는다. 윈도우가 트레이(16), 작업표시줄(24~32),
바탕화면(48~256)에서 각각 다른 크기를 집어가기 때문이다.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = [16, 24, 32, 48, 64, 128, 256]
SMALL_MAX = 32  # 이 크기 이하에서 app.small.png를 쓴다

ASSETS = Path(__file__).resolve().parent / "assets"
PNG = ASSETS / "app.png"
SMALL = ASSETS / "app.small.png"
ICO = ASSETS / "app.ico"


def draw_fallback(size=256):
    """아이콘 파일이 아직 없을 때 쓰는 4사분면 그림."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size / 64
    d.rounded_rectangle((3 * u, 3 * u, 60 * u, 60 * u), radius=12 * u, fill=(22, 32, 43, 255))
    d.rectangle((8 * u, 8 * u, 30 * u, 30 * u), fill=(229, 99, 107, 255))
    d.rectangle((34 * u, 8 * u, 56 * u, 30 * u), fill=(91, 157, 217, 255))
    d.rectangle((8 * u, 34 * u, 30 * u, 56 * u), fill=(242, 177, 52, 255))
    d.rectangle((34 * u, 34 * u, 56 * u, 56 * u), fill=(107, 127, 142, 255))
    return img


def squared(img):
    """가로세로가 다른 그림을 투명 여백으로 정사각형에 맞춘다.

    그냥 늘리면 그림이 찌그러지므로 비율은 건드리지 않는다.
    """
    img = img.convert("RGBA")
    w, h = img.size
    if w == h:
        return img
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def load(path):
    if not path.exists():
        return None
    try:
        return squared(Image.open(path))
    except OSError:
        print(f"경고: {path.name} 을 읽지 못했다. 건너뛴다.")
        return None


def main():
    ASSETS.mkdir(exist_ok=True)

    full = load(PNG)
    origin = str(PNG)
    if full is None:
        full, origin = draw_fallback(), "fallback(4사분면 임시 그림)"
    small = load(SMALL) or full

    # 크기마다 그림을 직접 만들어 넘긴다. Pillow에 그냥 맡기면 두 가지로 샌다.
    #   - 원본보다 큰 크기는 경고 없이 통째로 빠진다 (155px 원본 -> 256px 누락)
    #   - 내부적으로 thumbnail()을 써서 확대를 아예 하지 않는다
    frames = [
        (small if s <= SMALL_MAX else full).resize((s, s), Image.LANCZOS)
        for s in SIZES
    ]
    frames.sort(key=lambda f: f.size[0])
    base = frames[-1]  # 가장 큰 것을 기준 이미지로 둬야 나머지가 다 통과한다

    base.save(ICO, format="ICO", sizes=[(s, s) for s in SIZES], append_images=frames[:-1])

    got = sorted(s for s, _ in Image.open(ICO).info.get("sizes", []))
    if got != sorted(SIZES):
        print(f"경고: .ico에 {got} 만 들어갔다. {sorted(SIZES)} 를 기대했다.")
        return 1

    print(f"{ICO} <- {origin} {got}")
    if SMALL.exists():
        print(f"  16~{SMALL_MAX}px 는 {SMALL.name} 을 썼다.")
    if not PNG.exists():
        print("  assets/app.png 을 넣으면 다음 빌드부터 그 아이콘을 쓴다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
