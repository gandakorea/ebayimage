param(
  [string]$InputDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) '2891022040 70.15')
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
public static class ValvePhoto {
  public static Bitmap Extract(string path, Rectangle roi, bool first) {
    using(var original = new Bitmap(path)) {
      var src = original.Clone(roi, PixelFormat.Format32bppArgb);
      int w=src.Width,h=src.Height,n=w*h;
      var data=src.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
      var bytes=new byte[data.Stride*h]; Marshal.Copy(data.Scan0,bytes,0,bytes.Length);src.UnlockBits(data);
      var eligible=new bool[n]; var seen=new bool[n]; var mask=new bool[n];var queue=new int[n];
      var silhouette=new GraphicsPath();
      if(path.Contains("203650")) silhouette.AddPolygon(new Point[]{
        new Point(550,102),new Point(582,102),new Point(622,112),new Point(628,127),new Point(609,211),new Point(590,302),
        new Point(640,314),new Point(682,340),new Point(709,380),new Point(717,418),new Point(703,456),new Point(681,481),
        new Point(648,494),new Point(615,659),new Point(602,683),new Point(568,690),new Point(555,762),new Point(541,789),
        new Point(480,788),new Point(451,951),new Point(445,964),new Point(372,947),new Point(368,929),new Point(399,777),
        new Point(354,764),new Point(339,744),new Point(345,686),new Point(358,650),new Point(334,637),new Point(336,598),
        new Point(366,454),new Point(337,428),new Point(327,403),new Point(331,366),new Point(343,331),new Point(375,316),
        new Point(449,310),new Point(449,284),new Point(465,266),new Point(501,273),new Point(540,126)});
      for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
        int p=y*w+x,b=y*data.Stride+x*4;
        eligible[p]=(bytes[b]+bytes[b+1]+bytes[b+2])/3<145;
        // Exclude the neighboring blue label, which touches this product crop.
        if(first && x+roi.X>425 && y+roi.Y<451) eligible[p]=false;
        if(first && x+roi.X>445) eligible[p]=false;
        if(first && x+roi.X>418 && y+roi.Y>535) eligible[p]=false;
        if(first && y+roi.Y>=402 && y+roi.Y<447 && x+roi.X>388) eligible[p]=false;
        if(first && y+roi.Y>=447 && y+roi.Y<480 && x+roi.X>388+(y+roi.Y-447)*1.6) eligible[p]=false;
        if(first && bytes[b]>bytes[b+2]+12) eligible[p]=false;
        if(path.Contains("203617")) {
          if(x+roi.X<567 && y+roi.Y>774)eligible[p]=false;
          if(x+roi.X<408 && y+roi.Y>746)eligible[p]=false;
        }
        if(silhouette.PointCount>0) {
          if(y+roi.Y<490)eligible[p]=(bytes[b]+bytes[b+1]+bytes[b+2])/3<175;
          else if(!silhouette.IsVisible(x+roi.X,y+roi.Y))eligible[p]=false;
        }
        if(path.Contains("203523") && x+roi.X<540 && y+roi.Y<665)eligible[p]=false;
        if(path.Contains("203701") && x+roi.X<465 && y+roi.Y>676)eligible[p]=false;
      }
      int best=0;
      for(int s=0;s<n;s++)if(eligible[s]&&!seen[s]){
        int head=0,tail=1;queue[0]=s;seen[s]=true;
        while(head<tail){int p=queue[head++],x=p%w,y=p/w;
          for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){
            int xx=x+dx,yy=y+dy;if(xx<0||xx>=w||yy<0||yy>=h)continue;
            int q=yy*w+xx;if(eligible[q]&&!seen[q]){seen[q]=true;queue[tail++]=q;}
          }
        }
        if(tail>best){Array.Clear(mask,0,n);for(int j=0;j<tail;j++)mask[queue[j]]=true;best=tail;}
      }
      // Close tiny breaks in bright rim pixels, then remove narrow cloth remnants.
      mask=Morph(Morph(mask,w,h,3,true),w,h,3,false);
      mask=Morph(Morph(mask,w,h,2,false),w,h,2,true);
      // Fill enclosed highlights and the two metal terminal faces with original pixels.
      var outside=new bool[n];int a=0,z=0;
      for(int p=0;p<n;p++)if((p%w==0||p%w==w-1||p<w||p>=n-w)&&!mask[p]){outside[p]=true;queue[z++]=p;}
      while(a<z){int p=queue[a++],x=p%w,y=p/w;
        int[] next={x>0?p-1:-1,x<w-1?p+1:-1,y>0?p-w:-1,y<h-1?p+w:-1};
        foreach(int q in next)if(q>=0&&!mask[q]&&!outside[q]){outside[q]=true;queue[z++]=q;}
      }
      int minx=w,miny=h,maxx=0,maxy=0;
      var result=new Bitmap(w,h,PixelFormat.Format32bppArgb);
      for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(!outside[y*w+x]){
        result.SetPixel(x,y,src.GetPixel(x,y));minx=Math.Min(minx,x);maxx=Math.Max(maxx,x);miny=Math.Min(miny,y);maxy=Math.Max(maxy,y);
      }
      src.Dispose();var cut=result.Clone(new Rectangle(minx,miny,maxx-minx+1,maxy-miny+1),PixelFormat.Format32bppArgb);result.Dispose();return cut;
    }
  }
  static bool[] Morph(bool[] src,int w,int h,int r,bool dilate){
    var dst=new bool[src.Length];
    for(int y=0;y<h;y++)for(int x=0;x<w;x++){
      bool value=!dilate;
      for(int dy=-r;dy<=r;dy++)for(int dx=-r;dx<=r;dx++){
        if(dx*dx+dy*dy>r*r)continue;
        int xx=x+dx,yy=y+dy;bool v=xx>=0&&xx<w&&yy>=0&&yy<h&&src[yy*w+xx];
        if(dilate)value|=v;else value&=v;
      }dst[y*w+x]=value;
    }return dst;
  }
  public static void Compose(string source, Rectangle roi, bool first, string labelSource, string output) {
    using(var cut=Extract(source,roi,first))using(var canvas=new Bitmap(1000,1000))using(var g=Graphics.FromImage(canvas)){
      g.Clear(Color.White);g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.PixelOffsetMode=PixelOffsetMode.HighQuality;
      int top=first?238:0;int area=1000-top;float scale=Math.Min(880f/cut.Width,(area-100f)/cut.Height);
      int w=(int)Math.Round(cut.Width*scale),h=(int)Math.Round(cut.Height*scale);
      g.DrawImage(cut,new Rectangle((1000-w)/2,top+(area-h)/2,w,h));
      if(first)using(var labelOriginal=new Bitmap(labelSource)){
        var box=new Rectangle(276,299,523,316);
        int lh=(int)Math.Round(350.0*box.Height/box.Width);
        g.DrawImage(labelOriginal,new Rectangle(325,20,350,lh),box,GraphicsUnit.Pixel);
      }
      canvas.Save(output,ImageFormat.Png);
    }
  }
}
'@
$outDir=Join-Path $PSScriptRoot '..\work-in-progress\28910-22040'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$items=@(
  @('203446',178,276,269,524),
  @('203523',198,615,650,310),
  @('203535',176,194,650,314),
  @('203650',322,94,408,880),
  @('203556',157,350,787,395),
  @('203607',354,181,382,766),
  @('203617',270,303,520,524),
  @('203639',315,150,388,803),
  @('203650',322,94,408,880),
  @('203701',297,230,449,510),
  @('203628',304,203,464,717)
)
for($i=0;$i -lt $items.Count;$i++){
  $item=$items[$i]
  $source=Join-Path $inputDir ('20260905_'+$item[0]+'.png')
  $roi=[System.Drawing.Rectangle]::new($item[1],$item[2],$item[3],$item[4])
  $output=Join-Path $outDir ('base_{0:D2}.png' -f $i)
  [ValvePhoto]::Compose($source,$roi,($i -eq 0),(Join-Path $inputDir '20260905_203523.png'),$output)
  Write-Output $output
}
