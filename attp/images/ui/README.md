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

## Hall-floor intro (redesign)

The intro now plays on the same hall floor as the pages (colour, grain and
`hall-floor.svg`), so lifting it changes nothing underneath. The court for the
drawn sport paints itself in (`.load-court--tt` table with net, `.load-court--bb`
centre circle), the animation stands on it, and the crest with "Garanția
integrității" rises beneath. Markup is identical on every page (`#loadScreen`);
timings are unchanged (1,650 ms, 400 ms with reduced motion).

`attp-pingpong-loader-floor.webp` is the original GIF with its navy background
keyed out: only pure navy and the navy→outline anti-aliasing are made
transparent (their alpha is the pixel's position along that line, colour set to
the outline), so the paddle's black rubber face stays solid. 71 frames × 30 ms,
cropped to 294 × 366. `attp-pingpong-loader-floor-still.png` is frame 0.
