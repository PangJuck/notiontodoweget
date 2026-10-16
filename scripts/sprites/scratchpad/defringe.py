"""Recolor white rim pixels around the outline to black (alpha untouched); soften stair-stepped alpha at open gap cuts."""
import numpy as np
from PIL import Image, ImageFilter
SP = "C:/Users/CONSTATN/Desktop/notiontodoweget/scripts/sprites/scratchpad"
OUT = "C:/Users/CONSTATN/Desktop/notiontodoweget/ui/characters"
mf = lambda m, s: np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(s))) > 0

def fix(src, dst, blur=1.5):
    a = np.array(Image.open(src).convert("RGBA")).astype(np.float32)
    rgb, A = a[..., :3], a[..., 3]
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    neutral = (rgb.max(2) - rgb.min(2)) < 40
    ink = (A > 200) & (lum < 110)
    tr = A < 10
    near_ink = mf(ink, 5)
    rim = (A > 0) & (lum > 120) & neutral & mf(tr, 5) & near_ink
    rgb[rim] = 0
    # gap cuts: white body meeting transparency with no stroke nearby
    edge = (A > 0) & (lum > 200) & neutral & mf(tr, 3) & ~mf(ink, 9)
    zone = mf(edge, 5) & ~mf(ink, 7)
    As = np.array(Image.fromarray(A.astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(np.float32)
    newly = zone & (A < 10) & (As >= 10)
    rgb[newly] = 255
    A = np.where(zone, As, A)
    out = np.dstack([rgb, A]).round().clip(0, 255).astype(np.uint8)
    Image.fromarray(out, "RGBA").save(dst)
    return int(rim.sum()), int(zone.sum())

if __name__ == "__main__":
    for c in ["hachi", "momonga"]:
        for f in ["eyes_open", "eyes_closed"]:
            print(c, f, fix(f"{SP}/orig_backup/{c}/{f}.png", f"{OUT}/{c}/{f}.png"))
