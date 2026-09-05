from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps


CANVAS_SIZE = 1000
WATERMARK_TEXT = "KOREA AUTOPARTS"
WATERMARK_WIDTH = 264
FONT_PATH = Path(os.environ.get("KOREA_AUTOPARTS_FONT", r"C:\Windows\Fonts\NotoSans-BoldItalic.ttf"))


def make_watermark() -> Image.Image:
    font = ImageFont.truetype(str(FONT_PATH), 30)
    probe = Image.new("L", (600, 120), 0)
    probe_draw = ImageDraw.Draw(probe)
    box = probe_draw.textbbox((0, 0), WATERMARK_TEXT, font=font, stroke_width=1)
    width = box[2] - box[0] + 12
    height = box[3] - box[1] + 12

    shadow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    origin = (6 - box[0], 6 - box[1])
    shadow_draw.text(
        (origin[0] + 2, origin[1] + 2),
        WATERMARK_TEXT,
        font=font,
        fill=(70, 70, 70, 105),
        stroke_width=1,
        stroke_fill=(70, 70, 70, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(1.0))

    foreground = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    foreground_draw = ImageDraw.Draw(foreground)
    foreground_draw.text(
        origin,
        WATERMARK_TEXT,
        font=font,
        fill=(255, 255, 255, 165),
        stroke_width=1,
        stroke_fill=(95, 95, 95, 115),
    )

    watermark = Image.alpha_composite(shadow, foreground)
    alpha_box = watermark.getchannel("A").getbbox()
    if alpha_box:
        watermark = watermark.crop(alpha_box)

    target_height = round(watermark.height * WATERMARK_WIDTH / watermark.width)
    return watermark.resize((WATERMARK_WIDTH, target_height), Image.Resampling.LANCZOS)


def normalize_background(image: Image.Image) -> Image.Image:
    red, green, blue = image.split()
    red_mask = red.point(lambda value: 255 if value >= 247 else 0)
    green_mask = green.point(lambda value: 255 if value >= 247 else 0)
    blue_mask = blue.point(lambda value: 255 if value >= 247 else 0)
    white_mask = ImageChops.multiply(ImageChops.multiply(red_mask, green_mask), blue_mask)
    return Image.composite(Image.new("RGB", image.size, "white"), image, white_mask)


def finalize(
    source: Path,
    destination: Path,
    watermark: Image.Image,
    content_scale: float = 1.0,
    content_offset_x: int = 0,
    content_offset_y: int = 0,
    watermark_center_y: int = CANVAS_SIZE // 2,
    label_source: Path | None = None,
    label_crop: tuple[int, int, int, int] | None = None,
    label_width: int = 350,
    label_top: int = 20,
    label_clear_height: int = 0,
) -> None:
    image = Image.open(source).convert("RGB")
    image = ImageOps.fit(
        image,
        (CANVAS_SIZE, CANVAS_SIZE),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    image = normalize_background(image)

    if content_scale != 1.0 or content_offset_x or content_offset_y:
        scaled_size = round(CANVAS_SIZE * content_scale)
        scaled = image.resize((scaled_size, scaled_size), Image.Resampling.LANCZOS)
        centered = Image.new("RGB", (CANVAS_SIZE, CANVAS_SIZE), "white")
        offset = (
            (CANVAS_SIZE - scaled_size) // 2 + content_offset_x,
            (CANVAS_SIZE - scaled_size) // 2 + content_offset_y,
        )
        centered.paste(scaled, offset)
        image = centered

    if label_source and label_crop:
        if label_clear_height:
            ImageDraw.Draw(image).rectangle(
                (0, 0, CANVAS_SIZE, label_clear_height), fill="white"
            )
        label = Image.open(label_source).convert("RGB").crop(label_crop)
        label = normalize_background(label)
        label_height = round(label.height * label_width / label.width)
        label = label.resize((label_width, label_height), Image.Resampling.LANCZOS)
        image.paste(label, ((CANVAS_SIZE - label_width) // 2, label_top))

    composed = image.convert("RGBA")
    position = (
        (CANVAS_SIZE - watermark.width) // 2,
        round(watermark_center_y - watermark.height / 2),
    )
    composed.alpha_composite(watermark, position)
    composed.convert("RGB").save(destination, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--part-number", required=True)
    parser.add_argument("--start-index", type=int, default=0)
    parser.add_argument("--content-scale", action="append", type=float)
    parser.add_argument("--content-offset-x", action="append", type=int)
    parser.add_argument("--content-offset-y", action="append", type=int)
    parser.add_argument("--watermark-center-y", action="append", type=int)
    parser.add_argument("--label-source", type=Path)
    parser.add_argument("--label-crop")
    parser.add_argument("--label-width", type=int, default=350)
    parser.add_argument("--label-top", type=int, default=20)
    parser.add_argument("--label-clear-height", type=int, default=0)
    parser.add_argument("inputs", nargs="+", type=Path)
    args = parser.parse_args()

    scales = args.content_scale or [1.0] * len(args.inputs)
    if len(scales) != len(args.inputs):
        parser.error("--content-scale must be repeated once for each input")
    if any(scale <= 0 or scale > 1 for scale in scales):
        parser.error("content scales must be greater than 0 and no more than 1")

    content_offsets_x = args.content_offset_x or [0] * len(args.inputs)
    content_offsets_y = args.content_offset_y or [0] * len(args.inputs)
    if len(content_offsets_x) != len(args.inputs):
        parser.error("--content-offset-x must be repeated once for each input")
    if len(content_offsets_y) != len(args.inputs):
        parser.error("--content-offset-y must be repeated once for each input")

    watermark_centers = args.watermark_center_y or [CANVAS_SIZE // 2] * len(
        args.inputs
    )
    if len(watermark_centers) != len(args.inputs):
        parser.error("--watermark-center-y must be repeated once for each input")
    if any(center < 0 or center > CANVAS_SIZE for center in watermark_centers):
        parser.error("watermark centers must stay within the canvas")

    label_crop = None
    if args.label_crop:
        try:
            label_crop = tuple(int(value) for value in args.label_crop.split(","))
        except ValueError:
            parser.error("--label-crop must contain four comma-separated integers")
        if len(label_crop) != 4:
            parser.error("--label-crop must contain four comma-separated integers")
    if bool(args.label_source) != bool(label_crop):
        parser.error("--label-source and --label-crop must be used together")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    watermark = make_watermark()

    for index, (
        source,
        content_scale,
        content_offset_x,
        content_offset_y,
        watermark_center_y,
    ) in enumerate(
        zip(
            args.inputs,
            scales,
            content_offsets_x,
            content_offsets_y,
            watermark_centers,
        )
    ):
        file_index = args.start_index + index
        suffix = "" if file_index == 0 else f"_{file_index}"
        destination = args.output_dir / f"{args.part_number}{suffix}.png"
        finalize(
            source,
            destination,
            watermark,
            content_scale,
            content_offset_x,
            content_offset_y,
            watermark_center_y,
            args.label_source if index == 0 else None,
            label_crop if index == 0 else None,
            args.label_width,
            args.label_top,
            args.label_clear_height,
        )
        print(destination.resolve())


if __name__ == "__main__":
    main()
