"""Rigged, animated player/NPC character → public/assets/character.glb

One skinned body (rigid-weighted parts on a 15-bone rig), ten hat variants and a
paraglider parented to bones, plus looping animation clips the game cross-fades between.
Colours are placeholders: the game recolours material roles from each player's look.
"""
import bpy, math, os, sys
sys.path.append(os.path.dirname(__file__))
from common import *

reset()
M = {k: mat(k, c) for k, c in {
    'Outfit': '#ff6b6b', 'Accent': '#ffffff', 'Skin': '#f6cba8', 'Hair': '#5a3825', 'Pants': '#3d4a5c', 'Boots': '#7a5232',
    'Eye': '#1f2328', 'White': '#ffffff', 'Blush': '#ff9aa8', 'Brown': '#7a5232', 'Brass': '#d9a441', 'Straw': '#e8c872',
    'Leaf': '#4caf50', 'Leaf2': '#8bd34a', 'Flower': '#ff8fb1', 'Gold': '#ffcf40', 'Gem': '#9be7ff', 'Lens': '#7fe0e8',
    'Dark': '#2b2f3a', 'GliderCanopy': '#ff7043', 'GliderStripe': '#ffffff'}.items()}

# ---------------- skeleton ----------------
BONES = [  # name, head, tail, parent
    ('hips', (0, 0, 0.62), (0, 0, 0.86), None), ('spine', (0, 0, 0.86), (0, 0, 1.32), 'hips'), ('head', (0, 0, 1.36), (0, 0, 1.95), 'spine'),
    ('upperarm_R', (-0.37, 0, 1.31), (-0.37, 0, 1.06), 'spine'), ('forearm_R', (-0.37, 0, 1.06), (-0.37, 0, 0.86), 'upperarm_R'), ('hand_R', (-0.37, 0, 0.86), (-0.37, 0, 0.76), 'forearm_R'),
    ('upperarm_L', (0.37, 0, 1.31), (0.37, 0, 1.06), 'spine'), ('forearm_L', (0.37, 0, 1.06), (0.37, 0, 0.86), 'upperarm_L'), ('hand_L', (0.37, 0, 0.86), (0.37, 0, 0.76), 'forearm_L'),
    ('thigh_R', (-0.13, 0, 0.6), (-0.13, 0, 0.34), 'hips'), ('shin_R', (-0.13, 0, 0.34), (-0.13, 0, 0.08), 'thigh_R'), ('foot_R', (-0.13, 0, 0.08), (-0.13, -0.16, 0.04), 'shin_R'),
    ('thigh_L', (0.13, 0, 0.6), (0.13, 0, 0.34), 'hips'), ('shin_L', (0.13, 0, 0.34), (0.13, 0, 0.08), 'thigh_L'), ('foot_L', (0.13, 0, 0.08), (0.13, -0.16, 0.04), 'shin_L'),
]
ad = bpy.data.armatures.new('Rig'); arm = bpy.data.objects.new('Character', ad); bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, par in BONES:
    b = ad.edit_bones.new(name); b.head = h; b.tail = t; b.roll = 0
    if par: b.parent = ad.edit_bones[par]; b.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------- body parts (facing -Y) ----------------
parts = []
def P(o, bone): parts.append((o, bone)); return o
P(subsurf(rbox('torso', (0, 0, 1.07), (0.5, 0.32, 0.5), M['Outfit'], bevel=0.12), 1), 'spine')
P(cyl('tunic', (0, 0, 0.8), 0.38, 0.3, M['Outfit'], verts=24, r2=0.29), 'hips')
P(torus('belt', (0, 0, 0.89), 0.285, 0.045, M['Brown']), 'hips')
P(sphere('buckle', (0, -0.3, 0.89), (0.05, 0.03, 0.05), M['Brass'], 10, 8), 'hips')
P(torus('scarf', (0, 0, 1.36), 0.19, 0.075, M['Accent']), 'spine')
P(subsurf(rbox('scarfTail', (0.1, 0.2, 1.22), (0.12, 0.05, 0.3), M['Accent'], bevel=0.02, rot=(0.25, 0, 0.15)), 1), 'spine')
P(subsurf(rbox('pack', (0, 0.31, 1.06), (0.42, 0.22, 0.46), M['Brown'], bevel=0.06), 1), 'spine')
P(cyl('bedroll', (0, 0.33, 1.36), 0.085, 0.5, M['Accent'], rot=(0, math.pi / 2, 0)), 'spine')
for s in (-1, 1): P(cyl(f'strap{s}', (s * 0.15, -0.02, 1.12), 0.035, 0.42, M['Brown'], verts=8, rot=(0.2, 0, 0)), 'spine')
# head & face
P(sphere('skull', (0, 0, 1.63), (0.26, 0.25, 0.26), M['Skin'], 32, 20), 'head')
P(sphere('nose', (0, -0.255, 1.6), (0.035, 0.03, 0.03), M['Skin'], 10, 8), 'head')
for s in (-1, 1):
    P(sphere(f'eye{s}', (s * 0.09, -0.222, 1.66), (0.042, 0.03, 0.05), M['Eye'], 14, 10), 'head')
    P(sphere(f'glint{s}', (s * 0.078, -0.247, 1.678), (0.014, 0.01, 0.014), M['White'], 8, 6), 'head')
    P(sphere(f'blush{s}', (s * 0.155, -0.2, 1.585), (0.04, 0.012, 0.028), M['Blush'], 10, 6, rot=(0, 0, s * 0.6)), 'head')
    P(sphere(f'ear{s}', (s * 0.255, 0, 1.62), (0.04, 0.05, 0.06), M['Skin'], 10, 8), 'head')
hair = sphere('hairCap', (0, 0.02, 1.665), (0.275, 0.275, 0.275), M['Hair'], 32, 20)
import bmesh as _bm
bm = _bm.new(); bm.from_mesh(hair.data)
_bm.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.25 or (v.co.y < -0.05 and v.co.z < 0.25)], context='VERTS'); bm.to_mesh(hair.data); bm.free()
P(hair, 'head')
P(sphere('fringeA', (-0.1, -0.17, 1.82), (0.12, 0.07, 0.06), M['Hair'], 14, 10, rot=(0, 0, 0.4)), 'head')
P(sphere('fringeB', (0.09, -0.18, 1.83), (0.11, 0.07, 0.055), M['Hair'], 14, 10, rot=(0, 0, -0.3)), 'head')
P(sphere('tuft', (0, 0.2, 1.76), (0.1, 0.09, 0.12), M['Hair'], 12, 10), 'head')
# limbs
for side, x in (('R', -0.37), ('L', 0.37)):
    P(capsule(f'upper{side}', (x, 0, 1.3), (x, 0, 1.08), 0.085, M['Outfit']), f'upperarm_{side}')
    P(capsule(f'fore{side}', (x, 0, 1.05), (x, 0, 0.88), 0.075, M['Outfit']), f'forearm_{side}')
    P(torus(f'cuff{side}', (x, 0, 0.9), 0.075, 0.025, M['Accent'], major=16, minor=6), f'forearm_{side}')
    P(sphere(f'hand{side}', (x, -0.01, 0.81), (0.075, 0.07, 0.085), M['Skin'], 16, 10), f'hand_{side}')
    P(sphere(f'thumb{side}', (x - math.copysign(0.05, x) * -1, -0.05, 0.84), (0.03, 0.03, 0.04), M['Skin'], 8, 6), f'hand_{side}')
for side, x in (('R', -0.13), ('L', 0.13)):
    P(capsule(f'thigh{side}', (x, 0, 0.58), (x, 0, 0.36), 0.1, M['Pants']), f'thigh_{side}')
    P(capsule(f'shin{side}', (x, 0, 0.33), (x, 0, 0.12), 0.09, M['Pants']), f'shin_{side}')
    P(subsurf(rbox(f'boot{side}', (x, -0.04, 0.07), (0.19, 0.3, 0.15), M['Boots'], bevel=0.05), 1), f'foot_{side}')
for o, bone in parts: weight_all(o, bone)
body = join([o for o, _ in parts], 'Body')
mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = arm; body.parent = arm

# ---------------- hats (parented to the head bone; the game shows one) ----------------
def hat(name, objs):
    o = join(objs, name); parent_keep(o, arm, 'head'); return o
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
# ---------------- paraglider (parented to the spine) ----------------
def canopy_mesh(name, r, w, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=r, depth=w, location=(0, 0, 1.0), rotation=(math.pi / 2, 0, 0), end_fill_type='NOTHING')
    o = _active(); o.name = name
    import bmesh as B
    bm = B.new(); bm.from_mesh(o.data)
    B.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < r * math.cos(1.0) - 1e-4 and True], context='VERTS')
    bm.to_mesh(o.data); bm.free()
    return o
from common import _active
g1 = canopy_mesh('canopy', 1.35, 1.0, M['GliderCanopy']); g1.data.materials.append(M['GliderCanopy'])
g2 = canopy_mesh('stripe', 1.365, 0.2, M['GliderStripe']); g2.data.materials.append(M['GliderStripe'])
for o in (g1, g2):
    for p in o.data.polygons: p.use_smooth = True
struts = [cyl(f'strut{s}', (s * 0.45, 0, 1.95), 0.02, 0.85, M['Brown'], 6, rot=(0, -s * 0.5, 0)) for s in (-1, 1)]
glider = join([g1, g2] + struts, 'Glider'); parent_keep(glider, arm, 'spine')

# ---------------- animation clips ----------------
FPS = 30
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
def clip(name, seconds, pose_fn, keys=16):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data_create(); arm.animation_data.action = act
    n = max(2, keys)
    for k in range(n + 1):
        t = k / n; f = 1 + round(t * seconds * FPS)
        pose = pose_fn(t); hips_y = pose.pop('_hips', 0.0)
        for b in pb:
            b.rotation_euler = pose.get(b.name, (0, 0, 0)); b.keyframe_insert('rotation_euler', frame=f, group=b.name)
        pb['hips'].location = (0, hips_y, 0); pb['hips'].keyframe_insert('location', frame=f, group='hips')
    return act
S = lambda t, k=1: math.sin(2 * math.pi * t * k)
C = lambda t, k=1: math.cos(2 * math.pi * t * k)
def idle(t, extra=None):
    p = {'spine': (0.03 * S(t), 0, 0), 'head': (-0.03 * S(t), 0.06 * S(t, 0.5) if False else 0.05 * math.sin(math.pi * 2 * t), 0),
         'upperarm_R': (0.02 * S(t), 0, 0.09), 'upperarm_L': (0.02 * S(t), 0, -0.09), 'forearm_R': (-0.12, 0, 0), 'forearm_L': (-0.12, 0, 0), '_hips': 0.008 * S(t)}
    if extra: p.update(extra)
    return p
clip('Idle', 2.4, idle)
clip('Hold', 2.4, lambda t: idle(t, {'upperarm_R': (-1.45, 0, 0.05), 'forearm_R': (-0.25, 0, 0)}))
clip('Walk', 0.9, lambda t: {'thigh_R': (-0.55 * S(t), 0, 0), 'thigh_L': (0.55 * S(t), 0, 0), 'shin_R': (0.55 * max(0, S(t)) + 0.1, 0, 0), 'shin_L': (0.55 * max(0, -S(t)) + 0.1, 0, 0),
                              'upperarm_R': (0.45 * S(t), 0, 0.08), 'upperarm_L': (-0.45 * S(t), 0, -0.08), 'forearm_R': (-0.3, 0, 0), 'forearm_L': (-0.3, 0, 0), 'spine': (0.05, 0.08 * S(t), 0), '_hips': 0.03 * abs(C(t))})
clip('Run', 0.62, lambda t: {'thigh_R': (-0.95 * S(t), 0, 0), 'thigh_L': (0.95 * S(t), 0, 0), 'shin_R': (1.1 * max(0, S(t)) + 0.25, 0, 0), 'shin_L': (1.1 * max(0, -S(t)) + 0.25, 0, 0),
                              'upperarm_R': (0.75 * S(t), 0, 0.1), 'upperarm_L': (-0.75 * S(t), 0, -0.1), 'forearm_R': (-1.2, 0, 0), 'forearm_L': (-1.2, 0, 0), 'spine': (0.2, 0.12 * S(t), 0), 'head': (-0.1, 0, 0), '_hips': 0.06 * abs(C(t))})
clip('Climb', 0.9, lambda t: {'upperarm_R': (-2.7 + 0.35 * S(t), 0, 0.12), 'upperarm_L': (-2.7 - 0.35 * S(t), 0, -0.12), 'forearm_R': (-0.35 - 0.2 * max(0, S(t)), 0, 0), 'forearm_L': (-0.35 - 0.2 * max(0, -S(t)), 0, 0),
                              'thigh_R': (-0.6 - 0.4 * S(t), 0, 0), 'thigh_L': (-0.6 + 0.4 * S(t), 0, 0), 'shin_R': (0.9, 0, 0), 'shin_L': (0.9, 0, 0), 'spine': (0.12, 0, 0)})
clip('Glide', 1.6, lambda t: {'upperarm_R': (-2.95, 0, 0.22), 'upperarm_L': (-2.95, 0, -0.22), 'forearm_R': (-0.1, 0, 0), 'forearm_L': (-0.1, 0, 0),
                               'thigh_R': (0.28 + 0.08 * S(t), 0, 0), 'thigh_L': (0.16 - 0.08 * S(t), 0, 0), 'shin_R': (0.35, 0, 0), 'shin_L': (0.3, 0, 0), 'spine': (-0.05, 0, 0.03 * S(t)), 'head': (0.08, 0, 0)})
clip('Fall', 0.8, lambda t: {'upperarm_R': (-0.5, 0, 1.25 + 0.25 * S(t)), 'upperarm_L': (-0.5, 0, -1.25 - 0.25 * S(t)), 'forearm_R': (-0.3, 0, 0), 'forearm_L': (-0.3, 0, 0),
                              'thigh_R': (-0.35 + 0.2 * S(t), 0, 0), 'thigh_L': (0.3 - 0.2 * S(t), 0, 0), 'shin_R': (0.5, 0, 0), 'shin_L': (0.5, 0, 0)})
clip('Grapple', 1.0, lambda t: {'upperarm_R': (-2.9, 0, 0.05), 'upperarm_L': (-0.5, 0, -0.3), 'thigh_R': (0.4 + 0.1 * S(t), 0, 0), 'thigh_L': (-0.2, 0, 0), 'shin_R': (0.45, 0, 0), 'shin_L': (0.6, 0, 0)})
clip('Zip', 1.0, lambda t: {'upperarm_R': (-3.05, 0, 0.12), 'upperarm_L': (-3.05, 0, -0.12), 'thigh_R': (0.4 + 0.12 * S(t), 0, 0), 'thigh_L': (0.25 - 0.12 * S(t), 0, 0), 'shin_R': (0.45, 0, 0), 'shin_L': (0.4, 0, 0)})
clip('Wave', 1.0, lambda t: idle(t, {'upperarm_R': (-0.3, 0, 2.5), 'forearm_R': (-0.5, 0, 0.5 * S(t, 2))}))
clip('Cheer', 0.7, lambda t: {'upperarm_R': (-3.0, 0, 0.35), 'upperarm_L': (-3.0, 0, -0.35), 'forearm_R': (-0.2, 0, 0), 'forearm_L': (-0.2, 0, 0),
                               'thigh_R': (-0.3 * abs(S(t)), 0, 0), 'thigh_L': (-0.3 * abs(S(t)), 0, 0), 'shin_R': (0.5 * abs(S(t)), 0, 0), 'shin_L': (0.5 * abs(S(t)), 0, 0), '_hips': 0.12 * abs(S(t))})
clip('Dance', 1.0, lambda t: {'spine': (0, 0.5 * S(t), 0), 'upperarm_R': (-1.6 - 1.2 * S(t), 0, 0.6), 'upperarm_L': (-1.6 + 1.2 * S(t), 0, -0.6), 'forearm_R': (-0.6, 0, 0), 'forearm_L': (-0.6, 0, 0),
                               'thigh_R': (0.4 * S(t), 0, 0.1), 'thigh_L': (-0.4 * S(t), 0, -0.1), 'shin_R': (0.3 * abs(S(t)), 0, 0), 'shin_L': (0.3 * abs(S(t)), 0, 0), 'head': (0, -0.25 * S(t), 0), '_hips': 0.06 * abs(S(t, 2))})
clip('Sit', 2.0, lambda t: {'thigh_R': (-1.5, 0, 0.05), 'thigh_L': (-1.5, 0, -0.05), 'shin_R': (1.5, 0, 0), 'shin_L': (1.5, 0, 0), 'upperarm_R': (-0.45, 0, 0.1), 'upperarm_L': (-0.45, 0, -0.1),
                             'forearm_R': (-0.7, 0, 0), 'forearm_L': (-0.7, 0, 0), 'spine': (0.06 + 0.02 * S(t), 0, 0), '_hips': -0.42}, keys=8)
arm.animation_data.action = bpy.data.actions['Idle']

# sanity check: Walk at t=0.25 should swing the right foot forward (-Y)
bpy.context.scene.frame_set(1 + round(0.25 * 0.9 * FPS)); arm.animation_data.action = bpy.data.actions['Walk']; bpy.context.view_layer.update()
print('CHECK right foot y (want < 0):', round((arm.matrix_world @ arm.pose.bones['shin_R'].tail).y, 3))
arm.animation_data.action = bpy.data.actions['Idle']; bpy.context.scene.frame_set(1)
export(out_path('character.glb'), [arm, body, glider] + hats, animations=True)
