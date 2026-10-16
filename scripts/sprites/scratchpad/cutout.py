"""Cut out line-drawing sprites: ink threshold, dilated flood fill, geodesic split, antialiased edge."""
import sys, json
from collections import deque
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

BASE = "C:/Users/CONSTATN/Desktop/notiontodoweget/scripts/sprites"
OUT = "C:/Users/CONSTATN/Desktop/notiontodoweget/ui/characters"
JOBS = {  # n: (dest, cfg)
    25: ("chiikawa/eyes_open.png", {}),
    3: ("chiikawa/hop.png", {}),
    8: ("chiikawa/fly.png", {}),
    2: ("chiikawa/sleep.png", {}),
    24: ("jokebear/eyes_open.png", {}),
    23: ("jokebear/hop.png", {}),
    15: ("jokebear/dance.png", {}),
    16: ("jokebear/fly.png", {}),
    17: ("jokebear/sit.png", {}),
    6: ("chiikawa/scared.png", {}),
}
CFG = json.load(open(BASE + "/scratchpad/cfg.json"))
WRITE = "--write" in sys.argv


def load(n):
    im = Image.open(f"{BASE}/images/{n}.png").convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    return np.array(bg.convert("RGB"))


def label(mask):
    """4-connected component labels (0 = not in mask)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    m = mask.ravel(); L = lab.ravel()
    cur = 0
    for start in np.flatnonzero(m):
        if L[start]:
            continue
        cur += 1
        L[start] = cur
        q = deque([start])
        while q:
            p = q.popleft()
            y, x = divmod(p, w)
            for nb, ok in ((p - 1, x > 0), (p + 1, x < w - 1), (p - w, y > 0), (p + w, y < h - 1)):
                if ok and m[nb] and not L[nb]:
                    L[nb] = cur
                    q.append(nb)
    return lab, cur


def grow(lab, allowed):
    """Geodesic Voronoi: spread labels into allowed pixels, nearest source wins."""
    h, w = lab.shape
    L = lab.ravel().copy(); a = allowed.ravel()
    q = deque(np.flatnonzero(L))
    while q:
        p = q.popleft()
        y, x = divmod(p, w)
        for nb, ok in ((p - 1, x > 0), (p + 1, x < w - 1), (p - w, y > 0), (p + w, y < h - 1)):
            if ok and a[nb] and not L[nb]:
                L[nb] = L[p]
                q.append(nb)
    return L.reshape(h, w)


def grow2(seed, allowed):
    """Like grow, but only queues seed pixels on the frontier (fast at 4x)."""
    h, w = seed.shape
    free = allowed & (seed == 0)
    fr = np.zeros_like(free)
    fr[:, 1:] |= free[:, :-1]; fr[:, :-1] |= free[:, 1:]; fr[1:] |= free[:-1]; fr[:-1] |= free[1:]
    L = seed.ravel().copy(); a = allowed.ravel()
    q = deque(np.flatnonzero((seed > 0) & fr))
    while q:
        p = q.popleft()
        y, x = divmod(p, w)
        for nb, ok in ((p - 1, x > 0), (p + 1, x < w - 1), (p - w, y > 0), (p + w, y < h - 1)):
            if ok and a[nb] and not L[nb]:
                L[nb] = L[p]
                q.append(nb)
    return L.reshape(h, w)


def process(n, cfg):
    mf = lambda m, sz: np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(sz))) > 0
    rgb = load(n)
    h, w, _ = rgb.shape
    lum = rgb.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    dark = rgb.max(axis=2)
    T = cfg.get("T", 128)
    ink = dark < T
    if cfg.get("draw_lines"):  # visible closing strokes (also drawn into the 4x ink below)
        cfg = {**cfg, "lines": cfg.get("lines", []) + cfg["draw_lines"]}
    if cfg.get("lines"):  # bridge real outline gaps
        im = Image.fromarray((ink * 255).astype(np.uint8))
        d = ImageDraw.Draw(im)
        for x0, y0, x1, y1 in cfg["lines"]:
            d.line((x0, y0, x1, y1), fill=255, width=cfg.get("lw", 3))
        ink = np.array(im) > 0
    for x0, y0, x1, y1 in cfg.get("erase", []):  # stray marks far from character
        ink[y0:y1, x0:x1] = False
    pre_drop = np.zeros_like(ink)
    if cfg.get("drop_specks") and not cfg.get("_pre"):  # find the floating marks first, then classify without them
        pre_drop = process(n, {**cfg, "_pre": True})
        ink = ink & ~pre_drop
    k = cfg.get("k", 3)
    dil = np.array(Image.fromarray((ink * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * k + 1))) > 0
    light = ~ink
    core = light & ~dil
    clab, nc = label(core)
    edges = [clab[0], clab[:, 0], clab[:, -1]] + ([] if cfg.get("no_bottom_seed") else [clab[-1]])
    border = set(np.unique(np.concatenate(edges))) - {0}
    bgset = set(border)
    for x, y in cfg.get("bg", []):  # enclosed pockets that are background
        v = clab[y, x]
        assert v, f"{n}: bg seed {x},{y} not in a core region"
        bgset.add(int(v))
    full = grow(clab, light)
    isbg = np.isin(full, list(bgset))
    # unreached tiny light pockets (no core): background only if listed
    unreached = light & (full == 0)
    if cfg.get("pockets_bg"):
        isbg |= unreached
    for x0, y0, x1, y1 in cfg.get("erase", []):
        isbg[y0:y1, x0:x1] = True
    if cfg.get("near_bg"):  # small light pockets cut off only by thin hatch strokes -> background
        r, amax = cfg["near_bg"], cfg.get("pocket_max", 400)
        plab, npk = label(light & ~isbg)
        bgd = np.array(Image.fromarray((isbg * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0
        sizes = np.bincount(plab.ravel())
        hit = np.unique(plab[bgd & (plab > 0)])
        flip = [v for v in hit if sizes[v] < amax]
        isbg |= np.isin(plab, flip)
        nflip = len(flip)
    else:
        nflip = 0
    drop = np.zeros_like(ink)
    if cfg.get("drop_specks"):  # small ink marks floating in the background (tremble dashes) -> background
        ilab, ni = label(ink)
        isz = np.bincount(ilab.ravel())
        for v in range(1, ni + 1):
            if isz[v] >= cfg["drop_specks"]:
                continue
            m = ilab == v
            ring = mf(m, 5) & ~m
            if isbg[ring].mean() > 0.8:
                drop |= m
        if cfg.get("_pre"):
            return drop
        drop |= pre_drop
        ink = ink & ~drop
        isbg = isbg | drop
    body = ~isbg  # ink + interior light
    # ---- render at S x: crisp ink rebuilt from smoothed grayscale, classification carried from 1x
    mf = lambda m, sz: np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(sz))) > 0
    S = cfg.get("scale", 4)
    H, W = h * S, w * S
    val = Image.fromarray(dark.astype(np.uint8)).resize((W, H), Image.LANCZOS)
    val = val.filter(ImageFilter.GaussianBlur(cfg.get("blur", 0.8 * S)))
    lo, hi = cfg.get("win", (90, 170))
    c = np.clip((hi - np.array(val).astype(np.float32)) / (hi - lo), 0, 1)
    for x0, y0, x1, y1 in cfg.get("erase", []):
        c[y0 * S:y1 * S, x0 * S:x1 * S] = 0
    if drop.any():
        c[np.array(Image.fromarray((mf(drop, 5) * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 0] = 0
    if cfg.get("draw_lines"):
        ci = Image.fromarray((c * 255).astype(np.uint8)); dd = ImageDraw.Draw(ci)
        for x0, y0, x1, y1 in cfg["draw_lines"]:
            p0, p1 = (x0 * S + S // 2, y0 * S + S // 2), (x1 * S + S // 2, y1 * S + S // 2)
            r = cfg.get("dlw", 5) * S / 2
            dd.line((p0, p1), fill=255, width=int(2 * r))
            for q in (p0, p1):
                dd.ellipse((q[0] - r, q[1] - r, q[0] + r, q[1] + r), fill=255)
        c = np.maximum(c, np.array(ci.filter(ImageFilter.GaussianBlur(S * 0.4))).astype(np.float32) / 255)
    ink4 = c >= 0.5
    near1 = mf(ink, 5)
    fill = np.array(Image.fromarray(rgb).filter(ImageFilter.MaxFilter(7)))
    base1 = np.where(near1[..., None], fill, rgb).astype(np.uint8)
    snap = cfg.get("snap", 225)  # near-white neutral (JPEG noise) -> pure white
    mx, mn = base1.max(axis=2), base1.min(axis=2)
    base1[(mn > snap) & (mx.astype(int) - mn < 25)] = 255
    base = np.array(Image.fromarray(base1).resize((W, H), Image.BICUBIC)).astype(np.float32)
    seed1 = np.where(light & ~near1, np.where(isbg, 1, 2), 0).astype(np.uint8)
    seed = np.array(Image.fromarray(seed1).resize((W, H), Image.NEAREST))
    light4 = ~ink4
    seed[~light4] = 0
    lab4 = grow2(seed, light4)
    isbg4 = lab4 == 1
    unreached4 = light4 & (lab4 == 0)
    if cfg.get("pockets_bg"):
        isbg4 |= unreached4
    # smooth the bg/body cut through light areas (normalized blur over light pixels only, so no white leaks past ink)
    rad = cfg.get("cut_blur", 0.7 * S)
    blur = lambda m: np.array(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)
    b = blur(isbg4 & light4) / np.maximum(blur(light4), 1.0)
    b = np.clip((b - 0.5) * 2 + 0.5, 0, 1)  # bg-ness of nearby light pixels, also for ink edge pixels
    alpha = (1 - b) + b * c
    col = base * (1 - c[..., None]) * ((1 - b) / np.maximum(alpha, 1e-3))[..., None]
    rgba = np.dstack([col.round().clip(0, 255).astype(np.uint8), (alpha * 255).round().astype(np.uint8)])
    img = Image.fromarray(rgba, "RGBA")
    bbox = Image.fromarray((alpha > 0.06).astype(np.uint8) * 255).getbbox()
    img = img.crop(bbox)
    cw, ch = img.size
    s = max(cw, ch)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(img, ((s - cw) // 2, s - ch))
    sq = sq.resize((512, 512), Image.LANCZOS)
    frac = float((np.array(sq)[..., 3] > 127).mean())
    info = dict(n=n, k=k, cores=nc, bg_cores=len(bgset), unreached=int(unreached.sum()), unreached4=int(unreached4.sum()), flipped=nflip, opaque=round(frac, 3))
    # debug: enclosed core regions not marked bg, with their seed points
    enc = []
    for v in range(1, nc + 1):
        if v in bgset:
            continue
        ys, xs = np.nonzero(clab == v)
        if len(ys) < 15:
            continue
        i = len(ys) // 2
        enc.append((int(xs[i]), int(ys[i]), len(ys)))
    info["enclosed"] = enc
    return sq, info, rgb, body, clab, bgset


def preview(sq, path):
    bg = Image.new("RGBA", sq.size, (28, 40, 53, 255))
    bg.alpha_composite(sq)
    bg.convert("RGB").resize((150, 150), Image.LANCZOS).save(path)


if __name__ == "__main__":
    only = [int(a) for a in sys.argv[1:] if a.isdigit()] or list(JOBS)
    for n in only:
        dest, _ = JOBS[n]
        cfg = CFG.get(str(n), {})
        sq, info, rgb, body, clab, bgset = process(n, cfg)
        if WRITE:
            sq.save(f"{OUT}/{dest}")
        preview(sq, f"{BASE}/scratchpad/prev_{n}.png")
        # debug overlay: body red-tinted, enclosed (non-bg) cores numbered
        dbg = Image.fromarray(rgb).convert("RGB")
        ov = np.array(dbg)
        ov[~body] = (ov[~body] * 0.3 + np.array([0, 160, 255]) * 0.7).astype(np.uint8)
        dbg = Image.fromarray(ov)
        d = ImageDraw.Draw(dbg)
        for x, y, a in info["enclosed"]:
            d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 0, 0))
            d.text((x + 4, y - 4), f"{x},{y}", fill=(255, 0, 0))
        dbg.save(f"{BASE}/scratchpad/dbg_{n}.png")
        print(json.dumps(info))
