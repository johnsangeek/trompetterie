import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / "AppData/Local/Temp/codex-bpy-runtime"))

import bpy
from mathutils import Vector


body_source = Path(sys.argv[1]).resolve()
pistons_source = Path(sys.argv[2]).resolve()
target = Path(sys.argv[3]).resolve()
target.parent.mkdir(parents=True, exist_ok=True)


def make_principled_material(name, color, metallic, roughness):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return material


def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before]


def object_center_x(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (min(corner.x for corner in corners) + max(corner.x for corner in corners)) / 2


bpy.ops.wm.read_factory_settings(use_empty=True)

brass = make_principled_material("Satin Brass", (0.56, 0.24, 0.055, 1.0), 0.92, 0.24)
body_objects = import_gltf(body_source)
for index, obj in enumerate(body_objects):
    obj.name = f"TrumpetBody_{index:02d}"
    if obj.type == "MESH":
        obj.data.materials.clear()
        obj.data.materials.append(brass)

piston_objects = [obj for obj in import_gltf(pistons_source) if obj.type == "MESH"]

# The exporter kept repeated components together. Split every disconnected
# component so each physical piston can be grouped and animated independently.
for obj in list(piston_objects):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

piston_parts = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj not in body_objects]
valve_centers = (-1.016, -0.612, -0.208)
valve_colors = (
    (0.93, 0.18, 0.14, 1.0),
    (0.08, 0.70, 0.65, 1.0),
    (1.0, 0.55, 0.05, 1.0),
)

groups = []
for index, color in enumerate(valve_colors, start=1):
    group = bpy.data.objects.new(f"Piston_{index}", None)
    bpy.context.scene.collection.objects.link(group)
    group["animation_axis"] = "written_note_valve"
    groups.append(group)

materials = [
    make_principled_material(f"Piston {index}", color, 0.68, 0.22)
    for index, color in enumerate(valve_colors, start=1)
]

counts = [0, 0, 0]
for part in piston_parts:
    center_x = object_center_x(part)
    valve_index = min(range(3), key=lambda idx: abs(center_x - valve_centers[idx]))
    world_matrix = part.matrix_world.copy()
    part.parent = groups[valve_index]
    part.matrix_world = world_matrix
    part.name = f"Piston_{valve_index + 1}_Part_{counts[valve_index]:02d}"
    part.data.materials.clear()
    part.data.materials.append(materials[valve_index])
    counts[valve_index] += 1

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=str(target),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_materials="EXPORT",
)

print(f"Piston parts: {counts}")
print(target)
