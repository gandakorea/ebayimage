from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageChops

from finalize_product_images import CANVAS_SIZE, make_watermark, normalize_background


def content_bbox(image: Image.Image, threshold: int = 246):
    rgb = image.convert("RGB")
    mask = Image.new("L", rgb.size, 0)
    pixels = mask.load()
    src = rgb.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            r, g, b = src[x, y]
            if min(r, g, b) < threshold:
                pixels[x, y] = 255
    return mask.getbbox()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--part-number", required=True)
    parser.add_argument("--start-index", required=True, type=int)
    parser.add_argument("--crop-top", required=True, type=int)
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    watermark = make_watermark()

    for offset, source in enumerate(args.inputs):
        image = normalize_background(Image.open(source).convert("RGB"))
        image = image.crop((0, args.crop_top, image.width, image.height))
        bbox = content_bbox(image)
        if bbox:
            image = image.crop(bbox)
        scale = min(900 / image.width, 820 / image.height)
        size = (round(image.width * scale), round(image.height * scale))
        image = image.resize(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), "white")
        position = ((CANVAS_SIZE - size[0]) // 2, (CANVAS_SIZE - size[1]) // 2)
        canvas.paste(image, position)
        composed = canvas.convert("RGBA")
        wm_pos = ((CANVAS_SIZE - watermark.width) // 2, (CANVAS_SIZE - watermark.height) // 2)
        composed.alpha_composite(watermark, wm_pos)
        index = args.start_index + offset
        destination = args.output_dir / f"{args.part_number}_{index}.png"
        composed.convert("RGB").save(destination, "PNG", optimize=True)
        print(destination.resolve())


if __name__ == "__main__":
    main()
