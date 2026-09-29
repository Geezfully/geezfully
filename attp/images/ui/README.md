# Shared page loaders

The before-paint gate in `js/load-screen-gate.js` always shows an intro on a
direct site entry. Internal HTML navigation has a 10% chance of showing one.
A separate random draw selects ping pong or basketball with equal probability.
Language switches use the same rule. These are independent draws, not forced
alternation between sports.

CSS selects only one animation, with a static alternative for
`prefers-reduced-motion: reduce`. Skipped intros request neither asset.
The existing dismissal timings remain 1,650 ms normally and 400 ms with reduced
motion; hidden-tab handling and scroll-lock cleanup are shared by both sports.

## Basketball

The transparent basketball WebP is derived from the user-supplied 800 × 600 GIF.
It retains all 72 frames at 40 ms each (2.88-second loop), at 360 × 400 output.
The flat teal background is keyed out, edge colors are decontaminated, and
unused side space is cropped. No generated replacement frames are used.
The animated asset is approximately 812 KiB; its still alternative is 15 KiB.
Only the delivery assets are needed on the site, with no new runtime library.

To rebuild with Pillow and NumPy installed:

```sh
python3 scripts/build-basketball-loader.py /path/to/original.gif
```

Run the dependency-free probability and navigation checks with:

```sh
node scripts/test-load-screen.cjs
```
