"""Close open outline gaps at limb junctions: cut white that spills past the gap and bridge it with a black stroke.

Works at 4x on a 512 RGBA sprite. closed = morphological closing of the ink, so each gap gets bridged
roughly along the line between the stroke ends. White outside the closed silhouette is cut; white in a
band (about one stroke width) just inside the new boundary, where no ink exists, is painted black.
Only 512 pixels touched by the change are replaced, the rest stays byte-identical.
"""
import sys
from collections import deque
import numpy as np
from PIL import Image

SP = "C:/Users/CONSTATN/Desktop/notiontodoweget/scripts/sprites/scratchpad"
OUT = "C:/Users/CONSTATN/Desktop/notiontodoweget/ui/characters"
K = 4


def step(m, diag):
    o = m.copy()
    o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]
    if diag:
        o[1:, 1:] |= m[:-1, :-1]; o[:-1, :-1] |= m[1:, 1:]; o[1:, :-1] |= m[:-1, 1:]; o[:-1, 1:] |= m[1:, :-1]
    return o


def dil(m, n):  # octagon (near-disk) dilation of radius n
    for i in range(n):
        m = step(m, i % 2 == 1)
    return m


def ero(m, n):
    return ~dil(~m, n)


def outside_of(barrier):
    """Pixels reachable from the border without crossing barrier (4-connected)."""
    h, w = barrier.shape
    free = ~barrier.ravel()
    seen = np.zeros(h * w, bool)
    q = deque()
    for p in np.concatenate([np.arange(w), np.arange((h - 1) * w, h * w), np.arange(0, h * w, w), np.arange(w - 1, h * w, w)]):
        if free[p] and not seen[p]:
            seen[p] = True; q.append(p)
    while q:
        p = q.popleft()
        y, x = divmod(p, w)
        for nb, ok in ((p - 1, x > 0), (p + 1, x < w - 1), (p - w, y > 0), (p + w, y < h - 1)):
            if ok and free[nb] and not seen[nb]:
                seen[nb] = True; q.append(nb)
    return seen.reshape(h, w)


def fix(src, dst, r, band=None):
    O = Image.open(src).convert("RGBA")
    o = np.array(O)
    big = np.array(O.resize((512 * K, 512 * K), Image.BICUBIC)).astype(np.float32)
    rgb, A = big[..., :3], big[..., 3]
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    ink = (A > 128) & (lum < 100)
    solid = A > 128
    # stroke width estimate: 2 * area / boundary length
    edge = ink & ~ero(ink, 1)
    w = 2 * ink.sum() / max(edge.sum(), 1)
    band = int(round((band or 0.9) * w))
    closed = ero(dil(ink, r * K), r * K)
    out = outside_of(closed)
    spill = solid & ~ink & out                        # white past the bridged line -> cut
    exposed = solid & ~ink & dil(~solid, 3)      # white touching transparency with no stroke between
    bridge = ~out & ~ink & dil(out, band) & dil(exposed | spill, band + 4)  # new stroke (about one outline wide) along the bridged chord
    fringe = out & ~solid & (A > 0) & (lum > 60)       # light half-transparent specks outside the line -> black, alpha kept
    # round the bridge joins: smooth (ink | bridge) and keep the bridge's outer chord edge
    from PIL import ImageFilter
    u = Image.fromarray(((ink | bridge) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(float(w) / 5))
    rounded = (np.array(u) > 127) & ~ink & dil(bridge, 6)
    bridge = rounded | (bridge & dil(out, 2))
    if spill.sum() > 0.03 * solid.sum():
        raise SystemExit(f"{src}: cut {spill.sum()} px is too large (body leaked), raise r")
    seam = ink & dil(bridge, 3) & ~out                 # old stroke edges inside the new join -> same black
    A2 = np.where(bridge | seam, 255.0, np.where(spill, 0.0, A))
    rgb2 = np.where((bridge | fringe | seam)[..., None], 0.0, rgb)
    new = Image.fromarray(np.dstack([rgb2, A2]).round().clip(0, 255).astype(np.uint8), "RGBA").resize((512, 512), Image.BOX)
    n = np.array(new)
    touched = (spill | bridge | fringe).reshape(512, K, 512, K).any(axis=(1, 3))
    touched = dil(touched, 1)
    res = np.where(touched[..., None], n, o)
    Image.fromarray(res, "RGBA").save(dst)
    return dict(stroke_w4=round(float(w), 1), cut4=int(spill.sum()), bridge4=int(bridge.sum()), px512=int(touched.sum()))


if __name__ == "__main__":
    # name -> closing radius at 512 px
    R = {"jokebear/eyes_open": 12, "jokebear/hop": 26, "jokebear/dance": 12, "jokebear/fly": 12,
         "hachi/eyes_open": 12, "hachi/eyes_closed": 12, "chiikawa/hop": 26}
    for a in sys.argv[1:]:
        if "=" in a:
            k, v = a.split("=")
            R[k] = int(v)
    only = [k for k in R if any(a.startswith(k) for a in sys.argv[1:])] or list(R)
    for name in only:
        r = R[name]
        print(name, r, fix(f"{SP}/v2_backup/{name}.png", f"{OUT}/{name}.png", r))
