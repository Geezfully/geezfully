# Basketball model — local draft

Open `models/preview.html` through the local server to compare the new basketball
with the table-tennis model. The production pages have not been changed by this
draft. Nothing has been pushed or deployed.

`basketball.glb` is a single self-contained asset (219,940 bytes / ~215 KiB), with
one 768 × 384 embedded JPEG. The sphere has 2,665 vertices and 4,992 triangles.
The existing 176-triangle star/trail and eight-second inclined orbit are reused,
with cyan/ice-blue vertex colors. No new frontend dependency, environment image,
texture request, normal map, or decoder is needed.

The basketball is a visual recreation from the supplied Wilson FIBA 3×3 reference:
yellow and purple pebbled panels, orange seams, cyan court markings, and black
branding on opposite sides. It is not a manufacturer CAD asset. Panel/grip detail
is represented by the color texture; the mesh stays spherical. Like the existing
ball it is normalized to a 0.02 m presentation radius for consistent framing,
not a real basketball's physical dimensions.

## Rebuild

```sh
python3 scripts/build-basketball-model.py
```

Requires Python and Pillow. The builder reads `models/pingpong.glb` to reuse its
orbit and star, but writes only `models/basketball.glb`. The source image in
`models/source/wilson-3x3-albedo.png` is authoring input and is never fetched by
the preview. It was generated using the built-in image-generation tool from the
user's September 28 basketball reference. The complete prompt is saved alongside
it in `models/source/wilson-3x3-prompt.txt`.

The local preview has drag/keyboard camera controls, pause/resume, reset view,
static loading/error fallback, and pauses both animations when offscreen or
hidden. Reduced-motion preferences override autoplay and are followed live.
This follows the Bun Partener reference's pattern of stopping decorative animation
when its containing view is inactive, while preserving a static representation.
