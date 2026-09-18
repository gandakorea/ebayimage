"""Finalize the two extra Sep-18 items with original photographed labels."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps, ImageDraw
from finalize_product_images import make_watermark, normalize_background

ROOT = Path(__file__).resolve().parent.parent
GEN = Path(r"C:\Users\USER\.codex\generated_images\01a074b1-de74-7c30-8286-38fe98fc29ef")
WM = make_watermark()

MOTOR = [
    "exec-f9538bb0-d410-4c8e-9c17-e9798e6cd3a4.png",
    "exec-330c72d6-4d49-434f-b552-4da28c0e87ab.png",
    "exec-e9eaccd2-b599-4dcd-a233-0f6e283f9b1c.png",
    "exec-c308bea0-69d8-4db6-bf7c-d4b44d3ba2c4.png",
    "exec-93bee856-053a-4dc5-927a-cf261068eac8.png",
    "exec-477cf0f0-aad1-429b-8856-7a71aa2ddccf.png",
    "exec-d24109b9-a11b-46d0-8fd4-59d5c2f65f0f.png",
]
FENDER = [
    "exec-6188fab1-2c57-47e8-b0c2-ece6e2dfc978.png",
    "exec-aa6e375a-c8bf-41a8-ba28-a5c0e3e7b49e.png",
    "exec-9e539aad-ffc3-4d5a-bb51-1d18cf816ea8.png",
    "exec-ab74336f-0b9f-43dc-a05a-71586e55639f.png",
]

def original(ref, n):
    return Image.open(ROOT / "작업중" / f"ebay-{ref}" / "originals" / f"source_{n:02}.jpg").convert("RGB")

def polygon_crop(img, points):
    mask = Image.new("L", img.size)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    box = mask.getbbox()
    result = img.convert("RGBA")
    result.putalpha(mask)
    return result.crop(box)

def tight(img):
    arr = np.asarray(img.convert("RGB"))
    ys, xs = np.where(arr.min(axis=2) < 220)
    return img.crop((max(0, int(xs.min())-5), max(0, int(ys.min())-5), min(img.width, int(xs.max())+6), min(img.height, int(ys.max())+6)))

def save(img, path, labels=()):
    img = tight(normalize_background(img.convert("RGB")))
    canvas = Image.new("RGB", (1000, 1000), "white")
    top = 25
    if labels:
        max_w = 440
        ready=[]
        for label in labels:
            if label.width > max_w:
                label=label.resize((max_w, round(label.height*max_w/label.width)), Image.Resampling.LANCZOS)
            ready.append(label)
        width=sum(x.width for x in ready)+18*(len(ready)-1)
        left=(1000-width)//2
        for label in ready:
            canvas.paste(label,(left,20),label if label.mode=="RGBA" else None)
            left += label.width+18
        top=20+max(x.height for x in ready)+30
    img=ImageOps.contain(img,(940,950-top),Image.Resampling.LANCZOS)
    pos=((1000-img.width)//2,top+(970-top-img.height)//2)
    canvas.paste(img,pos)
    canvas=canvas.convert("RGBA")
    canvas.alpha_composite(WM,((1000-WM.width)//2,pos[1]+img.height//2-WM.height//2))
    canvas.convert("RGB").save(path,optimize=True)

motor_label = polygon_crop(original("234968830813",1), [(185,70),(838,70),(838,468),(185,468)])
fender_label = polygon_crop(original("324788743186",1), [(752,57),(1490,57),(1490,520),(752,520)])

for part, paths, label in [
    ("83450-2S000", MOTOR, motor_label),
    ("86190-C1000", FENDER, fender_label),
]:
    out=ROOT/"완성본"/part
    out.mkdir(parents=True,exist_ok=True)
    for i,name in enumerate(paths):
        target=out/(part+("" if i==0 else f"_{i}")+".png")
        save(Image.open(GEN/name), target, (label,) if i==0 else ())
        print(target)
