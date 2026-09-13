from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


def extract_largest_product(image: Image.Image, erase_rects: list[tuple[int, int, int, int]]) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"))
    distance = 255 - rgb.min(axis=2)
    mask = (distance > 18).astype(np.uint8) * 255
    for x1, y1, x2, y2 in erase_rects:
        mask[y1:y2, x1:x2] = 0
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count < 2:
        raise RuntimeError("Product component was not found")
    component = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    selected = (labels == component).astype(np.uint8) * 255
    selected = cv2.dilate(selected, np.ones((3, 3), np.uint8), iterations=1)
    x, y, w, h, _ = stats[component]
    rgba = np.dstack([rgb, selected])
    return Image.fromarray(rgba, "RGBA").crop((max(0, x - 2), max(0, y - 2), min(image.width, x + w + 2), min(image.height, y + h + 2)))


def fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(max_width / image.width, max_height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def make_main(source: Path, destination: Path, label_box: tuple[int, int, int, int], product_erase: list[tuple[int, int, int, int]], product_area: tuple[int, int, int, int], label_clear: list[tuple[int, int, int, int]] | None = None) -> int:
    image = Image.open(source).convert("RGB")
    canvas = Image.new("RGB", (1000, 1000), "white")
    label = image.crop(label_box)
    if label_clear:
        label_pixels = np.asarray(label).copy()
        for x1, y1, x2, y2 in label_clear:
            label_pixels[y1:y2, x1:x2] = 255
        label = Image.fromarray(label_pixels, "RGB")
    label = fit(label, 350, 350)
    canvas.paste(label, ((1000 - label.width) // 2, 20))
    product = extract_largest_product(image, product_erase)
    left, top, right, bottom = product_area
    product = fit(product, right - left, bottom - top)
    x = left + ((right - left) - product.width) // 2
    y = top + ((bottom - top) - product.height) // 2
    canvas.paste(product, (x, y), product)
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination)
    return y + product.height // 2


def make_product_only(source: Path, destination: Path) -> int:
    image = Image.open(source).convert("RGB")
    product = extract_largest_product(image, [])
    product = fit(product, 880, 880)
    canvas = Image.new("RGB", (1000, 1000), "white")
    x = (1000 - product.width) // 2
    y = (1000 - product.height) // 2
    canvas.paste(product, (x, y), product)
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination)
    return y + product.height // 2


def rebuild(part: str, label_box: tuple[int, int, int, int], erase: list[tuple[int, int, int, int]], product_area: tuple[int, int, int, int], label_clear: list[tuple[int, int, int, int]] | None = None) -> None:
    clean = ROOT / "작업중" / part / "clean"
    base = ROOT / "작업중" / part / "rule-corrected-base"
    centers = [make_main(clean / "clean-01.png", base / "base-01.png", label_box, erase, product_area, label_clear)]
    for index in range(2, 5):
        centers.append(make_product_only(clean / f"clean-{index:02d}.png", base / f"base-{index:02d}.png"))
    (base / "watermark-centers.txt").write_text("\n".join(map(str, centers)), encoding="utf-8")


rebuild(
    "31010-3X000",
    label_box=(160, 15, 740, 580),
    erase=[(270, 0, 565, 220), (150, 215, 750, 590)],
    product_area=(60, 385, 940, 970),
    label_clear=[(500, 0, 580, 210)],
)
rebuild(
    "26510-26600",
    label_box=(745, 35, 1170, 305),
    erase=[(730, 20, 1185, 320)],
    product_area=(75, 275, 925, 970),
)
