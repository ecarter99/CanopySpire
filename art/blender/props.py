"""Architectural props → public/assets/props.glb

Top-level objects: LampPost, Bench, PortalArch, ChimePillar, SongbirdRock, SongbirdBird.
Pivots at the base, dimensions match the game's colliders. Material roles:
Stone, Trim, Metal, Glow, Wood, Brass, Leaves, Rock, Bird, Beak, Eye.
"""
import bpy, math, os, sys
sys.path.append(os.path.dirname(__file__))
from common import *

reset()
M = {k: mat(k, c) for k, c in {'Stone': '#f3ead6', 'Trim': '#3cc9b5', 'Metal': '#4f6360', 'Glow': '#fff1c1', 'Wood': '#b07d4a', 'Brass': '#d9a441',
                               'Leaves': '#4caf50', 'Rock': '#9aa7b0', 'Bird': '#7ec8e3', 'Beak': '#ffb74d', 'Eye': '#222222'}.items()}
objs = []
def prop(name, parts, x):
    # join() keeps the first part's origin; parts are modelled around (0,0,0) = base centre, so move the
    # pivot back there (otherwise e.g. the portal arch pivots on its left plinth and sits 2.5 m off-centre)
    o = join(parts, name)
    o.data.transform(o.matrix_basis); o.matrix_basis = Matrix.Identity(4); o.location.x = x; objs.append(o); return o
# lamp post: fluted pole, scrollwork arm, lantern cage with glowing bulb
lamp = [cyl('base', (0, 0, 0.15), 0.26, 0.3, M['Metal'], 12, r2=0.2), cyl('pole', (0, 0, 1.7), 0.075, 3.0, M['Metal'], 12, r2=0.06),
        torus('collar', (0, 0, 0.6), 0.1, 0.03, M['Brass'], major=16, minor=6), torus('collar2', (0, 0, 3.15), 0.09, 0.03, M['Brass'], major=16, minor=6),
        sphere('bulb', (0, 0, 3.4), (0.2, 0.2, 0.26), M['Glow'], 16, 12), cyl('cap', (0, 0, 3.72), 0.34, 0.22, M['Metal'], 8, r2=0.05),
        cyl('finial', (0, 0, 3.9), 0.04, 0.2, M['Brass'], 8)]
for i in range(4):
    a = i * math.pi / 2; lamp.append(cyl(f'cage{i}', (math.cos(a) * 0.2, math.sin(a) * 0.2, 3.4), 0.015, 0.5, M['Metal'], 6))
lamp.append(curve_tube('scroll', [(0, 0, 2.6), (0.25, 0, 2.85), (0.12, 0, 3.05), (0, 0, 3.1)], 0.025, 0.02, M['Brass']))
prop('LampPost', lamp, 0)
# bench: slatted wood seat & back on curled iron legs (2.2 m long along X)
bench = [rbox(f'seat{i}', (0, -0.18 + i * 0.12, 0.47), (2.2, 0.1, 0.05), M['Wood'], 0.015) for i in range(4)]
bench += [rbox(f'back{i}', (0, 0.28, 0.6 + i * 0.13), (2.2, 0.04, 0.09), M['Wood'], 0.015, rot=(-0.15, 0, 0)) for i in range(3)]
for s in (-1, 1):
    bench.append(curve_tube(f'leg{s}', [(s * 0.95, -0.25, 0), (s * 0.95, -0.2, 0.45), (s * 0.95, 0.25, 0.47), (s * 0.95, 0.32, 0.95)], 0.04, 0.035, M['Metal']))
    bench.append(curve_tube(f'legb{s}', [(s * 0.95, 0.25, 0), (s * 0.95, 0.15, 0.45)], 0.04, 0.035, M['Metal']))
    bench.append(curve_tube(f'arm{s}', [(s * 1.05, -0.25, 0.62), (s * 1.05, 0.0, 0.7), (s * 1.05, 0.25, 0.66)], 0.035, 0.03, M['Metal']))
prop('Bench', bench, 4)
# portal arch: carved pillars with capitals, keystone arch, vines (pillars at x = ±2.5, 0.9 wide, 5.2 tall)
arch = []
for s in (-1, 1):
    arch += [rbox(f'plinth{s}', (s * 2.5, 0, 0.25), (1.2, 1.2, 0.5), M['Stone'], 0.06), rbox(f'pillar{s}', (s * 2.5, 0, 2.75), (0.9, 0.9, 4.6), M['Stone'], 0.1),
             rbox(f'capital{s}', (s * 2.5, 0, 5.1), (1.15, 1.15, 0.3), M['Trim'], 0.05)]
    for k in range(3): arch.append(rbox(f'flute{s}{k}', (s * 2.5 + (k - 1) * 0.25, -0.46, 2.75), (0.08, 0.04, 4.0), M['Trim'], 0.015))
    arch.append(curve_tube(f'vine{s}', [(s * 2.95, -0.47, 0.4), (s * 3.0, -0.5, 2.0), (s * 2.9, -0.48, 3.6), (s * 2.6, -0.5, 5.4), (s * 1.6, -0.48, 7.2)], 0.06, 0.03, M['Leaves']))
    for k in range(6): arch.append(sphere(f'vl{s}{k}', (s * (2.95 - k * 0.2), -0.55, 0.9 + k * 1.1), (0.18, 0.08, 0.12), M['Leaves'], 8, 6))
a = torus('archRing', (0, 0, 5.2), 2.5, 0.45, M['Stone'], rot=(math.pi / 2, 0, 0), major=40, minor=12)
import bmesh
bm = bmesh.new(); bm.from_mesh(a.data); bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.01], context='VERTS'); bm.to_mesh(a.data); bm.free()
arch += [a, rbox('keystone', (0, 0, 7.85), (0.6, 1.0, 0.7), M['Trim'], 0.06)]
prop('PortalArch', arch, 10)
# chime pillar: banded column with a brass bell-cap (crystal is added by the game)
chime = [rbox('cbase', (0, 0, 0.2), (1.1, 1.1, 0.4), M['Stone'], 0.05), cyl('ccol', (0, 0, 1.9), 0.42, 3.0, M['Stone'], 16, r2=0.36)]
chime += [torus(f'band{k}', (0, 0, 0.9 + k * 0.9), 0.43 - k * 0.02, 0.05, M['Trim'], major=20, minor=6) for k in range(3)]
chime += [cyl('ccap', (0, 0, 3.55), 0.66, 0.3, M['Brass'], 16, r2=0.5), cyl('hook', (0, 0, 3.85), 0.05, 0.3, M['Brass'], 8)]
prop('ChimePillar', chime, 14)
# songbird statue: weathered boulder with a perched stone bird
rock = ico('rock', (0, 0, 0.75), (1.5, 1.4, 0.95), M['Rock'], 2); displace(rock, 0.25, 0.6); prop('SongbirdRock', [rock], 18)
song = [sphere('body', (0, 0, 1.95), (0.42, 0.52, 0.36), M['Bird'], 20, 14), sphere('bhead', (0, -0.42, 2.3), (0.27, 0.27, 0.27), M['Bird'], 16, 12),
         cyl('beak', (0, -0.72, 2.28), 0.08, 0.26, M['Beak'], 8, rot=(math.pi / 2, 0, 0), r2=0.0), sphere('tail', (0, 0.55, 2.05), (0.12, 0.35, 0.06), M['Bird'], 12, 8, rot=(0.4, 0, 0))]
for s in (-1, 1):
    song += [sphere(f'wing{s}', (s * 0.42, 0.05, 2.0), (0.12, 0.42, 0.25), M['Bird'], 12, 8, rot=(0.2, 0, s * 0.2)), sphere(f'beye{s}', (s * 0.13, -0.62, 2.38), (0.04,) * 3, M['Eye'], 8, 6)]
prop('SongbirdBird', song, 22)
export(out_path('props.glb'), objs)
