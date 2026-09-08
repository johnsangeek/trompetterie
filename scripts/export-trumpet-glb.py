import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / "AppData/Local/Temp/codex-bpy-runtime"))

import bpy


source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(source))

# Give the original model one warm, physically based brass finish so it stays
# coherent under the site's own studio lighting without external textures.
brass = bpy.data.materials.new("Satin Brass")
brass.diffuse_color = (0.56, 0.24, 0.055, 1.0)
brass.metallic = 0.92
brass.roughness = 0.24

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    obj.data.materials.clear()
    obj.data.materials.append(brass)

# The source model combines repeated valve details into shared meshes, so its
# three buttons cannot be moved separately as-is. Add a slim animated sleeve
# over each visible piston. The three named parents are the stable animation
# handles used by trumpet-3d.js.
valve_materials = []
for index, color in enumerate(((0.93, 0.18, 0.14, 1), (0.08, 0.70, 0.65, 1), (1.0, 0.55, 0.05, 1)), start=1):
    material = bpy.data.materials.new(f"Valve {index}")
    material.diffuse_color = color
    material.metallic = 0.68
    material.roughness = 0.22
    valve_materials.append(material)

for index, x in enumerate((-1.016, -0.612, -0.208), start=1):
    parent = bpy.data.objects.new(f"AnimatedValve{index}", None)
    bpy.context.scene.collection.objects.link(parent)

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.105, depth=0.61, location=(x, -0.17, 0.805))
    stem = bpy.context.object
    stem.name = f"AnimatedValve{index}_Stem"
    stem.data.materials.append(valve_materials[index - 1])
    stem.parent = parent

    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.16, depth=0.075, location=(x, -0.17, 1.145))
    cap = bpy.context.object
    cap.name = f"AnimatedValve{index}_Cap"
    cap.data.materials.append(valve_materials[index - 1])
    cap.parent = parent

for obj in bpy.data.objects:
    obj.select_set(obj.type in {"MESH", "EMPTY"})

bpy.ops.export_scene.gltf(
    filepath=str(target),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_materials="EXPORT",
)

print(target)
