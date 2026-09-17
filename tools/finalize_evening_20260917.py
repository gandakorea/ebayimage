from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from finalize_product_images import make_watermark, normalize_background

ROOT = Path(__file__).resolve().parent.parent
GEN = Path(r'C:\Users\USER\.codex\generated_images\01a074b1-de74-7c30-8286-38fe98fc29ef')
SETS = {
 '81230-1H000': ['0e982977-a5ad-4e60-8eb1-c80110efa3f0','87a06749-da10-4b2d-ada0-96eeba4592d0','78f3fe5f-1086-4bf5-8821-6617d829f624','a047c635-aa6a-48a5-a13a-dc053a3269c6','3c3dd5af-bc3b-4f25-aab1-f04a0fcd15a0','921c4786-f911-4dca-8a94-fba326ddc859'],
 '81310-3L021': ['e2750b4c-519b-4f11-82e0-85d22613dafe','96ced32b-ed21-40b4-9c7d-9e1ebf2a4939','60b72929-4e56-4069-837c-b0a04ced0444','4c10db6d-2817-49b1-9ad0-4d2ff85f62e5']
}
wm=make_watermark()
for part, ids in SETS.items():
 out=ROOT/'완성본'/part
 out.mkdir(parents=True,exist_ok=True)
 for i,uid in enumerate(ids):
  img=normalize_background(Image.open(GEN/f'exec-{uid}.png').convert('RGB'))
  # These close-ups only carry the seller banner below the product. Retain
  # original moulded lettering and barcode pixels rather than generated text.
  if part=='81310-3L021' and i in (1,2):
   img=Image.open(ROOT/'작업중'/part/f'originals/source_0{i+1}.jpg').convert('RGB')
   img=normalize_background(img.crop((0,0,1600,1380 if i==1 else 1280)))
  a=np.array(img); ys,xs=np.where(a.min(axis=2)<180)
  box=(max(0,int(xs.min())-6),max(0,int(ys.min())-6),min(img.width,int(xs.max())+7),min(img.height,int(ys.max())+7))
  product=img.crop(box)
  canvas=Image.new('RGB',(1000,1000),'white')
  top=30
  if i==0:
   rect,width=((390,0,1210,420),463) if part=='81230-1H000' else ((900,80,1525,465),413)
   label=Image.open(ROOT/'작업중'/part/'originals/source_01.jpg').convert('RGB').crop(rect)
   label=normalize_background(label)
   label=label.resize((width,round(label.height*width/label.width)),Image.Resampling.LANCZOS)
   canvas.paste(label,((1000-width)//2,20)); top=20+label.height+35
  product=ImageOps.contain(product,(940,970-top),Image.Resampling.LANCZOS)
  pos=((1000-product.width)//2,top+(970-top-product.height)//2)
  canvas.paste(product,pos)
  canvas=canvas.convert('RGBA')
  canvas.alpha_composite(wm,((1000-wm.width)//2,pos[1]+product.height//2-wm.height//2))
  name=part+('' if i==0 else f'_{i}')+'.png'
  canvas.convert('RGB').save(out/name)
  print(name)
