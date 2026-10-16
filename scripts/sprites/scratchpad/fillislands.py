import sys
sys.path.insert(0, "C:/Users/CONSTATN/Desktop/notiontodoweget/scripts/sprites/scratchpad")
import numpy as np
from PIL import Image
from cutout import label
OUT = "C:/Users/CONSTATN/Desktop/notiontodoweget/ui/characters/hachi"
spots = {}
for f in ["eyes_open", "eyes_closed"]:
    a = np.array(Image.open(f"v3_backup/hachi/{f}.png").convert("RGBA"))
    lum = a[..., :3].astype(float) @ [0.299, 0.587, 0.114]; A = a[..., 3]
    lab, n = label((A > 0) & (lum > 110))
    sizes = np.bincount(lab.ravel())
    fill = np.zeros(A.shape, bool); spots[f] = []
    for v in range(1, n + 1):
        m = lab == v
        ys, xs = np.nonzero(m)
        if sizes[v] >= 60 or ys.min() <= 290: continue   # skip face (eyes, mouth) and anything big
        nb = np.zeros_like(m); nb[1:] |= m[:-1]; nb[:-1] |= m[1:]; nb[:, 1:] |= m[:, :-1]; nb[:, :-1] |= m[:, 1:]
        nb &= ~m
        if (A[nb] < 128).any(): continue                  # not enclosed by the outline
        fill |= m
        if sizes[v] >= 4: spots[f].append((int(xs.mean()), int(ys.mean()), int(sizes[v])))
    ring = fill.copy()
    for _ in range(2):                                    # include the island's gray antialias ring (inside the stroke)
        r2 = ring.copy(); r2[1:] |= ring[:-1]; r2[:-1] |= ring[1:]; r2[:, 1:] |= ring[:, :-1]; r2[:, :-1] |= ring[:, 1:]; ring = r2
    fill = fill | (ring & (A >= 128) & (lum < 200))
    a[fill, :3] = 0                                       # alpha untouched
    Image.fromarray(a, "RGBA").save(f"{OUT}/{f}.png")
    assert (np.array(Image.open(f"{OUT}/{f}.png"))[..., 3] == A).all()
    print(f, "filled px", int(fill.sum()), "islands>=4px", spots[f])
# 3x zoom of the spots, before | after
def comp(p):
    im = Image.open(p).convert("RGBA"); bg = Image.new("RGBA", im.size, (28, 40, 53, 255)); bg.alpha_composite(im); return bg.convert("RGB")
tiles = []
for f, sp in spots.items():
    b0, b1 = comp(f"v3_backup/hachi/{f}.png"), comp(f"{OUT}/{f}.png")
    for x, y, s in sp:
        box = (max(0, x - 40), max(0, y - 40), max(0, x - 40) + 80, max(0, y - 40) + 80)
        t = Image.new("RGB", (490, 240), (255, 0, 255))
        t.paste(b0.crop(box).resize((240, 240), Image.NEAREST), (0, 0)); t.paste(b1.crop(box).resize((240, 240), Image.NEAREST), (250, 0))
        tiles.append(t)
sh = Image.new("RGB", (2 * 500, ((len(tiles) + 1) // 2) * 250), (90, 90, 90))
for i, t in enumerate(tiles): sh.paste(t, ((i % 2) * 500, (i // 2) * 250))
sh.save("hachi-fix.png"); print(len(tiles))
