"""Finalize the 2026-09-19 batch with exact photographed label pixels."""
from pathlib import Path
from PIL import Image, ImageOps
import numpy as np

from finalize_product_images import make_watermark, normalize_background

ROOT = Path(__file__).resolve().parent.parent
GEN = Path(r"C:\Users\USER\.codex\generated_images\01a074b1-de74-7c30-8286-38fe98fc29ef")
WM = make_watermark()

SETS = {
    "86190-C5000": {
        "ref": "334780050144",
        "paths": [
            "exec-63ea9ff7-8a06-43d5-ba27-666f975a1b78.png",
            "exec-3306dcc2-b726-4a12-8fbb-afaa172edc83.png",
            "exec-34443de7-1ea0-4ee6-85aa-4df2f318ee48.png",
        ],
        "label_source": 2,
        "label_box": (585, 25, 1590, 490),
        "label_dest": (462, 24, 1240, 384),
    },
    "86350-2K050": {
        "ref": "333917745547",
        "paths": [
            "exec-7e59c648-ba46-4ba3-89d8-c76821c94ed2.png",
            "exec-6ec70481-6e66-411a-afda-9417966dbd90.png",
            "exec-0df0cb9d-3ac1-4ca3-a5c2-af76a62d4039.png",
            "exec-c0182410-a375-450d-94ec-41d64c457d7a.png",
        ],
        "label_source": 7,
        "label_box": (420, 740, 1220, 1370),
        "separate_label": True,
    },
    "86350-2P000": {
        "ref": "233491678184",
        "paths": [
            "exec-e6daa493-c109-42c3-acb6-66777bdb53c4.png",
            "exec-8edefb54-19a7-4384-b695-abf071d19f8d.png",
            "exec-f5aefc87-043a-4121-8631-5dc3ee941576.png",
            "exec-f9b7d400-0e29-4e0d-b320-8ba456e153f5.png",
        ],
        "label_source": 1,
        "label_box": (805, 75, 1488, 495),
        "label_dest": (620, 104, 1155, 430),
    },
    "86350-S1000": {
        "ref": "334083938058",
        "paths": [
            "exec-1b84abe3-6449-497b-a430-2a87610e7129.png",
            "exec-db3b8610-e37b-47d9-b5f7-7c09ee32625f.png",
            "exec-14b91bc4-29bf-4dbb-8eac-3185a202889a.png",
            "exec-4261290e-b137-429b-88bf-a209e0425b4e.png",
        ],
        "label_source": 3,
        "label_box": (0, 0, 885, 525),
        "label_dest": (35, 48, 720, 405),
    },
}


def original(ref: str, number: int) -> Image.Image:
    return Image.open(ROOT / "작업중" / f"ebay-{ref}" / "originals" / f"source_{number:02}.jpg").convert("RGB")


def replace_label(img: Image.Image, crop: Image.Image, dest) -> Image.Image:
    out = img.copy()
    x1, y1, x2, y2 = dest
    crop = crop.resize((x2 - x1, y2 - y1), Image.Resampling.LANCZOS)
    out.paste(crop, (x1, y1))
    return out


def tight(img: Image.Image) -> Image.Image:
    arr = np.asarray(img.convert("RGB"))
    ys, xs = np.where(arr.min(axis=2) < 238)
    if not len(xs):
        return img
    return img.crop((max(0, int(xs.min()) - 8), max(0, int(ys.min()) - 8), min(img.width, int(xs.max()) + 9), min(img.height, int(ys.max()) + 9)))


def save(img: Image.Image, path: Path) -> None:
    img = tight(normalize_background(img.convert("RGB")))
    img = ImageOps.contain(img, (940, 920), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1000, 1000), "white")
    pos = ((1000 - img.width) // 2, (950 - img.height) // 2)
    canvas.paste(img, pos)
    canvas = canvas.convert("RGBA")
    canvas.alpha_composite(WM, ((1000 - WM.width) // 2, pos[1] + img.height // 2 - WM.height // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(path, optimize=True)


def save_with_label(img: Image.Image, label: Image.Image, path: Path) -> None:
    img = tight(normalize_background(img.convert("RGB")))
    label = tight(label.convert("RGB"))
    label = ImageOps.contain(label, (500, 300), Image.Resampling.LANCZOS)
    img = ImageOps.contain(img, (940, 610), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1000, 1000), "white")
    label_pos = ((1000 - label.width) // 2, 30)
    product_pos = ((1000 - img.width) // 2, 350 + (600 - img.height) // 2)
    canvas.paste(label, label_pos)
    canvas.paste(img, product_pos)
    canvas = canvas.convert("RGBA")
    canvas.alpha_composite(WM, ((1000 - WM.width) // 2, product_pos[1] + img.height // 2 - WM.height // 2))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(path, optimize=True)


for part, spec in SETS.items():
    label_src = original(spec["ref"], spec["label_source"])
    label = label_src.crop(spec["label_box"])
    out = ROOT / "완성본" / part
    out.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(spec["paths"]):
        img = Image.open(GEN / name).convert("RGB")
        if index == 0 and spec.get("separate_label"):
            filename = part + ".png"
            save_with_label(img, label, out / filename)
            print(out / filename)
            continue
        if index == 0:
            img = replace_label(img, label, spec["label_dest"])
        filename = part + ("" if index == 0 else f"_{index}") + ".png"
        save(img, out / filename)
        print(out / filename)
