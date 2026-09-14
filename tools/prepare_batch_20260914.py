from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def contain(image: Image.Image, size=(1000, 1000)) -> Image.Image:
    result = Image.new("RGB", size, "white")
    copy = image.convert("RGB")
    copy.thumbnail((size[0] - 40, size[1] - 40), Image.Resampling.LANCZOS)
    result.paste(copy, ((size[0] - copy.width) // 2, (size[1] - copy.height) // 2))
    return result


def components(image: Image.Image, erase=(), keep=1) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    mask = ((255 - rgb.min(axis=2)) > 18).astype(np.uint8) * 255
    for x1, y1, x2, y2 in erase:
        mask[y1:y2, x1:x2] = 0
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    choices = sorted(range(1, count), key=lambda n: stats[n, cv2.CC_STAT_AREA], reverse=True)[:keep]
    selected = np.isin(labels, choices).astype(np.uint8) * 255
    selected = cv2.dilate(selected, np.ones((3, 3), np.uint8), iterations=1)
    ys, xs = np.where(selected > 0)
    x1, x2, y1, y2 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return Image.fromarray(np.dstack((rgb, selected)), "RGBA").crop((x1, y1, x2, y2))


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / image.width, height / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def paste_center(canvas: Image.Image, image: Image.Image, box: tuple[int, int, int, int]) -> None:
    x1, y1, x2, y2 = box
    item = fit(image, x2 - x1, y2 - y1)
    pos = (x1 + (x2 - x1 - item.width) // 2, y1 + (y2 - y1 - item.height) // 2)
    canvas.paste(item, pos, item if item.mode == "RGBA" else None)


def compose_37460() -> Image.Image:
    source = Image.open(ROOT / "작업중/37460-2B006/clean/clean-01.png").convert("RGB")
    label = source.crop((145, 130, 570, 395))
    products = components(source, erase=((120, 110, 590, 420),), keep=2)
    canvas = Image.new("RGB", (1000, 1000), "white")
    paste_center(canvas, label, (325, 20, 675, 260))
    paste_center(canvas, products, (50, 285, 950, 970))
    return canvas


def compose_pair() -> Image.Image:
    left_main = Image.open(ROOT / "작업중/55270-2T000/clean/clean-01.png").convert("RGB")
    right_main = Image.open(ROOT / "작업중/55280-2T000/clean/clean-01.png").convert("RGB")
    pair = Image.open(ROOT / "작업중/55270-2T000_55280-2T000/clean/clean-01.png").convert("RGB")
    left_label = left_main.crop((410, 190, 845, 450))
    right_label = right_main.crop((385, 140, 840, 465))
    products = components(pair, keep=2)
    canvas = Image.new("RGB", (1000, 1000), "white")
    paste_center(canvas, left_label, (180, 20, 480, 245))
    paste_center(canvas, right_label, (520, 20, 820, 245))
    paste_center(canvas, products, (50, 270, 950, 970))
    return canvas


parts = {
    "54612-C1000": 3,
    "55280-2T000": 7,
    "55270-2T000": 2,
    "37460-2B006": 4,
    "87721-B8500GAL": 6,
}
for part, count in parts.items():
    base = ROOT / "작업중" / part / "base"
    base.mkdir(parents=True, exist_ok=True)
    for index in range(1, count + 1):
        source = Image.open(ROOT / "작업중" / part / "clean" / f"clean-{index:02d}.png")
        image = compose_37460() if part == "37460-2B006" and index == 1 else contain(source)
        image.save(base / f"base-{index:02d}.png")

pair_part = "55270-2T000_55280-2T000"
pair_base = ROOT / "작업중" / pair_part / "base"
pair_base.mkdir(parents=True, exist_ok=True)
compose_pair().save(pair_base / "base-01.png")
