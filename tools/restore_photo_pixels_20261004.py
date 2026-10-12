"""Use model retouch only under seller overlays; preserve original visible pixels."""
from pathlib import Path
import sys
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
GEN = Path('/Volumes/my SSD/.codex/generated_images/01a102e7-0078-7013-addd-0b41a66e3630')
sys.path.insert(0, str(ROOT / 'tools'))
from finalize_product_images import make_watermark, normalize_background

FILES = {
 '25110-2G500': ['57616a83-6af7-4738-a24a-03ca48aa98f5','0d4759d4-c8b8-45ad-83be-f691a8712033','b48efd95-5bc8-4a87-a61c-0ba4fe9a2dac'],
 '81320-F2040': ['96729532-8586-46d2-bf0d-365df320199e','cc9b6e7a-bfab-4bff-a965-667208a6c24e','709c6399-5ccf-4c71-8139-a970dc37ef87','f39dc395-abbf-4ec6-85fa-d6b3b49fa2f3','41b9d534-20c4-40da-8607-6035d62c9f42'],
}
PUMP_RECTS=[(650,175,920,212),(180,282,440,314),(660,360,940,395),(1050,465,1295,502),(238,510,515,545),(630,620,910,654),(1190,670,1470,706),(175,770,450,806),(1100,950,1380,987),(130,1090,415,1127),(810,1160,1100,1200),(1260,1245,1520,1290),(405,1265,730,1305)]
DOOR_LABELS=[(352,198,881,524),(855,776,1452,1145),(918,1143,1517,1515),(28,126,629,497),(290,225,895,598)]
DOOR_OVERLAYS=[[(493,735,1112,862),(140,1307,529,1475),(0,1400,1600,1600)],[(495,735,1115,866),(500,1450,1185,1600)],[(495,735,1115,866),(500,1450,1185,1600)],[(495,735,1115,866),(500,1450,1185,1600)],[(495,735,1115,866),(500,1450,1185,1600)]]

def aligned(original, edited, ignore):
    gray_o=cv2.cvtColor(original,cv2.COLOR_RGB2GRAY)
    gray_e=cv2.cvtColor(edited,cv2.COLOR_RGB2GRAY)
    mask=np.full(gray_o.shape,255,np.uint8)
    for x1,y1,x2,y2 in ignore: mask[y1:y2,x1:x2]=0
    sift=cv2.SIFT_create(nfeatures=12000)
    ko,do=sift.detectAndCompute(gray_o,mask)
    ke,de=sift.detectAndCompute(gray_e,None)
    pairs=cv2.BFMatcher().knnMatch(de,do,k=2)
    matches=[a for a,b in pairs if a.distance<.68*b.distance]
    pe=np.float32([ke[m.queryIdx].pt for m in matches])
    po=np.float32([ko[m.trainIdx].pt for m in matches])
    transform,inliers=cv2.findHomography(pe,po,cv2.RANSAC,3)
    if transform is None or int(inliers.sum())<25: raise RuntimeError('Insufficient original-pixel alignment')
    restored=cv2.warpPerspective(edited,transform,(original.shape[1],original.shape[0]),borderValue=(255,255,255))
    print('alignment',len(matches),int(inliers.sum()))
    return restored,transform

def fit_paste(canvas, image, box):
    x1,y1,x2,y2=box
    image.thumbnail((x2-x1,y2-y1),Image.Resampling.LANCZOS)
    canvas.paste(image,(x1+(x2-x1-image.width)//2,y1+(y2-y1-image.height)//2))

for part, ids in FILES.items():
    out=ROOT/'작업중'/'2026-10-04'/part/'검수용'
    out.mkdir(parents=True,exist_ok=True)
    for index,gid in enumerate(ids):
        original=np.array(Image.open(ROOT/'원본'/'2026-10-04'/part/f'source_{index:02}.webp').convert('RGB'))
        edited=np.array(Image.open(GEN/f'exec-{gid}.png').convert('RGB'))
        pump=part.startswith('25110')
        rects=PUMP_RECTS if pump else DOOR_OVERLAYS[index]
        erase=[(0,1394,1600,1600)] if pump else [DOOR_LABELS[index]]+([(0,1400,1600,1600)] if index==0 else [])
        aligned_image,transform=aligned(original,edited,rects+erase)
        repaired=original.copy()
        retouch_mask=np.zeros(original.shape[:2],np.uint8)
        if pump:
            # Isolate the real seller glyphs on white; retouch only glyph strokes.
            glyph=original[1250:1290,1260:1520]
            glyph_mask=((glyph.min(axis=2)<250)&((glyph.max(axis=2)-glyph.min(axis=2))>3)).astype(np.uint8)*255
            yy,xx=np.where(glyph_mask>0)
            glyph_mask=glyph_mask[yy.min():yy.max()+1,xx.min():xx.max()+1]
        else:
            template=np.array(Image.open(ROOT/'원본'/'2026-10-04'/part/'source_03.webp').convert('RGB'))[1455:1598,510:1180]
            glyph_mask=(template.min(axis=2)<242).astype(np.uint8)*255
            yy,xx=np.where(glyph_mask>0)
            glyph_mask=glyph_mask[yy.min():yy.max()+1,xx.min():xx.max()+1]
        for x1,y1,x2,y2 in rects:
            if not pump and index==0 and y1>=1300:
                repaired[y1:y2,x1:x2]=aligned_image[y1:y2,x1:x2]
                continue
            if pump:
                sy1=max(0,y1-12); sy2=min(1600,y2+12); sx1=max(0,x1-20); sx2=min(1600,x2+20)
                rgb=original[sy1:sy2,sx1:sx2].astype(np.float32)
                color=(rgb[:,:,0]+rgb[:,:,2])/2-rgb[:,:,1]
                contrast=color-cv2.GaussianBlur(color,(0,0),4)
                score=cv2.matchTemplate(contrast,glyph_mask.astype(np.float32),cv2.TM_CCOEFF_NORMED)
                _,_,_,loc=cv2.minMaxLoc(score)
                dx=sx1+loc[0];dy=sy1+loc[1]
                gh,gw=glyph_mask.shape
                retouch_mask[dy:dy+gh,dx:dx+gw]=np.maximum(retouch_mask[dy:dy+gh,dx:dx+gw],glyph_mask)
            else:
                dx,dy,gw,gh=(500,745,605,111) if y1<1000 else (520,1464,650,115)
                local=cv2.resize(glyph_mask,(gw,gh),interpolation=cv2.INTER_NEAREST)
                retouch_mask[dy:dy+gh,dx:dx+gw]=np.maximum(retouch_mask[dy:dy+gh,dx:dx+gw],local)
        retouch_mask=cv2.dilate(retouch_mask,np.ones((9,9),np.uint8))
        # Restore visible original pixels; fill only seller text strokes, not rectangles.
        repaired=cv2.inpaint(repaired,retouch_mask,5,cv2.INPAINT_TELEA)
        for x1,y1,x2,y2 in erase: repaired[y1:y2,x1:x2]=255
        # Identify actual product footprint from the original, not model geometry.
        mask=(original.min(axis=2)<233).astype(np.uint8)*255
        for x1,y1,x2,y2 in erase: mask[y1:y2,x1:x2]=0
        mask[retouch_mask>0]=(repaired.min(axis=2)[retouch_mask>0]<233).astype(np.uint8)*255
        mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
        component=1+np.argmax(stats[1:,cv2.CC_STAT_AREA])
        selected=(labels==component).astype(np.uint8)*255
        # Fill interior bright metal and preserve complete original edges.
        contours,_=cv2.findContours(selected,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(selected,contours,-1,255,cv2.FILLED)
        selected=cv2.dilate(selected,np.ones((3,3),np.uint8))
        repaired[selected==0]=255
        ys,xs=np.where(selected>0)
        # Discard the rectangle/stroke repair preview. Use the clean model retouch
        # and restore actual original labels and critical text into that output.
        restored_mask=np.zeros(original.shape[:2],np.uint8)
        areas=([(515,1050,1070,1257),(875,1010,1100,1120)] if index==0 else [(350,875,900,1230)]) if pump else ([(480,1040,760,1230)] if index==1 else [(500,320,950,500)] if index==2 else [])
        for ax1,ay1,ax2,ay2 in areas:
            local=(original[ay1:ay2,ax1:ax2].min(axis=2)>175).astype(np.uint8)*255
            contours,_=cv2.findContours(local,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                if cv2.contourArea(contour)>800:
                    canvas_mask=np.zeros_like(local)
                    cv2.drawContours(canvas_mask,[contour],-1,255,cv2.FILLED)
                    restored_mask[ay1:ay2,ax1:ax2]=np.maximum(restored_mask[ay1:ay2,ax1:ax2],canvas_mask)
        if not pump and index in (0,4):
            # The original wire's manufacturing code is unobscured by the seller.
            region=(430,1090,590,1205) if index==0 else (400,1210,590,1330)
            ax1,ay1,ax2,ay2=region
            restored_mask[ay1:ay2,ax1:ax2]=255
        reverse=np.linalg.inv(transform)
        original_detail=original.copy()
        if pump:
            # Undo the colored seller overlay on neutral white/black paper using
            # its observed channel difference, retaining original text strokes.
            f=original.astype(np.float32)
            colored=(restored_mask>0)&((f[:,:,0]-f[:,:,1])>4)
            alpha=np.clip((f[:,:,0]-f[:,:,1])/140,0,.35)
            neutral=np.clip((f[:,:,1]-alpha*80)/(1-alpha),0,255).astype(np.uint8)
            original_detail[colored]=np.repeat(neutral[:,:,None],3,axis=2)[colored]
        original_warp=cv2.warpPerspective(original_detail,reverse,(edited.shape[1],edited.shape[0]),borderValue=(255,255,255))
        mask_warp=cv2.warpPerspective(restored_mask,reverse,(edited.shape[1],edited.shape[0]),flags=cv2.INTER_NEAREST)
        model=edited.copy()
        model[mask_warp>0]=original_warp[mask_warp>0]
        # Keep the square model canvas to avoid chopping the ends of its product.
        item=normalize_background(Image.fromarray(model))
        canvas=Image.new('RGB',(1000,1000),'white')
        if not pump and index==0:
            label=Image.open(ROOT/'원본'/'2026-10-04'/part/'source_00.webp').crop(DOOR_LABELS[0]).convert('RGB')
            label=label.resize((350,round(label.height*350/label.width)),Image.Resampling.LANCZOS)
            canvas.paste(label,((1000-label.width)//2,20))
            lower=20+label.height
            fit_paste(canvas,item,(30,lower+30,970,970))
            cy=(lower+1000)//2
        else:
            fit_paste(canvas,item,(30,30,970,970))
            cy=740 if not pump and index==3 else 500
        rgba=canvas.convert('RGBA')
        wm=make_watermark()
        rgba.alpha_composite(wm,((1000-wm.width)//2,round(cy-wm.height/2)))
        name=f'{part}.png' if index==0 else f'{part}_{index}.png'
        rgba.convert('RGB').save(out/name)
        print(part,index,name)
