import sys
sys.path.insert(0, "C:/Users/CONSTATN/Desktop/notiontodoweget/scripts/sprites/scratchpad")
import numpy as np
from PIL import Image
from cutout import label
for f in ["eyes_open", "eyes_closed"]:
    a = np.array(Image.open(f"v3_backup/hachi/{f}.png").convert("RGBA")).astype(float)
    lum = a[..., :3] @ [0.299, 0.587, 0.114]; A = a[..., 3]
    light = (A > 0) & (lum > 110)
    lab, n = label(light)
    sizes = np.bincount(lab.ravel())
    print(f)
    for v in range(1, n + 1):
        if sizes[v] >= 400: continue
        ys, xs = np.nonzero(lab == v)
        # neighbors of the island
        m = lab == v
        nb = np.zeros_like(m); nb[1:] |= m[:-1]; nb[:-1] |= m[1:]; nb[:, 1:] |= m[:, :-1]; nb[:, :-1] |= m[:, 1:]
        nb &= ~m
        transp = int((A[nb] < 128).sum()); tot = int(nb.sum())
        print(f"  id{v} size={sizes[v]} x={xs.min()}-{xs.max()} y={ys.min()}-{ys.max()} border_transparent={transp}/{tot}")
