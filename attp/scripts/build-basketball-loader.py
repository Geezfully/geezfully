#!/usr/bin/env python3
"""Key the supplied animated GIF into a small, transparent WebP loader.

Usage: python3 scripts/build-basketball-loader.py /path/to/source.gif
Requires Pillow (with animated WebP support) and NumPy. Retains source timing;
does not redraw, interpolate, or generate replacement animation frames.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageSequence


def cutout(frame):
    # Keep the complete spinning ball / hand, omit unused space at the sides.
    rgb = np.asarray(frame.convert("RGB").crop((80, 0, 620, 600)))
    colors, inverse = np.unique(rgb.reshape(-1, 3), axis=0, return_inverse=True)
    colors = colors.astype(np.float32)
    background = np.array([0, 160, 131], dtype=np.float32)
    # The illustration's flat inks let us unmix antialiased edge pixels from
    # teal, instead of leaving green fringes against the site's dark backdrop.
    inks = np.array([
        [230, 127, 37], [140, 98, 57], [255, 255, 255], [42, 30, 36],
        [239, 197, 24], [135, 72, 155], [114, 76, 44],
    ], dtype=np.float32)
    vectors = inks - background
    alpha = np.clip(((colors - background) @ vectors.T) /
                    np.sum(vectors * vectors, axis=1), 0, 1)
    fitted = background + alpha[..., None] * vectors
    errors = np.linalg.norm(fitted - colors[:, None, :], axis=2)
    best = errors.argmin(axis=1)
    rows = np.arange(len(colors))
    edge_alpha = alpha[rows, best]
    keyed = (errors[rows, best] < 14) & (edge_alpha < 0.98)
    rgba = np.column_stack((colors, np.full(len(colors), 255))).astype(np.uint8)
    rgba[keyed, :3] = inks[best[keyed]].astype(np.uint8)
    rgba[keyed, 3] = np.round(edge_alpha[keyed] * 255).astype(np.uint8)
    rgba[rgba[:, 3] < 5] = 0
    result = Image.fromarray(rgba[inverse].reshape(rgb.shape[0], rgb.shape[1], 4))
    return result.resize((360, 400), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[1] / "images" / "ui"
    with Image.open(args.source) as source:
        if source.size != (800, 600):
            raise ValueError("Expected the supplied 800 × 600 basketball GIF")
        frames, durations = [], []
        for frame in ImageSequence.Iterator(source):
            durations.append(frame.info.get("duration", 40))
            frames.append(cutout(frame))
    animated = destination / "attp-basketball-loader.webp"
    frames[0].save(destination / "attp-basketball-loader-still.webp",
                   quality=90, method=4)
    frames[0].save(animated, save_all=True, append_images=frames[1:],
                   duration=durations, loop=0, quality=72, method=4)
    print(f"{len(frames)} frames, {sum(durations)} ms, {animated.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
