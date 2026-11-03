"""Rigged, animated player/NPC character → public/assets/character.glb

A stylised adventurer (~6.5 heads, 1.86 m): layered open jacket over a tunic, rolled sleeves,
cross-body strap, belt with pouches & carabiner, canvas pack with bedroll and bottle, wrist
compass, cargo trousers and boots. Limbs are continuous tubes with distance-blended skin weights,
so elbows/knees/hips bend smoothly. 22-bone rig incl. `hair`, `hood` and `pack` bones that the
game drives with springs (secondary motion). Ten hat variants + a paraglider are parented to bones.
Colours are placeholders: the game recolours material roles (Outfit, Accent, Skin, Hair, Pants,
Boots, Brown) from each player's look.
"""
import bpy, math, os, sys
sys.path.append(os.path.dirname(__file__))
from common import *
from common import _active

reset()
M = {k: mat(k, c) for k, c in {
    'Outfit': '#2f7f78', 'Accent': '#efe6d2', 'Skin': '#f0c49c', 'Hair': '#c9963f', 'Pants': '#6b6447', 'Boots': '#5a3d26',
    'Brown': '#6e4a2c', 'Canvas': '#7a7448', 'CanvasDark': '#5e5a37', 'Metal': '#8a959c', 'Brass': '#d9a441', 'Sole': '#2b2622',
    'Eye': '#1f2328', 'Iris': '#2e7f9e', 'White': '#ffffff', 'Blush': '#f19a8e', 'Brow': '#5a3a22', 'Glow': '#7ff5ff',
    'Straw': '#e8c872', 'Leaf': '#4caf50', 'Leaf2': '#8bd34a', 'Flower': '#ff8fb1', 'Gold': '#ffcf40', 'Gem': '#9be7ff',
    'Lens': '#7fe0e8', 'Dark': '#2b2f3a', 'GliderCanopy': '#ff7043', 'GliderStripe': '#ffffff'}.items()}

# ---------------- skeleton (facing -Y, Z up) ----------------
BONES = [  # name, head, tail, parent
    ('hips', (0, 0, 0.95), (0, 0, 1.08), None), ('spine', (0, 0, 1.08), (0, 0, 1.28), 'hips'), ('chest', (0, 0, 1.28), (0, 0, 1.47), 'spine'),
    ('neck', (0, 0, 1.49), (0, 0, 1.6), 'chest'), ('head', (0, 0, 1.6), (0, 0, 1.88), 'neck'),
    ('hair', (0, 0.07, 1.76), (0, 0.11, 1.58), 'head'), ('hood', (0, 0.1, 1.5), (0, 0.14, 1.37), 'chest'), ('pack', (0, 0.2, 1.45), (0, 0.21, 1.12), 'chest'),
    ('upperarm_R', (-0.2, 0, 1.46), (-0.245, 0, 1.18), 'chest'), ('forearm_R', (-0.245, 0, 1.18), (-0.27, 0, 0.93), 'upperarm_R'), ('hand_R', (-0.27, 0, 0.93), (-0.275, 0, 0.84), 'forearm_R'),
    ('upperarm_L', (0.2, 0, 1.46), (0.245, 0, 1.18), 'chest'), ('forearm_L', (0.245, 0, 1.18), (0.27, 0, 0.93), 'upperarm_L'), ('hand_L', (0.27, 0, 0.93), (0.275, 0, 0.84), 'forearm_L'),
    ('thigh_R', (-0.095, 0, 0.93), (-0.1, 0, 0.52), 'hips'), ('shin_R', (-0.1, 0, 0.52), (-0.1, 0, 0.1), 'thigh_R'), ('foot_R', (-0.1, 0, 0.1), (-0.1, -0.15, 0.03), 'shin_R'),
    ('thigh_L', (0.095, 0, 0.93), (0.1, 0, 0.52), 'hips'), ('shin_L', (0.1, 0, 0.52), (0.1, 0, 0.1), 'thigh_L'), ('foot_L', (0.1, 0, 0.1), (0.1, -0.15, 0.03), 'shin_L'),
]
BH = {n: Vector(h) for n, h, t, p in BONES}; BT = {n: Vector(t) for n, h, t, p in BONES}
ad = bpy.data.armatures.new('Rig'); arm = bpy.data.objects.new('Character', ad); bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, par in BONES:
    b = ad.edit_bones.new(name); b.head = h; b.tail = t; b.roll = 0
    if par: b.parent = ad.edit_bones[par]; b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------- skin weights: blend between the nearest allowed bones by distance ----------------
def _seg_dist(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared)); return (a + ab * t - p).length
def weight_env(o, bones, sharp=5.0):
    bpy.context.view_layer.update(); mw = o.matrix_world.copy()
    groups = {n: (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)) for n in bones}
    for v in o.data.vertices:
        p = mw @ v.co
        ws = [(n, 1.0 / (_seg_dist(p, BH[n], BT[n]) + 1e-3) ** sharp) for n in bones]; tot = sum(w for _, w in ws)
        for n, w in ws:
            w /= tot
            if w > 0.01: groups[n].add([v.index], w, 'REPLACE')
    return o

parts = []
def P(o, bones): parts.append((o, bones if isinstance(bones, (list, tuple)) else [bones])); return o
TORSO = ['hips', 'spine', 'chest']

# ---------------- head & face ----------------
HC = Vector((0, 0, 1.71))
P(sphere('skull', HC, (0.118, 0.128, 0.142), M['Skin'], 32, 20), 'head')
P(sphere('jaw', (0, -0.035, 1.625), (0.088, 0.085, 0.07), M['Skin'], 24, 14), 'head')
P(sphere('nose', (0, -0.128, 1.69), (0.016, 0.02, 0.022), M['Skin'], 10, 8, rot=(0.3, 0, 0)), 'head')
P(rbox('mouth', (0, -0.112, 1.633), (0.034, 0.006, 0.006), M['Brow'], bevel=0.002), 'head')
for s in (-1, 1):
    x = s * 0.046
    P(sphere(f'sclera{s}', (x, -0.106, 1.712), (0.03, 0.012, 0.029), M['White'], 16, 10), 'head')
    P(sphere(f'iris{s}', (x - s * 0.003, -0.115, 1.709), (0.019, 0.008, 0.024), M['Iris'], 14, 10), 'head')
    P(sphere(f'pupil{s}', (x - s * 0.003, -0.12, 1.708), (0.009, 0.005, 0.012), M['Eye'], 10, 8), 'head')
    P(sphere(f'glint{s}', (x - s * 0.01, -0.123, 1.721), (0.006, 0.003, 0.006), M['White'], 8, 6), 'head')
    P(rbox(f'brow{s}', (x, -0.112, 1.748), (0.045, 0.01, 0.009), M['Brow'], bevel=0.003, rot=(0, s * 0.12, 0)), 'head')
    P(sphere(f'blush{s}', (s * 0.072, -0.096, 1.662), (0.018, 0.005, 0.009), M['Blush'], 10, 6), 'head')
    P(sphere(f'ear{s}', (s * 0.118, 0.008, 1.7), (0.018, 0.03, 0.04), M['Skin'], 12, 8), 'head')
P(cyl('neckC', (0, 0.005, 1.55), 0.05, 0.14, M['Skin'], 16), ['neck', 'head', 'chest'])

# hair: a cap plus tousled, swept clumps (back clumps ride the `hair` spring bone)
import bmesh as _bm
cap = sphere('hairCap', (0, 0.01, 1.725), (0.127, 0.137, 0.15), M['Hair'], 32, 20)
bm = _bm.new(); bm.from_mesh(cap.data)
_bm.ops.delete(bm, geom=[v for v in bm.verts if (v.co.y < -0.06 and v.co.z < 1.79) or v.co.z < 1.64], context='VERTS'); bm.to_mesh(cap.data); bm.free()
P(cap, 'head')
def clump(name, base, tip, r):
    b, t = Vector(base), Vector(tip); mid = b + (t - b) * 0.45 + Vector((0, 0, 0.015))
    o = curve_tube(name, [tuple(b), tuple(mid), tuple(t)], r, 0.006, M['Hair'], res=3)
    o.scale = (1.0, 1.0, 1.0); return o
for i in range(5):  # fringe: a few thick locks swept across the forehead
    a = -0.5 + i * 0.25
    P(clump(f'fringe{i}', (math.sin(a) * 0.08, -0.08, 1.845), (math.sin(a) * 0.11 + 0.03, -0.138, 1.76 - abs(a) * 0.03), 0.045), 'head')
for i in range(7):  # crown & sides: chunky, flicking outwards
    a = (i / 6) * math.pi * 1.3 - math.pi * 0.15
    bx, by = math.cos(a) * 0.085, math.sin(a) * 0.085 + 0.02
    P(clump(f'side{i}', (bx, by, 1.845), (bx * 1.75, by * 1.6 + 0.02, 1.7 + (i % 2) * 0.025), 0.052), 'head')
P(sphere('hairBack', (0, 0.045, 1.71), (0.132, 0.112, 0.135), M['Hair'], 28, 16), ['head', 'hair'])  # rounded mass at the back
for i in range(5):  # short flicks at the nape, swaying on the `hair` bone
    x = -0.08 + i * 0.04
    P(clump(f'back{i}', (x, 0.1, 1.68), (x * 1.35, 0.135, 1.6 - (i % 2) * 0.02), 0.04), ['head', 'hair'])
for s in (-1, 1):  # side locks framing the face
    P(clump(f'lock{s}', (s * 0.1, -0.03, 1.81), (s * 0.128, -0.05, 1.69), 0.034), 'head')

# ---------------- torso: tunic, open jacket, hood, straps ----------------
P(subsurf(rbox('tunicChest', (0, 0.0, 1.35), (0.31, 0.2, 0.26), M['Accent'], bevel=0.06), 1), TORSO)
P(subsurf(rbox('tunicBelly', (0, 0.0, 1.13), (0.27, 0.18, 0.26), M['Accent'], bevel=0.06), 1), TORSO)
P(subsurf(rbox('tunicHem', (0, 0.0, 0.97), (0.3, 0.2, 0.12), M['Accent'], bevel=0.04), 1), ['hips', 'thigh_R', 'thigh_L'])
for s in (-1, 1):  # jacket front panels (open, showing the tunic)
    P(subsurf(rbox(f'jacketFront{s}', (s * 0.105, -0.012, 1.24), (0.125, 0.215, 0.5), M['Outfit'], bevel=0.04), 1), TORSO)
    P(subsurf(rbox(f'jacketTail{s}', (s * 0.105, -0.01, 0.92), (0.13, 0.2, 0.16), M['Outfit'], bevel=0.03), 1), ['hips', 'thigh_R' if s < 0 else 'thigh_L'])
    P(subsurf(rbox(f'lapel{s}', (s * 0.06, -0.112, 1.4), (0.05, 0.02, 0.16), M['Outfit'], bevel=0.01, rot=(0, s * 0.25, 0)), 1), 'chest')
    P(sphere(f'shoulder{s}', (s * 0.185, 0.0, 1.44), (0.075, 0.08, 0.065), M['Outfit'], 18, 12), ['chest', f'upperarm_{"R" if s < 0 else "L"}'])
P(subsurf(rbox('jacketBack', (0, 0.07, 1.2), (0.33, 0.07, 0.58), M['Outfit'], bevel=0.03), 1), TORSO)
P(torus('collar', (0, 0.0, 1.5), 0.085, 0.03, M['Outfit'], rot=(0.15, 0, 0), major=24, minor=8), ['chest', 'neck'])
P(subsurf(sphere('hoodBunch', (0, 0.115, 1.48), (0.13, 0.065, 0.075), M['Outfit'], 20, 12), 0), ['chest', 'hood'])
# emblem patch on the left sleeve-shoulder (Accent) — the game's own crest is on banners, kept abstract here
P(sphere('patch', (0.215, -0.03, 1.39), (0.012, 0.035, 0.035), M['Accent'], 10, 8), ['chest', 'upperarm_L'])
# cross-body satchel strap + pack shoulder straps
P(rbox('crossStrap', (0.0, -0.118, 1.2), (0.035, 0.012, 0.6), M['Brown'], bevel=0.004, rot=(0, -0.62, 0)), TORSO)
P(rbox('strapBuckle', (-0.03, -0.126, 1.22), (0.04, 0.008, 0.03), M['Metal'], bevel=0.004, rot=(0, -0.62, 0)), TORSO)
for s in (-1, 1):
    P(rbox(f'packStrap{s}', (s * 0.085, -0.108, 1.33), (0.032, 0.012, 0.3), M['Brown'], bevel=0.004, rot=(0.08, 0, 0)), 'chest')
    P(rbox(f'packStrapTop{s}', (s * 0.085, 0.0, 1.47), (0.034, 0.22, 0.014), M['Brown'], bevel=0.004), 'chest')
# belt, buckle, pouches, carabiner
P(torus('belt', (0, 0, 1.0), 0.155, 0.022, M['Brown'], major=32, minor=6), ['hips'])
bpy.context.view_layer.objects.active.scale = (1.0, 0.72, 1.0)
P(rbox('buckle', (0, -0.115, 1.0), (0.05, 0.012, 0.038), M['Metal'], bevel=0.005), 'hips')
for s in (-1, 1): P(subsurf(rbox(f'pouch{s}', (s * 0.13, -0.06, 0.97), (0.06, 0.05, 0.07), M['Brown'], bevel=0.012), 1), 'hips')
P(torus('carabiner', (0.155, 0.02, 0.93), 0.022, 0.006, M['Metal'], rot=(0, math.pi / 2, 0), major=16, minor=6), 'hips')

# ---------------- backpack (on the `pack` spring bone) ----------------
P(subsurf(rbox('pack', (0, 0.2, 1.27), (0.3, 0.17, 0.36), M['Canvas'], bevel=0.05), 1), 'pack')
P(subsurf(rbox('packFlap', (0, 0.17, 1.42), (0.3, 0.2, 0.08), M['CanvasDark'], bevel=0.03), 1), 'pack')
P(subsurf(rbox('packPocket', (0, 0.29, 1.2), (0.2, 0.05, 0.14), M['CanvasDark'], bevel=0.02), 1), 'pack')
for s in (-1, 1): P(rbox(f'packBuckle{s}', (s * 0.07, 0.31, 1.3), (0.025, 0.01, 0.05), M['Brown'], bevel=0.004), 'pack')
P(cyl('bedroll', (0, 0.21, 1.5), 0.065, 0.36, M['CanvasDark'], 20, rot=(0, math.pi / 2, 0)), 'pack')
for s in (-1, 1): P(torus(f'rollTie{s}', (s * 0.11, 0.21, 1.5), 0.068, 0.008, M['Brown'], rot=(0, math.pi / 2, 0), major=20, minor=4), 'pack')
P(cyl('bottle', (0.175, 0.23, 1.2), 0.035, 0.16, M['Metal'], 16), 'pack')
P(cyl('bottleCap', (0.175, 0.23, 1.29), 0.025, 0.03, M['Sole'], 12), 'pack')

# ---------------- arms: rolled jacket sleeves, bare forearms, gloves, wrist compass ----------------
for side, s in (('R', -1), ('L', 1)):
    sh, el, wr = (s * 0.2, 0.0, 1.45), (s * 0.245, 0.0, 1.18), (s * 0.27, 0.0, 0.93)
    sleeveEnd = tuple(Vector(el) + (Vector(wr) - Vector(el)) * 0.25)
    P(curve_tube(f'sleeve{side}', [sh, el, sleeveEnd], 0.06, 0.05, M['Outfit']), [f'upperarm_{side}', f'forearm_{side}', 'chest'])
    P(torus(f'roll{side}', sleeveEnd, 0.05, 0.016, M['Outfit'], major=18, minor=6), [f'forearm_{side}'])
    P(curve_tube(f'forearm{side}', [sleeveEnd, wr], 0.041, 0.034, M['Skin']), [f'forearm_{side}', f'hand_{side}'])
    P(sphere(f'hand{side}', (s * 0.274, -0.008, 0.875), (0.033, 0.045, 0.058), M['Skin'], 16, 10), f'hand_{side}')
    P(sphere(f'thumb{side}', (s * 0.255, -0.04, 0.89), (0.016, 0.016, 0.03), M['Skin'], 8, 6, rot=(0.4, 0, 0)), f'hand_{side}')
    P(cyl(f'glove{side}', (s * 0.272, -0.004, 0.905), 0.038, 0.05, M['Brown'], 16), f'hand_{side}')
P(rbox('compass', (0.275, -0.035, 0.96), (0.05, 0.022, 0.045), M['Sole'], bevel=0.006), 'forearm_L')
P(cyl('compassGlass', (0.275, -0.048, 0.96), 0.016, 0.006, M['Glow'], 16, rot=(math.pi / 2, 0, 0)), 'forearm_L')

# ---------------- legs: cargo trousers & boots ----------------
P(subsurf(rbox('seat', (0, 0.0, 0.9), (0.3, 0.2, 0.16), M['Pants'], bevel=0.05), 1), ['hips', 'thigh_R', 'thigh_L'])
for side, s in (('R', -1), ('L', 1)):
    hp, kn, an = (s * 0.095, 0.0, 0.93), (s * 0.1, -0.005, 0.52), (s * 0.1, 0.0, 0.17)
    P(curve_tube(f'leg{side}', [hp, kn, an], 0.078, 0.056, M['Pants']), [f'thigh_{side}', f'shin_{side}', 'hips'])
    P(subsurf(rbox(f'cargo{side}', (s * 0.172, -0.01, 0.66), (0.03, 0.09, 0.11), M['Pants'], bevel=0.01), 1), f'thigh_{side}')
    P(cyl(f'bootShaft{side}', (s * 0.1, 0.0, 0.13), 0.062, 0.2, M['Boots'], 18, r2=0.058), [f'shin_{side}'])
    P(torus(f'bootCuff{side}', (s * 0.1, 0.0, 0.225), 0.061, 0.014, M['Boots'], major=18, minor=6), [f'shin_{side}'])
    P(subsurf(rbox(f'bootFoot{side}', (s * 0.1, -0.055, 0.05), (0.1, 0.24, 0.09), M['Boots'], bevel=0.03), 1), [f'foot_{side}', f'shin_{side}'])
    P(rbox(f'sole{side}', (s * 0.1, -0.055, 0.008), (0.108, 0.25, 0.016), M['Sole'], bevel=0.006), [f'foot_{side}', f'shin_{side}'])
    P(rbox(f'lace{side}', (s * 0.1, -0.13, 0.09), (0.04, 0.012, 0.05), M['Brown'], bevel=0.004, rot=(-0.6, 0, 0)), f'foot_{side}')

for o, bones in parts: weight_env(o, bones)
body = join([o for o, _ in parts], 'Body')
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = arm; body.parent = arm

# ---------------- hats (designed for the old head; fitted onto the new one) ----------------
OLD_C, NEW_C, K = Vector((0, 0, 1.63)), Vector((0, 0.005, 1.722)), 0.56
def hat(name, objs):
    o = join(objs, name)
    bpy.context.view_layer.update()
    o.matrix_world = Matrix.Translation(NEW_C) @ Matrix.Scale(K, 4) @ Matrix.Translation(-OLD_C) @ o.matrix_world
    parent_keep(o, arm, 'head'); return o
hats = [
    hat('Hat_Straw_hat', [cyl('brim', (0, 0, 1.83), 0.5, 0.035, M['Straw'], 32), cyl('crown', (0, 0, 1.93), 0.24, 0.2, M['Straw'], 24, r2=0.2), torus('band', (0, 0, 1.87), 0.235, 0.03, M['Accent'])]),
    hat('Hat_Cap', [sphere('capDome', (0, 0, 1.7), (0.285, 0.285, 0.2), M['Accent'], 24, 12), subsurf(rbox('bill', (0, -0.3, 1.71), (0.34, 0.2, 0.03), M['Accent'], bevel=0.01, rot=(-0.12, 0, 0)), 1), sphere('button', (0, 0, 1.9), (0.035,) * 3, M['Outfit'], 8, 6)]),
    hat('Hat_Flower_crown', [torus('vine', (0, 0, 1.84), 0.235, 0.03, M['Leaf'], rot=(0.12, 0, 0))] + [sphere(f'fl{i}', (math.cos(i * 0.785) * 0.235, math.sin(i * 0.785) * 0.235, 1.84 + math.sin(i * 0.785) * 0.03), (0.055,) * 3, M['Flower'] if i % 2 else M['White'], 10, 8) for i in range(8)]),
    hat('Hat_Hood', [subsurf(sphere('hood', (0, 0.04, 1.65), (0.31, 0.31, 0.32), M['Accent'], 24, 16), 0), torus('hoodRim', (0, -0.12, 1.63), 0.255, 0.04, M['Accent'], rot=(1.4, 0, 0))]),
    hat('Hat_Beanie', [sphere('beanie', (0, 0, 1.72), (0.29, 0.29, 0.25), M['Accent'], 24, 12), torus('beanieRim', (0, 0, 1.73), 0.27, 0.05, M['Accent']), sphere('pom', (0, 0, 1.98), (0.08,) * 3, M['White'], 12, 8)]),
    hat('Hat_Goggles', [torus('gband', (0, 0, 1.76), 0.265, 0.03, M['Dark'], rot=(-0.25, 0, 0))] + [cyl(f'lens{s}', (s * 0.1, -0.24, 1.82), 0.075, 0.07, M['Brass'], 16, rot=(1.2, 0, 0)) for s in (-1, 1)] + [cyl(f'glass{s}', (s * 0.1, -0.275, 1.835), 0.058, 0.02, M['Lens'], 16, rot=(1.2, 0, 0)) for s in (-1, 1)]),
    hat('Hat_Leaf_crown', [sphere(f'lf{i}', (math.cos(i * 0.698) * 0.25, math.sin(i * 0.698) * 0.25, 1.86), (0.11, 0.07, 0.035), M['Leaf'] if i % 2 else M['Leaf2'], 10, 6, rot=(0.5, 0, i * 0.698)) for i in range(9)] + [sphere('gemLC', (0, -0.24, 1.9), (0.05,) * 3, M['Gold'], 10, 8)]),
    hat('Hat_Sprout', [cyl('stem', (0, 0, 1.98), 0.018, 0.22, M['Leaf'], 6)] + [sphere(f'sp{s}', (s * 0.09, 0, 2.09), (0.1, 0.06, 0.03), M['Leaf2'], 10, 6, rot=(0, s * 0.5, 0)) for s in (-1, 1)]),
    hat('Hat_Keeper_circlet', [torus('circ', (0, 0, 1.76), 0.255, 0.035, M['Gold'], rot=(-0.2, 0, 0)), ico('gemK', (0, -0.26, 1.8), (0.07, 0.04, 0.07), M['Gem'], 0)]),
    hat('Hat_Captain_hat', [cyl('tri', (0, 0, 1.84), 0.44, 0.04, M['Dark'], 3, rot=(0, 0, math.pi / 6)), cyl('capTop', (0, 0, 1.95), 0.25, 0.22, M['Dark'], 16, r2=0.2), torus('capBand', (0, 0, 1.88), 0.235, 0.025, M['Brass'])]),
]

# ---------------- animation clips ----------------
# Conventions (bones point along their length, roll 0): limbs X- = swing forward/up, shin/forearm bend with X+/X-,
# Z = out to the side (R +, L −), spine/chest/head Y = twist, '_hips' = vertical offset of the pelvis.
FPS = 30
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
def clip(name, seconds, pose_fn, keys=24):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    n = max(2, keys)
    for k in range(n + 1):
        t = k / n; f = 1 + round(t * seconds * FPS)
        pose = pose_fn(t % 1.0); hips_y = pose.pop('_hips', 0.0)
        for b in pb:
            b.rotation_euler = pose.get(b.name, (0, 0, 0)); b.keyframe_insert('rotation_euler', frame=f, group=b.name)
        pb['hips'].location = (0, hips_y, 0); pb['hips'].keyframe_insert('location', frame=f, group='hips')
    return act
TAU = 2 * math.pi
S = lambda t, k=1, ph=0: math.sin(TAU * (t * k - ph))
C = lambda t, k=1, ph=0: math.cos(TAU * (t * k - ph))
pos = lambda x: max(0.0, x)

def relaxed(t, breathe=0.02):
    return {'upperarm_R': (0.03, 0, 0.1), 'upperarm_L': (0.03, 0, -0.1), 'forearm_R': (-0.2, 0, 0), 'forearm_L': (-0.2, 0, 0),
            'chest': (breathe * S(t), 0, 0), 'hand_R': (0.1, 0, 0), 'hand_L': (0.1, 0, 0)}

def idle(t, extra=None):  # 4 s: breathing, weight on the left leg, slow glance around
    p = relaxed(t)
    p.update({'hips': (0, 0, 0.035), 'spine': (0.02, 0, -0.03), 'chest': (0.025 * S(t, 2), 0.04 * S(t), -0.015),
              'head': (-0.04 + 0.02 * S(t, 2, 0.1), 0.18 * S(t, 1, 0.15) * pos(S(t, 1, 0.15)) - 0.06 * pos(-S(t, 1, 0.15)), 0.03),
              'thigh_R': (-0.08, 0, 0.06), 'shin_R': (0.18, 0, 0), 'foot_R': (-0.08, 0, 0), 'thigh_L': (0.02, 0, -0.02), 'shin_L': (0.02, 0, 0),
              'upperarm_R': (0.03 + 0.02 * S(t, 2, 0.2), 0, 0.12), 'upperarm_L': (0.0 + 0.02 * S(t, 2, 0.25), 0, -0.09), '_hips': -0.012 + 0.004 * S(t, 2)})
    if extra: p.update(extra)
    return p

def gait(t, run=False):
    """Walk/run cycle with contact/passing poses, pelvis tilt & twist, chest counter-rotation and lagging arms."""
    A = dict(th=0.95 if run else 0.48, kn=1.55 if run else 0.85, arm=0.85 if run else 0.42, el=1.35 if run else 0.32, lean=0.26 if run else 0.05, bob=0.05 if run else 0.022)
    p = {}
    for side, ph in (('R', 0.0), ('L', 0.5)):
        s = S(t, 1, ph)                                   # >0: this leg swinging forward
        knee = 0.12 + A['kn'] * pos(S(t, 1, ph + 0.12)) ** 1.3 + (0.25 if run else 0.0)
        p[f'thigh_{side}'] = (-A['th'] * s - (0.25 if run else 0.0) * pos(s), 0, 0)
        p[f'shin_{side}'] = (knee, 0, 0)
        p[f'foot_{side}'] = (0.35 * pos(-S(t, 1, ph - 0.05)) - 0.2 * pos(s), 0, 0)  # toe-off, then toes up for the heel strike
        lag = S(t, 1, ph + 0.5 + 0.06)                    # arm opposite its leg, slightly late (follow-through)
        p[f'upperarm_{side}'] = (-A['arm'] * lag, 0, 0.1 if side == 'R' else -0.1)
        p[f'forearm_{side}'] = (-A['el'] - (0.35 if run else 0.25) * pos(-lag), 0, 0)
        p[f'hand_{side}'] = (0.15, 0, 0)
    p['hips'] = (0, 0.14 * S(t) * (1.2 if run else 1), 0.05 * S(t))
    p['spine'] = (A['lean'] * 0.6, -0.06 * S(t), 0)
    p['chest'] = (A['lean'] * 0.4 + 0.02 * C(t, 2), -0.16 * S(t) * (1.3 if run else 1), -0.03 * S(t))
    p['head'] = (-A['lean'] * 0.8 + 0.025 * C(t, 2, 0.1), 0.12 * S(t), 0)
    p['_hips'] = A['bob'] * (C(t, 2, 0.1) if run else -C(t, 2)) - (0.06 if run else 0.0)
    return p

clip('Idle', 4.0, idle, keys=32)
clip('Hold', 2.4, lambda t: idle(t, {'upperarm_R': (-1.35, 0, 0.12), 'forearm_R': (-0.35, 0, 0), 'hand_R': (-0.1, 0, 0), 'head': (0.05, 0.05, 0)}))
clip('Walk', 1.0, lambda t: gait(t), keys=24)
clip('Run', 0.66, lambda t: gait(t, True), keys=24)
clip('Climb', 1.1, lambda t: {  # reach-and-pull: one hand reaches while the opposite leg pushes
    'upperarm_R': (-2.6 - 0.4 * S(t), 0, -0.2), 'upperarm_L': (-2.6 + 0.4 * S(t), 0, 0.2),
    'forearm_R': (-0.25 - 0.6 * pos(-S(t)), 0, 0), 'forearm_L': (-0.25 - 0.6 * pos(S(t)), 0, 0),
    'thigh_R': (-0.75 + 0.45 * S(t), 0, 0.12), 'thigh_L': (-0.75 - 0.45 * S(t), 0, -0.12), 'shin_R': (1.1 - 0.4 * S(t), 0, 0), 'shin_L': (1.1 + 0.4 * S(t), 0, 0),
    'foot_R': (-0.3, 0, 0), 'foot_L': (-0.3, 0, 0), 'spine': (0.1, 0, 0.06 * S(t)), 'chest': (0.06, 0.08 * S(t), 0), 'head': (-0.25, -0.1 * S(t), 0), '_hips': 0.02 * C(t, 2)}, keys=24)
clip('Glide', 2.0, lambda t: {  # hanging under the canopy, legs trailing with a lazy flutter
    'upperarm_R': (-2.95, 0, -0.42), 'upperarm_L': (-2.95, 0, 0.42), 'forearm_R': (-0.15, 0, 0), 'forearm_L': (-0.15, 0, 0), 'hand_R': (-0.2, 0, 0), 'hand_L': (-0.2, 0, 0),
    'spine': (-0.12, 0, 0.03 * S(t)), 'chest': (-0.06, 0.04 * S(t), 0), 'head': (0.2, 0.06 * S(t, 1, 0.2), 0),
    'thigh_R': (0.28 + 0.1 * S(t), 0, 0.05), 'thigh_L': (0.12 - 0.1 * S(t), 0, -0.05), 'shin_R': (0.45 + 0.1 * pos(S(t, 1, 0.1)), 0, 0), 'shin_L': (0.35 + 0.1 * pos(-S(t, 1, 0.1)), 0, 0),
    'foot_R': (0.45, 0, 0), 'foot_L': (0.45, 0, 0)}, keys=24)
clip('Fall', 1.0, lambda t: {  # arms up for balance, legs cycling
    'upperarm_R': (-0.15 + 0.1 * S(t), 0, 1.45 + 0.2 * S(t, 1, 0.1)), 'upperarm_L': (-0.15 - 0.1 * S(t), 0, -1.45 - 0.2 * S(t, 1, 0.1)), 'forearm_R': (-0.75 + 0.15 * S(t, 1, 0.2), 0, 0), 'forearm_L': (-0.75 - 0.15 * S(t, 1, 0.2), 0, 0), 'hand_R': (-0.3, 0, 0), 'hand_L': (-0.3, 0, 0),
    'thigh_R': (-0.45 + 0.3 * S(t), 0, 0.05), 'thigh_L': (0.15 - 0.3 * S(t), 0, -0.05), 'shin_R': (0.7 + 0.2 * S(t, 1, 0.2), 0, 0), 'shin_L': (0.5 - 0.2 * S(t, 1, 0.2), 0, 0),
    'spine': (-0.05, 0, 0), 'head': (0.12, 0, 0), 'foot_R': (0.3, 0, 0), 'foot_L': (0.3, 0, 0)}, keys=16)
clip('Grapple', 1.0, lambda t: {
    'upperarm_R': (-2.75, 0, -0.1), 'forearm_R': (-0.1, 0, 0), 'upperarm_L': (-0.4, 0, -0.55), 'forearm_L': (-0.9, 0, 0), 'spine': (-0.08, 0.12, 0), 'chest': (-0.05, 0.1, 0), 'head': (-0.2, 0, 0),
    'thigh_R': (0.35 + 0.08 * S(t), 0, 0), 'thigh_L': (-0.45, 0, 0), 'shin_R': (0.6, 0, 0), 'shin_L': (1.1, 0, 0), 'foot_R': (0.4, 0, 0), 'foot_L': (0.2, 0, 0)}, keys=16)
clip('Zip', 1.4, lambda t: {
    'upperarm_R': (-3.0, 0, -0.16), 'upperarm_L': (-3.0, 0, 0.16), 'forearm_R': (-0.12, 0, 0), 'forearm_L': (-0.12, 0, 0), 'head': (0.1, 0.1 * S(t), 0), 'spine': (-0.06, 0, 0.04 * S(t)),
    'thigh_R': (-0.55 + 0.12 * S(t), 0, 0.05), 'thigh_L': (-0.4 - 0.12 * S(t), 0, -0.05), 'shin_R': (0.9, 0, 0), 'shin_L': (0.8, 0, 0), 'foot_R': (0.3, 0, 0), 'foot_L': (0.3, 0, 0)}, keys=16)
clip('Wave', 1.2, lambda t: idle(t * 0.3, {'upperarm_R': (-0.35, 0, 2.45), 'forearm_R': (-0.65, 0, 0.5 * S(t, 2)), 'hand_R': (0, 0, 0.3 * S(t, 2, 0.1)), 'head': (0.0, -0.1, 0.06), 'chest': (0, -0.08, 0.04)}))
clip('Cheer', 0.8, lambda t: {
    'upperarm_R': (-2.85, 0, -0.45 - 0.1 * S(t)), 'upperarm_L': (-2.85, 0, 0.45 + 0.1 * S(t)), 'forearm_R': (-0.25, 0, 0), 'forearm_L': (-0.25, 0, 0), 'head': (-0.2, 0, 0), 'spine': (-0.12, 0, 0),
    'thigh_R': (-0.35 * pos(-S(t)), 0, 0.05), 'thigh_L': (-0.35 * pos(-S(t)), 0, -0.05), 'shin_R': (0.7 * pos(-S(t)), 0, 0), 'shin_L': (0.7 * pos(-S(t)), 0, 0),
    'foot_R': (0.4 * pos(S(t)), 0, 0), 'foot_L': (0.4 * pos(S(t)), 0, 0), '_hips': 0.16 * pos(S(t)) - 0.08 * pos(-S(t))})
clip('Dance', 1.2, lambda t: {
    'hips': (0, 0.25 * S(t), 0.1 * S(t, 2)), 'spine': (0, 0.15 * S(t), -0.08 * S(t, 2)), 'chest': (0.05, 0.25 * S(t, 1, 0.1), 0), 'head': (0, -0.3 * S(t, 1, 0.1), 0.1 * S(t, 2)),
    'upperarm_R': (-1.5 - 1.0 * S(t), 0, 0.7 * math.cos(-1.5 - 1.0 * S(t))), 'upperarm_L': (-1.5 + 1.0 * S(t), 0, -0.7 * math.cos(-1.5 + 1.0 * S(t))), 'forearm_R': (-0.9 - 0.3 * S(t, 2), 0, 0), 'forearm_L': (-0.9 + 0.3 * S(t, 2), 0, 0),
    'thigh_R': (-0.3 * pos(S(t)), 0, 0.12), 'thigh_L': (-0.3 * pos(-S(t)), 0, -0.12), 'shin_R': (0.6 * pos(S(t)), 0, 0), 'shin_L': (0.6 * pos(-S(t)), 0, 0), '_hips': -0.04 + 0.04 * abs(S(t, 2))}, keys=32)
clip('Sit', 3.0, lambda t: {
    'thigh_R': (-1.45, 0, 0.12), 'thigh_L': (-1.45, 0, -0.12), 'shin_R': (1.55, 0, 0), 'shin_L': (1.35, 0, 0), 'foot_R': (-0.2, 0, 0), 'foot_L': (-0.3, 0, 0),
    'upperarm_R': (-0.55, 0, 0.18), 'upperarm_L': (-0.55, 0, -0.18), 'forearm_R': (-0.9, 0, 0), 'forearm_L': (-0.9, 0, 0),
    'spine': (0.12 + 0.02 * S(t), 0, 0), 'chest': (0.05 + 0.02 * S(t, 2), 0, 0), 'head': (-0.15, 0.2 * S(t), 0), '_hips': -0.68}, keys=16)
arm.animation_data.action = bpy.data.actions['Idle']

# sanity checks: right foot forward at Walk t=0.25; hands up near the glider grips in Glide
def bone_pt(action, t, secs, bone, end='tail'):
    arm.animation_data.action = bpy.data.actions[action]; bpy.context.scene.frame_set(1 + round(t * secs * FPS)); bpy.context.view_layer.update()
    pbn = arm.pose.bones[bone]; return arm.matrix_world @ (pbn.tail if end == 'tail' else pbn.head)
print('CHECK walk right foot y (want < 0):', round(bone_pt('Walk', 0.25, 1.0, 'shin_R').y, 3))
print('CHECK glide right hand (want x ≈ -0.3, z ≈ 2.0):', tuple(round(v, 2) for v in bone_pt('Glide', 0.0, 2.0, 'hand_R')))
print('CHECK idle head top z (want ≈ 1.88):', round(bone_pt('Idle', 0.0, 4.0, 'head').z, 3))
GRIP_R, GRIP_L = bone_pt('Glide', 0.0, 2.0, 'hand_R'), bone_pt('Glide', 0.0, 2.0, 'hand_L')
arm.animation_data.action = bpy.data.actions['Idle']; bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
# ---------------- paraglider (parented to the chest; hands hold the risers in the Glide pose) ----------------
def canopy_mesh(name, r, w, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=w, location=(0, 0, 1.3), rotation=(math.pi / 2, 0, 0), end_fill_type='NOTHING')
    o = _active(); o.name = name
    bm = _bm.new(); bm.from_mesh(o.data)
    _bm.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < r * math.cos(1.0) - 1e-4], context='VERTS')
    bm.to_mesh(o.data); bm.free()
    return o
g1 = canopy_mesh('canopy', 1.6, 1.25, M['GliderCanopy']); g1.data.materials.append(M['GliderCanopy'])
g2 = canopy_mesh('stripe', 1.615, 0.24, M['GliderStripe']); g2.data.materials.append(M['GliderStripe'])
for o in (g1, g2):
    for p in o.data.polygons: p.use_smooth = True
lines = []
for s in (-1, 1):
    hand = GRIP_R.copy() if s < 0 else GRIP_L.copy()
    for ang in (0.25, 0.55, 0.85):  # risers fanning from each hand up to the canopy's underside
        tip = Vector((s * math.sin(ang) * 1.58, 0, 1.3 + math.cos(ang) * 1.58))
        lines.append(curve_tube(f'line{s}{ang}', [tuple(hand), tuple((hand + tip) / 2), tuple(tip)], 0.006, 0.006, M['Sole'], res=2))
    lines.append(cyl(f'grip{s}', tuple(hand), 0.018, 0.08, M['Brown'], 8, rot=(math.pi / 2, 0, 0)))
glider = join([g1, g2] + lines, 'Glider'); parent_keep(glider, arm, 'chest')

export(out_path('character.glb'), [arm, body, glider] + hats, animations=True)
