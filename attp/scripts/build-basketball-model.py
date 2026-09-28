"""Build the basketball variant without modifying the table-tennis model.

Run: python3 scripts/build-basketball-model.py (requires Pillow).
Reuses the existing lightweight sparkle mesh and inclined orbit animation.
The sphere is normalized to the same presentation scale as pingpong.glb.
"""

import io
import json
import math
from pathlib import Path
import struct

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
original = (ROOT / "models/pingpong.glb").read_bytes()
json_size = struct.unpack_from("<I", original, 12)[0]
document = json.loads(original[20:20 + json_size])
original_binary = original[28 + json_size:]
payloads = [original_binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
            for v in document["bufferViews"]]

segments, rings, radius = 64, 40, 0.02
positions, normals, uvs, indices = [], [], [], []
for row in range(rings + 1):
    v = row / rings
    theta = math.pi * v
    for col in range(segments + 1):
        u = col / segments
        # The artwork's two logos at U=.25/.75 face forward/backward.
        phi = 2 * math.pi * u - math.pi / 2
        x = math.sin(theta) * math.sin(phi)
        y = math.cos(theta)
        z = math.sin(theta) * math.cos(phi)
        positions.extend((radius * x, radius * y, radius * z))
        normals.extend((x, y, z))
        # Join at the centers of the edge channels, avoiding a doubled seam.
        # Compress the yellow band in latitude so the purple caps remain
        # visible in perspective, matching the photographed panel proportions.
        uvs.extend((0.014 + 0.972 * u, max(0, min(1, 0.5 + (v - 0.5) * 1.35))))
for row in range(rings):
    for col in range(segments):
        a = row * (segments + 1) + col
        b = a + segments + 1
        if row > 0:
            indices.extend((a, b, a + 1))
        if row < rings - 1:
            indices.extend((a + 1, b, b + 1))

primitive = document["meshes"][0]["primitives"][0]
for semantic, values, kind, components in (
        ("POSITION", positions, "f", 3), ("NORMAL", normals, "f", 3),
        ("TEXCOORD_0", uvs, "f", 2), ("indices", indices, "H", 1)):
    index = primitive["indices"] if semantic == "indices" else primitive["attributes"][semantic]
    accessor = document["accessors"][index]
    payloads[accessor["bufferView"]] = struct.pack(f"<{len(values)}{kind}", *values)
    accessor["count"] = len(values) // components

source = Image.open(ROOT / "models/source/wilson-3x3-albedo.png").convert("RGB")
texture = source.resize((768, 384), Image.Resampling.LANCZOS)
encoded = io.BytesIO()
texture.save(encoded, format="JPEG", quality=80, subsampling=2, optimize=True)
payloads[document["images"][0]["bufferView"]] = encoded.getvalue()
document["samplers"][0]["wrapS"] = 10497  # Repeat longitude, clamp the poles.
document["nodes"][0]["name"] = "Wilson-style yellow and purple 3x3 basketball"
document["nodes"][0]["rotation"] = [0, 0, math.sin(math.radians(-12) / 2), math.cos(math.radians(-12) / 2)]
document["materials"][0]["name"] = "Matte yellow and purple pebbled basketball"
document["materials"][0]["pbrMetallicRoughness"]["roughnessFactor"] = 0.9

# Vertex colors are linear RGB. Preserve the existing faceting but shift its
# warm palette to saturated cyan with pale ice highlights against the ball.
color_index = document["meshes"][1]["primitives"][0]["attributes"]["COLOR_0"]
color_view = document["accessors"][color_index]["bufferView"]
colors = list(struct.unpack(f"<{len(payloads[color_view]) // 4}f", payloads[color_view]))
for i in range(0, len(colors), 3):
    highlight = max(0, min(1, (colors[i + 1] - 0.16) / 0.32))
    colors[i:i + 3] = (0.015 + 0.23 * highlight, 0.48 + 0.43 * highlight, 0.85 + 0.15 * highlight)
payloads[color_view] = struct.pack(f"<{len(colors)}f", *colors)
document["materials"][1]["name"] = "Cyan and ice-blue orbit sparkle"
document["nodes"][3]["name"] = "Cyan sparkle"
document["asset"]["generator"] = "ATTP basketball variant builder"

binary = bytearray()
for view, payload in zip(document["bufferViews"], payloads):
    binary.extend(b"\0" * (-len(binary) % 4))
    view["byteOffset"], view["byteLength"] = len(binary), len(payload)
    binary.extend(payload)
document["buffers"][0]["byteLength"] = len(binary)
metadata = json.dumps(document, separators=(",", ":")).encode()
metadata += b" " * (-len(metadata) % 4)
binary.extend(b"\0" * (-len(binary) % 4))
glb = (struct.pack("<III", 0x46546C67, 2, 28 + len(metadata) + len(binary))
       + struct.pack("<II", len(metadata), 0x4E4F534A) + metadata
       + struct.pack("<II", len(binary), 0x004E4942) + binary)
destination = ROOT / "models/basketball.glb"
destination.write_bytes(glb)
print(f"{destination}: {len(glb):,} bytes; {len(positions) // 3:,} sphere vertices; "
      f"{len(indices) // 3:,} sphere triangles; texture {len(encoded.getvalue()):,} bytes")
