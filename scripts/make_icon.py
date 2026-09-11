"""assets/app.png 을 Windows용 assets/app.ico 로 굽는다.

build_exe.ps1이 빌드 전에 자동으로 부른다. 따로 실행할 일은 거의 없다.

- assets/app.png 이 있으면 그걸 쓴다. (성준님이 고른 아이콘)
- 없으면 4사분면 모양을 직접 그려서 임시로 쓴다.
  최소한 파이썬 기본 깃털 아이콘은 나오지 않게 하려는 것이다.

.ico 안에 16~256px를 전부 넣는다. 윈도우가 작업표시줄, 바탕화면,
Alt+Tab에서 각각 다른 크기를 집어가기 때문이다.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZES = [16, 24, 32, 48, 64, 128, 256]
ASSETS = Path(__file__).resolve().parent / "assets"
PNG = ASSETS / "app.png"
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

    그냥 늘리면 캐릭터가 찌그러지므로 비율은 건드리지 않는다.
    """
    img = img.convert("RGBA")
    w, h = img.size
    if w == h:
        return img
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


def load_source():
    if PNG.exists():
        return squared(Image.open(PNG)), str(PNG)
    return draw_fallback(), "fallback(4사분면 임시 그림)"


def main():
    ASSETS.mkdir(exist_ok=True)
    src, origin = load_source()
    src.save(ICO, format="ICO", sizes=[(s, s) for s in SIZES])
    print(f"{ICO} <- {origin}")
    if not PNG.exists():
        print("assets/app.png 을 넣으면 다음 빌드부터 그 아이콘을 쓴다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
