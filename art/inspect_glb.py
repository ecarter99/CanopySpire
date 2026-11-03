"""Print a summary of a .glb (nodes, meshes, materials, animations, size breakdown)."""
import json, struct, sys
for path in sys.argv[1:]:
    b = open(path, 'rb').read(); n = struct.unpack_from('<I', b, 12)[0]; j = json.loads(b[20:20 + n])
    acc = j.get('accessors', []); bv = j.get('bufferViews', [])
    verts = sum(acc[p['attributes']['POSITION']]['count'] for m in j.get('meshes', []) for p in m['primitives'])
    anim_bytes = sum(bv[acc[s['output']]['bufferView']]['byteLength'] + bv[acc[s['input']]['bufferView']]['byteLength'] for a in j.get('animations', []) for s in a['samplers'])
    print(f"{path}: {len(b)//1024} KB · nodes {len(j.get('nodes', []))} · meshes {len(j.get('meshes', []))} · verts {verts} · anim data {anim_bytes//1024} KB")
    print('  materials:', [m['name'] for m in j.get('materials', [])])
    print('  animations:', [a['name'] for a in j.get('animations', [])])
    print('  top nodes:', [j['nodes'][i]['name'] for i in j['scenes'][0]['nodes']][:12], '…' if len(j['scenes'][0]['nodes']) > 12 else '')
    print('  skins:', [len(s['joints']) for s in j.get('skins', [])])
