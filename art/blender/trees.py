"""Stylised tree library → public/assets/trees.glb

Top-level objects named Tree_<kind>_<n> (kinds: round, pine, tall, blossom), pivot at the base,
about 2.2 m of trunk at scale 1. Material roles: Bark, Leaves (the game tints Leaves per kind and district).
"""
import bpy, math, os, sys, random
sys.path.append(os.path.dirname(__file__))
from common import *

reset()
BARK, LEAVES = mat('Bark', '#8d5e3a'), mat('Leaves', '#4caf50')
out = []
def trunk(seed, h, lean, branches):
    random.seed(seed); parts = []
    lx, ly = math.cos(seed) * lean, math.sin(seed) * lean
    parts.append(curve_tube('trunk', [(0, 0, 0), (lx * 0.3, ly * 0.3, h * 0.45), (lx, ly, h)], 0.3, 0.13, BARK))
    parts.append(cyl('flare', (0, 0, 0.15), 0.42, 0.3, BARK, 12, r2=0.28))
    tips = []
    for b in range(branches):
        a = b / branches * math.tau + random.uniform(-0.3, 0.3); z = h * random.uniform(0.6, 0.85); L = random.uniform(0.7, 1.1)
        tip = (lx * z / h + math.cos(a) * L, ly * z / h + math.sin(a) * L, z + L * 0.6)
        parts.append(curve_tube(f'br{b}', [(lx * z / h, ly * z / h, z), tip], 0.1, 0.04, BARK)); tips.append(tip)
    return parts, (lx, ly, h), tips
def blobs(center, tips, n, size, seed, squash=0.82):
    random.seed(seed * 3 + 1); parts = []
    pts = [center] + tips + [(center[0] + random.uniform(-0.8, 0.8), center[1] + random.uniform(-0.8, 0.8), center[2] + random.uniform(0.2, 0.9)) for _ in range(max(0, n - 1 - len(tips)))]
    for i, p in enumerate(pts[:n]):
        s = size * (1.35 if i == 0 else random.uniform(0.75, 1.05))
        o = ico(f'leaf{i}', (p[0], p[1], p[2] + (0.5 if i == 0 else 0.2)), (s, s, s * squash), LEAVES, 2); displace(o, 0.18 * s, 0.45); parts.append(o)
    return parts
def tree(name, parts):
    o = join(parts, name); out.append(o); return o
for n, seed in enumerate((1, 2, 3)):
    p, top, tips = trunk(seed, 2.2, 0.25, 3); tree(f'Tree_round_{n}', p + blobs(top, tips, 6, 0.95, seed))
for n, seed in enumerate((4, 5)):
    p, top, tips = trunk(seed, 2.0, 0.35, 4); tree(f'Tree_blossom_{n}', p + blobs(top, tips, 7, 0.85, seed, 0.75))
for n, seed in enumerate((6, 7)):
    random.seed(seed); parts = [curve_tube('trunk', [(0, 0, 0), (0, 0, 1.6), (0, 0, 4.6)], 0.26, 0.05, BARK), cyl('flare', (0, 0, 0.15), 0.38, 0.3, BARK, 12, r2=0.24)]
    for i in range(5):
        c = cyl(f'tier{i}', (0, 0, 1.4 + i * 0.68), 1.45 - i * 0.24, 1.25, LEAVES, 14, r2=0.05); subsurf(c, 1); displace(c, 0.08, 0.3); parts.append(c)
    tree(f'Tree_pine_{n}', parts)
for n, seed in enumerate((8, 9)):
    p, top, tips = trunk(seed, 2.4, 0.1, 0)
    a = ico('spire', (top[0], top[1], top[2] + 1.5), (0.95, 0.95, 2.2), LEAVES, 2); displace(a, 0.15, 0.4)
    b = ico('side', (top[0] + 0.35, top[1] + 0.2, top[2] + 0.6), (0.7, 0.7, 1.3), LEAVES, 2); displace(b, 0.12, 0.4)
    tree(f'Tree_tall_{n}', p + [a, b])
for i, o in enumerate(out): o.location.x = i * 6  # spread out for previewing; the game resets placement
export(out_path('trees.glb'), out)
