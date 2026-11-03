"""The Thornheart (Thornwood Hollow's guardian) → public/assets/thornheart.glb

Named parts the game drives: "Heart" (spins/glows), "Thorns" (wither away after phase 1),
"Blossoms" (appear when healed). Material roles: Bark, Leaves, Eyes, Heart, Thorn, Blossom, Dark.
Clips: Sway (restless), Calm (healed), Roar (phase change).
"""
import bpy, math, os, sys, random
sys.path.append(os.path.dirname(__file__))
from common import *

reset(); random.seed(7)
M = {k: mat(k, c) for k, c in {'Bark': '#6b4a3a', 'Leaves': '#6a5a6e', 'Eyes': '#ff3d5a', 'Heart': '#ff3d5a', 'Thorn': '#3b2340',
                               'Blossom': '#ff8fb1', 'White': '#ffffff', 'Dark': '#2a1d16', 'Moss': '#5c7a4a'}.items()}
BONES = [('root', (0, 0, 0), (0, 0, 2), None), ('trunk1', (0, 0, 2), (0, 0, 6), 'root'), ('trunk2', (0, 0, 6), (0, 0, 8.6), 'trunk1'),
         ('head', (0, 0, 8.6), (0, 0, 12.5), 'trunk2'), ('arm_R', (-2.2, 0, 7.6), (-4.2, -1.0, 4.4), 'trunk2'), ('arm_L', (2.2, 0, 7.6), (4.2, -1.0, 4.4), 'trunk2')]
ad = bpy.data.armatures.new('ThornRig'); arm = bpy.data.objects.new('Thornheart', ad); bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
for n, h, t, p in BONES:
    b = ad.edit_bones.new(n); b.head = h; b.tail = t
    if p: b.parent = ad.edit_bones[p]
bpy.ops.object.mode_set(mode='OBJECT')

def weight_by_height(o):
    """Blend trunk weights by height so the trunk bends smoothly when it sways."""
    g = {n: o.vertex_groups.new(name=n) for n in ('root', 'trunk1', 'trunk2')}
    for v in o.data.vertices:
        z = (o.matrix_world @ v.co).z
        w2 = min(1, max(0, (z - 5.0) / 2.5)); w0 = min(1, max(0, (2.5 - z) / 2.5))
        g['trunk2'].add([v.index], w2, 'REPLACE'); g['root'].add([v.index], w0, 'REPLACE'); g['trunk1'].add([v.index], max(0, 1 - w2 - w0), 'REPLACE')

parts = []
# trunk: tapered, subdivided, twisted and displaced
trunk = cyl('trunk', (0, 0, 4.5), 2.8, 9, M['Bark'], verts=28, r2=1.9)
subsurf(trunk, 2)
tw = trunk.modifiers.new('tw', 'SIMPLE_DEFORM'); tw.deform_method = 'TWIST'; tw.angle = 0.7; tw.deform_axis = 'Z'; apply_mods(trunk)
displace(trunk, 0.45, 0.9)
weight_by_height(trunk); parts.append(trunk)
for i in range(7):  # roots
    a = i / 7 * math.tau + random.uniform(-0.2, 0.2)
    pts = [(math.cos(a) * 1.8, math.sin(a) * 1.8, 1.6), (math.cos(a) * 3.4, math.sin(a) * 3.4, 0.5), (math.cos(a + 0.2) * 5.4, math.sin(a + 0.2) * 5.4, -0.1)]
    o = curve_tube(f'root{i}', pts, 0.75, 0.15, M['Bark']); weight_all(o, 'root'); parts.append(o)
# head with brow, eyes, mouth, nose knot, moss
head = ico('head', (0, 0, 10.2), (2.3, 2.1, 2.0), M['Bark'], 3); displace(head, 0.3, 0.7); weight_all(head, 'head'); parts.append(head)
brow = curve_tube('brow', [(-1.5, -1.75, 11.0), (0, -2.05, 11.25), (1.5, -1.75, 11.0)], 0.32, 0.32, M['Bark']); weight_all(brow, 'head'); parts.append(brow)
for s in (-1, 1):
    for o in (sphere(f'eye{s}', (s * 0.85, -1.92, 10.5), (0.4, 0.25, 0.4), M['Eyes'], 16, 12), torus(f'socket{s}', (s * 0.85, -1.85, 10.5), 0.46, 0.1, M['Dark'], rot=(math.pi / 2, 0, 0), major=20, minor=6)):
        weight_all(o, 'head'); parts.append(o)
mouth = torus('mouth', (0, -2.0, 9.35), 0.55, 0.12, M['Dark'], rot=(math.pi / 2, 0, 0), major=24, minor=6)
import bmesh
bm = bmesh.new(); bm.from_mesh(mouth.data); bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.05], context='VERTS'); bm.to_mesh(mouth.data); bm.free()
weight_all(mouth, 'head'); parts.append(mouth)
nose = ico('noseKnot', (0, -2.2, 9.9), (0.35, 0.3, 0.45), M['Bark'], 2); weight_all(nose, 'head'); parts.append(nose)
for i in range(5):
    a = i / 5 * math.tau; m = ico(f'moss{i}', (math.cos(a) * 1.9, math.sin(a) * 1.7, 8.9), (0.7, 0.6, 0.35), M['Moss'], 2); displace(m, 0.15, 0.4); weight_all(m, 'head'); parts.append(m)
# crown of leaves
for i in range(11):
    a = i / 11 * math.tau; r = 1.6 + random.uniform(0, 0.6)
    o = ico(f'leaf{i}', (math.cos(a) * r, math.sin(a) * r, 12.0 + random.uniform(0, 1.1)), (1.2, 1.2, 0.9), M['Leaves'], 2); displace(o, 0.25, 0.5); weight_all(o, 'head'); parts.append(o)
for i in range(4):
    a = i / 4 * math.tau + 0.4; o = curve_tube(f'twig{i}', [(math.cos(a) * 0.8, math.sin(a) * 0.8, 11.6), (math.cos(a) * 1.8, math.sin(a) * 1.8, 13.4)], 0.18, 0.05, M['Bark']); weight_all(o, 'head'); parts.append(o)
# branch arms with leafy hands
for side, s in (('R', -1), ('L', 1)):
    pts = [(s * 2.0, 0, 7.8), (s * 3.4, -0.4, 6.8), (s * 4.0, -0.9, 5.4), (s * 4.3, -1.1, 4.2)]
    o = curve_tube(f'arm{side}', pts, 0.7, 0.3, M['Bark']); weight_all(o, f'arm_{side}'); parts.append(o)
    for k in range(3):
        t = curve_tube(f'finger{side}{k}', [(s * 4.3, -1.1, 4.3), (s * (4.5 + 0.3 * k), -1.5 - 0.3 * (k - 1), 3.4)], 0.2, 0.06, M['Bark']); weight_all(t, f'arm_{side}'); parts.append(t)
    for k in range(3):
        l = ico(f'hleaf{side}{k}', (s * (4.0 + 0.4 * k), -0.8 - 0.3 * k, 5.6 - 0.4 * k), (0.7, 0.7, 0.55), M['Leaves'], 2); displace(l, 0.15, 0.4); weight_all(l, f'arm_{side}'); parts.append(l)
body = join(parts, 'ThornBody'); body.modifiers.new('Armature', 'ARMATURE').object = arm; body.parent = arm

# detachable parts
heart = ico('Heart', (0, -2.35, 5.6), (0.75, 0.5, 1.1), M['Heart'], 0)
for p in heart.data.polygons: p.use_smooth = False
parent_keep(heart, arm, 'trunk1')
thorn_objs = []
for i in range(46):
    z = random.uniform(1.2, 8.2); a = random.uniform(0, math.tau); r = 2.75 - (z - 1) * 0.1
    d = (math.cos(a), math.sin(a), 0.25)
    t = cyl(f'th{i}', (math.cos(a) * r, math.sin(a) * r, z), 0.24, 1.6, M['Thorn'], 6, r2=0.0)
    t.rotation_mode = 'QUATERNION'; from mathutils import Vector
    t.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()); t.location = Vector((math.cos(a) * (r + 0.5), math.sin(a) * (r + 0.5), z))
    thorn_objs.append(t)
thorns = join(thorn_objs, 'Thorns'); parent_keep(thorns, arm, 'trunk1')
bl = []
for i in range(18):
    a = i * 2.4; r = 2.1 + (i % 3) * 0.3
    c = (math.cos(a) * r, math.sin(a) * r, 11.6 + (i % 4) * 0.45)
    for k in range(5):
        pa = k / 5 * math.tau; bl.append(sphere(f'pet{i}{k}', (c[0] + math.cos(pa) * 0.22, c[1] + math.sin(pa) * 0.22, c[2]), (0.2, 0.2, 0.08), M['Blossom'] if i % 2 else M['White'], 8, 6))
    bl.append(sphere(f'ctr{i}', c, (0.1,) * 3, M['Heart'] if False else mat('Pollen', '#ffd54f'), 8, 6))
blossoms = join(bl, 'Blossoms'); parent_keep(blossoms, arm, 'head')

# animation
pb = arm.pose.bones
for b in pb: b.rotation_mode = 'XYZ'
def clip(name, seconds, fn, keys=16):
    act = bpy.data.actions.new(name); act.use_fake_user = True; arm.animation_data_create(); arm.animation_data.action = act
    for k in range(keys + 1):
        t = k / keys; f = 1 + round(t * seconds * 30); pose = fn(t)
        for b in pb: b.rotation_euler = pose.get(b.name, (0, 0, 0)); b.keyframe_insert('rotation_euler', frame=f, group=b.name)
S = lambda t, k=1: math.sin(math.tau * t * k)
clip('Sway', 3.0, lambda t: {'trunk1': (0.03 * S(t), 0.06 * S(t), 0), 'trunk2': (0.05 * S(t), 0.1 * S(t), 0.04 * S(t, 2)), 'head': (0.08 * S(t, 2), -0.12 * S(t), 0),
                              'arm_R': (0.25 * S(t), 0, 0.2 * S(t, 2)), 'arm_L': (-0.25 * S(t), 0, -0.2 * S(t, 2))})
clip('Calm', 5.0, lambda t: {'trunk2': (0.015 * S(t), 0.03 * S(t), 0), 'head': (0.03 * S(t), 0.04 * S(t), 0), 'arm_R': (0.06 * S(t), 0, 0.05), 'arm_L': (-0.06 * S(t), 0, -0.05)})
clip('Roar', 1.6, lambda t: (lambda e: {'trunk2': (-0.15 * e, 0, 0), 'head': (-0.45 * e, 0.08 * S(t, 6) * e, 0), 'arm_R': (-0.9 * e, 0, -0.6 * e), 'arm_L': (-0.9 * e, 0, 0.6 * e)})(math.sin(math.pi * t)))
arm.animation_data.action = bpy.data.actions['Sway']
export(out_path('thornheart.glb'), [arm, body, heart, thorns, blossoms], animations=True)
