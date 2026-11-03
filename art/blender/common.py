"""Shared helpers for Canopy Spire's procedural Blender assets.

Conventions (the game relies on these):
- Blender is Z-up and models face -Y; the glTF exporter converts to Y-up / +Z forward,
  which is the game's convention.
- Material *names* are roles (e.g. "Outfit", "Bark", "Leaves"). The game swaps each one for
  its own cel-shaded material, keeping the base colour unless the role is recoloured
  (player look, district vibrance, etc.).
- Bone names avoid dots (three.js strips them from node names).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Euler

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def mat(name, hexcol, rough=0.85):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    h = hexcol.lstrip('#'); rgb = [srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    m.diffuse_color = (*rgb, 1)
    return m

def _finish(o, material, smooth=True):
    if material is not None:
        o.data.materials.clear(); o.data.materials.append(material)
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    return o

def _active():
    return bpy.context.view_layer.objects.active

def sphere(name, loc, scale=(1, 1, 1), material=None, seg=24, ring=14, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=1, location=loc, rotation=rot)
    o = _active(); o.name = name; o.scale = scale; apply_transform(o); return _finish(o, material)

def ico(name, loc, scale=(1, 1, 1), material=None, sub=2, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc, rotation=rot)
    o = _active(); o.name = name; o.scale = scale; apply_transform(o); return _finish(o, material)

def cyl(name, loc, r, depth, material=None, verts=20, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = _active(); o.name = name; return _finish(o, material)

def torus(name, loc, R, r, material=None, rot=(0, 0, 0), major=32, minor=10):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor, location=loc, rotation=rot)
    o = _active(); o.name = name; return _finish(o, material)

def rbox(name, loc, size, material=None, bevel=0.05, segs=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = _active(); o.name = name; o.scale = size; apply_transform(o)
    if bevel > 0:
        m = o.modifiers.new('bevel', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'NONE'
        apply_mods(o)
    return _finish(o, material)

def capsule(name, p0, p1, r, material=None, seg=20):
    """An ellipsoid stretched between two points — reads as a soft limb under toon shading."""
    a, b = Vector(p0), Vector(p1); mid = (a + b) / 2; d = b - a
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=12, radius=1, location=mid)
    o = _active(); o.name = name
    o.scale = (r, r, d.length / 2 + r * 0.6)
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    apply_transform(o); return _finish(o, material)

def subsurf(o, levels=1):
    if levels <= 0: return o
    m = o.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels; apply_mods(o); return o

def displace(o, strength=0.1, size=0.5, seed=0):
    tex = bpy.data.textures.new(f'{o.name}_noise', 'CLOUDS'); tex.noise_scale = size; tex.noise_depth = 2
    m = o.modifiers.new('disp', 'DISPLACE'); m.texture = tex; m.strength = strength; m.mid_level = 0.5
    m.texture_coords = 'LOCAL'
    apply_mods(o); return o

def apply_transform(o):
    with bpy.context.temp_override(object=o, active_object=o, selected_editable_objects=[o], selected_objects=[o]):
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

def apply_mods(o):
    for m in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=m.name)

def join(objs, name):
    objs = [o for o in objs if o is not None]
    with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    o = objs[0]; o.name = name; o.data.name = name; return o

def weight_all(o, group):
    vg = o.vertex_groups.get(group) or o.vertex_groups.new(name=group)
    vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE'); return o

def curve_tube(name, pts, r0, r1, material=None, res=6):
    """A tapered tube along a poly-bezier through pts (branches, roots, vines)."""
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '3D'; cd.bevel_depth = 1.0; cd.bevel_resolution = 3
    cd.resolution_u = res; cd.use_fill_caps = True
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for i, (p, bp) in enumerate(zip(pts, sp.bezier_points)):
        bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'; bp.radius = r0 + (r1 - r0) * i / max(1, len(pts) - 1)
    co = bpy.data.objects.new(name + '_curve', cd); bpy.context.collection.objects.link(co)
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(co.evaluated_get(dg))
    bpy.data.objects.remove(co); bpy.data.curves.remove(cd)
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    ensure_uv(o)
    return _finish(o, material)

def ensure_uv(o):
    if not o.data.uv_layers:
        o.data.uv_layers.new(name='UVMap')

def parent_keep(o, parent, bone=None):
    bpy.context.view_layer.update(); mw = o.matrix_world.copy()
    o.parent = parent
    if bone: o.parent_type = 'BONE'; o.parent_bone = bone
    bpy.context.view_layer.update(); o.matrix_world = mw

def export(path, objs, animations=False):
    for o in bpy.context.scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH': ensure_uv(o)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_cameras=False, export_lights=False,
              export_animations=animations, export_skins=True)
    if animations:
        kw.update(export_animation_mode='ACTIONS', export_force_sampling=True, export_anim_slide_to_zero=True)
    bpy.ops.export_scene.gltf(**kw)
    print(f'EXPORTED {path} ({os.path.getsize(path) // 1024} KB)')

def out_path(name):
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets'))
    return os.path.join(root, name)
