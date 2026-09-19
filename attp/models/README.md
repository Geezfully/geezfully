# Homepage ball

`pingpong.glb` is a self-contained 40 mm DHS RS40+ ball with an orange orbiting
sparkle: two meshes, two materials, and one embedded 512 × 512 print texture.
No normal map, duplicate surfaces, external textures, or decoder are required.

The previous model used its yellow logo image as both color and normal data and
instanced the same sphere twice in exactly the same place. Its replacement has
analytic radial normals, white material, and the same print on opposite sides,
180 degrees apart. Both sides reuse the embedded texture, with outward-readable
lettering and no additional texture. The homepage uses model-viewer's built-in
neutral environment, no floor shadow, and no CSS drop shadow. Both animations stop offscreen, in hidden tabs, and
when reduced motion is requested (including changes while the page is open).

The four-point sparkle and its short tapered trail are actual geometry, replacing
the old CSS background rings. A glTF animation makes one orbit every eight seconds
on a plane tilted 22° about X and 34° about Z. The sparkle uses unlit vertex colors
(`KHR_materials_unlit`) for orange/amber facets, so it needs no new texture, light,
postprocessing, or runtime library. The ball's 10°/second turntable rotation is
independent of this orbit. Fixed camera framing keeps the ball centered and leaves
room for the whole orbit on desktop and mobile.

Following the read-only Bun Partener reference's animation lifecycle pattern,
the decorative enhancement keeps a static fallback and runs motion only while
needed. Existing page layout and Romanian accessibility text are retained.

## Rebuild

With Python 3 and Pillow installed:

```sh
python3 scripts/build-pingpong-model.py
```

Output: 133,104 bytes (original: 173,980 bytes). The ball has 1,650 vertices and
2,976 triangles; the sparkle/trail adds 176 triangles and about 14 KB, including
the animation. Both sides of the ball still share one texture.
`source/dhs-rs40-print.png` is authoring input only; it is not loaded by the site.
The build downsamples and compresses the generated artwork before embedding it.
Update the model URL's cache version in `index.html` after rebuilding.

## Artwork provenance

The print was recreated with the built-in image-generation tool using the user's
DHS RS40+ product photo as the reference. It includes ITTF APPROVED, three black
stars, the Chinese brand mark, red DHS, black RS40+, and red MADE IN CHINA.

Generation prompt:

> Use case: background-extraction / logo-brand. Create a clean, FLAT print/decal
> texture for a 3D ping pong ball from this reference photo. Output a square
> 1024x1024 image with a perfectly uniform PURE WHITE #FFFFFF background.
> Reproduce ONLY the printed logo/lettering from the reference as sharp flat red
> and black artwork, occupying the central 75% of the square, with plenty of pure
> white padding. NO BALL, no sphere, no photography, no lighting, no shadows, no
> surface shading, no grain, no bevels. Preserve the design and typography of the
> reference: red arched 'ITTF APPROVED' at top, exactly THREE solid BLACK
> five-point stars beneath that, black stylized Chinese DHS mark '红双喜' with
> the swoosh to the left and red registered trademark at its upper right; bold
> italic RED 'DHS' below; BLACK 'RS40+' under DHS; RED gently arched 'MADE IN
> CHINA' at bottom. Text must be exact: ITTF APPROVED / DHS / RS40+ / MADE IN
> CHINA. Straight-on, symmetrical, clean authentic mark. The entire background
> must be pure white with NO warm or yellow tint. This is a flat albedo print
> texture asset, not a rendering of a ball.
