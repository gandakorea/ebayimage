"""Finalize built-in image edits using approved sizing, original labels and watermark."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageOps, ImageDraw
from finalize_product_images import make_watermark, normalize_background

ROOT=Path(__file__).resolve().parent.parent
SETS={'h':('83650-4H150_83660-4H150','334438850072'), 'b':('55130-4D000','232553407179'),'m':('54610-C1000','335849535403')}
WM=make_watermark()

def original(ref,n):
    return Image.open(ROOT/'작업중'/f'ebay-{ref}'/'originals'/f'source_{n:02}.jpg').convert('RGB')

def polygon_crop(img, polygons):
    mask=Image.new('L',img.size); draw=ImageDraw.Draw(mask)
    for points in polygons: draw.polygon(points,fill=255)
    box=mask.getbbox(); result=img.convert('RGBA');result.putalpha(mask)
    return result.crop(box)

def paste_quad(dest,src,source_quad,dest_quad):
    # Copy photographed label pixels; never retype serial numbers or barcodes.
    a=[];b=[]
    for (x,y),(u,v) in zip(dest_quad,source_quad):
        a.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);b.extend([u,v])
    coeff=np.linalg.solve(np.array(a),np.array(b))
    mask=Image.new('L',src.size);ImageDraw.Draw(mask).polygon(source_quad,fill=255)
    rgba=src.convert('RGBA');rgba.putalpha(mask)
    layer=rgba.transform(dest.size,Image.Transform.PERSPECTIVE,coeff,Image.Resampling.BICUBIC)
    dest.paste(layer,(0,0),layer)
    return dest

def tight(img):
    arr=np.asarray(img); ys,xs=np.where(arr.min(axis=2)<220)
    return img.crop((max(0,int(xs.min())-4),max(0,int(ys.min())-4),min(img.width,int(xs.max())+5),min(img.height,int(ys.max())+5)))

def save(img,path,labels=()):
    img=tight(normalize_background(img)); canvas=Image.new('RGB',(1000,1000),'white'); top=30
    if labels:
        width=sum(x.width for x in labels)+20*(len(labels)-1);left=(1000-width)//2
        for label in labels:canvas.paste(label,(left,20),label if label.mode=='RGBA' else None);left+=label.width+20
        top=20+max(x.height for x in labels)+35
    img=ImageOps.contain(img,(940,970-top),Image.Resampling.LANCZOS)
    pos=((1000-img.width)//2,top+(970-top-img.height)//2);canvas.paste(img,pos)
    canvas=canvas.convert('RGBA');canvas.alpha_composite(WM,((1000-WM.width)//2,pos[1]+img.height//2-WM.height//2))
    canvas.convert('RGB').save(path,optimize=True)

handle_polys={2:[[(589,1350),(877,1338),(886,1406),(610,1412)],[(879,1322),(996,1324),(994,1355),(880,1353)]],7:[[(527,1240),(843,1227),(853,1341),(541,1352)],[(842,1226),(972,1221),(978,1275),(851,1285)]]}
for key,(part,ref) in SETS.items():
    paths=json.loads((ROOT/'작업중'/f'sep18-{key}-paths.json').read_text())
    out=ROOT/'완성본'/part;out.mkdir(parents=True,exist_ok=True)
    labels=[]
    if key=='h':
        for n in (2,7):
            label=polygon_crop(original(ref,n),handle_polys[n]); label=label.resize((460,round(label.height*460/label.width)),Image.Resampling.LANCZOS);labels.append(label)
    for i,p in enumerate(paths):
        if key=='b' and i==1:
            p=Path(r'C:\Users\USER\.codex\generated_images\01a074b1-de74-7c30-8286-38fe98fc29ef\exec-8eb0ec43-935f-4819-b867-3bd7faa8ff03.png')
        img=Image.open(p).convert('RGB')
        if key=='b' and i==1:
            arr=np.asarray(img).copy()
            neutral=(arr.min(axis=2)>218)&((arr.max(axis=2)-arr.min(axis=2))<18)
            arr[neutral]=255
            img=Image.fromarray(arr)
        if key=='h' and i in (1,6):
            n=i+1
            targets={2:[[(460,1044),(692,1041),(699,1096),(471,1098)],[(698,1027),(793,1028),(790,1057),(696,1055)]],7:[[(397,963),(666,958),(674,1059),(405,1063)],[(665,959),(774,953),(778,1004),(671,1011)]]}
            for srcquad,dstquad in zip(handle_polys[n],targets[n]):img=paste_quad(img,original(ref,n),srcquad,dstquad)
        name=part+('' if i==0 else f'_{i}')+'.png'
        save(img,out/name,labels if i==0 else ())
        print(name)
    if key=='b':
        # Keep the full packaging photo as an additional gallery image, and
        # compose the representative image from this item's label and bush.
        (out/f'{part}_8.png').write_bytes((out/f'{part}.png').read_bytes())
        label_img=Image.open(paths[0]).convert('RGB')
        label=polygon_crop(label_img,[[(334,488),(423,477),(754,476),(756,421),(936,514),(966,642),(930,652),(906,867),(885,883),(362,872),(341,849),(327,658)]])
        label=label.resize((370,round(label.height*370/label.width)),Image.Resampling.LANCZOS)
        save(Image.open(paths[2]).convert('RGB'),out/f'{part}.png',[label])
