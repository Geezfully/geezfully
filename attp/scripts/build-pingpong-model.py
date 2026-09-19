"""Build the homepage's self-contained, 40 mm glTF ball (Python + Pillow).

Run from any directory: python3 scripts/build-pingpong-model.py
The source print is never downloaded by the website.
"""

import io
import json
import math
from pathlib import Path
import struct

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SEGMENTS, RINGS, RADIUS = 48, 32, 0.02

# A small mipmapped texture is sufficient for the homepage's ~100 px ball.
source = Image.open(ROOT / "models/source/dhs-rs40-print.png").convert("RGB")
texture = source.resize((512, 512), Image.Resampling.LANCZOS)
encoded_texture = io.BytesIO()
texture.save(encoded_texture, format="JPEG", quality=88, subsampling=0, optimize=True)

positions, normals, uvs, indices = [], [], [], []
half_segments = SEGMENTS // 2
for hemisphere in range(2):
    offset = len(positions) // 3
    for row in range(RINGS + 1):
        theta = math.pi * row / RINGS
        for col in range(half_segments + 1):
            phi = -math.pi / 2 + hemisphere * math.pi + math.pi * col / half_segments
            x = math.sin(theta) * math.sin(phi)
            y = math.cos(theta)
            z = math.sin(theta) * math.cos(phi)
            positions.extend((RADIUS * x, RADIUS * y, RADIUS * z))
            normals.extend((x, y, z))
            # Reuse the same print 180 degrees opposite the front. Reverse
            # local X on the back so its lettering reads correctly from outside.
            # Separate boundary vertices prevent interpolation between prints.
            print_x = x if hemisphere == 0 else -x
            uvs.extend((max(0, min(1, 0.5 + print_x / 1.3)),
                        max(0, min(1, 0.5 - y / 1.3))))

    for row in range(RINGS):
        for col in range(half_segments):
            a = offset + row * (half_segments + 1) + col
            b = a + half_segments + 1
            if row > 0:
                indices.extend((a, b, a + 1))
            if row < RINGS - 1:
                indices.extend((a + 1, b, b + 1))

binary = bytearray()
views = []


def add_buffer(data, target=None):
    binary.extend(b"\0" * (-len(binary) % 4))
    view = {"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)}
    if target:
        view["target"] = target
    views.append(view)
    binary.extend(data)
    return len(views) - 1


for values in (positions, normals, uvs):
    add_buffer(struct.pack(f"<{len(values)}f", *values), 34962)
add_buffer(struct.pack(f"<{len(indices)}H", *indices), 34963)
image_view = add_buffer(encoded_texture.getvalue())
vertex_count = len(positions) // 3
document = {
    "asset": {"version": "2.0", "generator": "ATTP lightweight ball builder"},
    "scene": 0,
    "scenes": [{"nodes": [0]}],
    "nodes": [{"mesh": 0, "name": "White DHS RS40+ ball"}],
    "meshes": [{"primitives": [{"attributes": {
        "POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
        "indices": 3, "material": 0}]}],
    "materials": [{
        "name": "White matte ABS with printed DHS RS40+ mark",
        "pbrMetallicRoughness": {
            "baseColorFactor": [1, 1, 1, 1],
            "baseColorTexture": {"index": 0},
            "metallicFactor": 0, "roughnessFactor": 0.92},
    }],
    "textures": [{"sampler": 0, "source": 0}],
    "images": [{"bufferView": image_view, "mimeType": "image/jpeg"}],
    "samplers": [{"magFilter": 9729, "minFilter": 9987,
                  "wrapS": 33071, "wrapT": 33071}],
    "accessors": [
        {"bufferView": 0, "componentType": 5126, "count": vertex_count,
         "type": "VEC3", "min": [-RADIUS] * 3, "max": [RADIUS] * 3},
        {"bufferView": 1, "componentType": 5126, "count": vertex_count,
         "type": "VEC3"},
        {"bufferView": 2, "componentType": 5126, "count": vertex_count,
         "type": "VEC2"},
        {"bufferView": 3, "componentType": 5123, "count": len(indices),
         "type": "SCALAR"}],
    "bufferViews": views,
    "buffers": [{"byteLength": len(binary)}],
}

# A small faceted sparkle and a tapered 48-degree trail share one mesh and
# one unlit vertex-color material. They need no images, lights, or bloom pass.
orbit_radius = 0.031
spark_positions, spark_colors = [], []


def triangle(a, b, c, color):
    for point in (a, b, c):
        spark_positions.extend(point)
        spark_colors.extend(color)


outline = []
for i in range(8):
    angle = i * math.pi / 4
    radius = 0.0042 if i % 2 == 0 else 0.0011
    outline.append((orbit_radius + radius * math.cos(angle),
                    radius * math.sin(angle), 0))
for i in range(8):
    a, b = outline[i], outline[(i + 1) % 8]
    triangle((orbit_radius, 0, 0.0012), a, b,
             (1, 0.48, 0.16) if i % 2 == 0 else (1, 0.20, 0.035))
    triangle((orbit_radius, 0, -0.0012), b, a,
             (1, 0.32, 0.07) if i % 2 == 0 else (1, 0.16, 0.025))

trail_steps, trail_sides = 16, 5
trail = []
for i in range(trail_steps + 1):
    fraction = i / trail_steps
    angle = -0.12 - fraction * 0.84
    width = 0.00065 * (1 - fraction) + 0.000015
    ring = []
    for j in range(trail_sides):
        side = 2 * math.pi * j / trail_sides
        radius = orbit_radius + width * math.cos(side)
        ring.append((radius * math.cos(angle), width * math.sin(side),
                     -radius * math.sin(angle)))
    trail.append(ring)
for i in range(trail_steps):
    for j in range(trail_sides):
        k = (j + 1) % trail_sides
        color = (1, 0.22 + 0.12 * (1 - i / trail_steps), 0.04)
        triangle(trail[i][j], trail[i + 1][j], trail[i][k], color)
        triangle(trail[i][k], trail[i + 1][j], trail[i + 1][k], color)


def float_accessor(values, kind, bounds=False, target=None):
    dimensions = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[kind]
    view = add_buffer(struct.pack(f"<{len(values)}f", *values), target)
    accessor = {"bufferView": view, "componentType": 5126,
                "count": len(values) // dimensions, "type": kind}
    if bounds:
        accessor["min"] = [min(values[i::dimensions]) for i in range(dimensions)]
        accessor["max"] = [max(values[i::dimensions]) for i in range(dimensions)]
    document["accessors"].append(accessor)
    return len(document["accessors"]) - 1


star_position = float_accessor(spark_positions, "VEC3", True, 34962)
star_color = float_accessor(spark_colors, "VEC3", target=34962)
document["extensionsUsed"] = ["KHR_materials_unlit"]
document["materials"].append({
    "name": "ATTP orange and amber sparkle", "doubleSided": True,
    "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                             "metallicFactor": 0, "roughnessFactor": 1},
    "extensions": {"KHR_materials_unlit": {}},
})
document["meshes"].append({"name": "Orbiting sparkle and short trail", "primitives": [{
    "attributes": {"POSITION": star_position, "COLOR_0": star_color}, "material": 1}]})
# Tilt the orbital plane about both X and Z; motion itself rotates about local Y.
x_tilt, z_tilt = math.radians(22) / 2, math.radians(34) / 2
tilt = [math.sin(x_tilt) * math.cos(z_tilt),
        math.sin(x_tilt) * math.sin(z_tilt),
        math.cos(x_tilt) * math.sin(z_tilt),
        math.cos(x_tilt) * math.cos(z_tilt)]
document["scenes"][0]["nodes"].append(1)
document["nodes"].extend([
    {"name": "Inclined orbit plane", "rotation": tilt, "children": [2]},
    {"name": "Eight-second orbit", "children": [3]},
    {"name": "Orange sparkle", "mesh": 1},
])
times = [float(i) for i in range(9)]
rotations = []
for i in range(9):
    half_angle = math.pi * i / 8
    rotations.extend((0, math.sin(half_angle), 0, math.cos(half_angle)))
time_accessor = float_accessor(times, "SCALAR", True)
rotation_accessor = float_accessor(rotations, "VEC4")
document["animations"] = [{"name": "Inclined sparkle orbit",
    "samplers": [{"input": time_accessor, "output": rotation_accessor,
                  "interpolation": "LINEAR"}],
    "channels": [{"sampler": 0, "target": {"node": 2, "path": "rotation"}}]}]
document["buffers"][0]["byteLength"] = len(binary)
metadata = json.dumps(document, separators=(",", ":")).encode()
metadata += b" " * (-len(metadata) % 4)
binary.extend(b"\0" * (-len(binary) % 4))
glb = (struct.pack("<III", 0x46546C67, 2, 28 + len(metadata) + len(binary))
       + struct.pack("<II", len(metadata), 0x4E4F534A) + metadata
       + struct.pack("<II", len(binary), 0x004E4942) + binary)
destination = ROOT / "models/pingpong.glb"
destination.write_bytes(glb)
print(f"{destination}: {len(glb):,} bytes, {vertex_count} vertices, "
      f"{len(indices) // 3} ball triangles + {len(spark_positions) // 9} sparkle triangles, "
      f"one 512px texture ({len(encoded_texture.getvalue()):,} bytes)")
