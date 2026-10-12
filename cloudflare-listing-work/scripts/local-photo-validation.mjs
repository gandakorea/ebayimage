import {createHash} from 'node:crypto';
import sharp from 'sharp';
const fail=message=>{throw Error(message);};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
// Validate every PNG chunk CRC, not just IHDR; sharp then fully decodes pixels.
function crc32(bytes) { let c=0xffffffff; for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; }
export async function decodePng(bytes) {
  if(bytes.length<45 || !bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) fail('Invalid PNG signature');
  let offset=8, count=0, ended=false, idat=false;
  while(offset<bytes.length){
    if(offset+12>bytes.length) fail('Truncated PNG');
    const length=bytes.readUInt32BE(offset), end=offset+12+length;
    if(end>bytes.length) fail('Truncated PNG chunk');
    const kind=bytes.toString('ascii',offset+4,offset+8);
    if(!count && (kind!=='IHDR'||length!==13)) fail('Invalid IHDR');
    if(count && kind==='IHDR') fail('Duplicate IHDR');
    if(kind==='acTL') fail('Animated PNG forbidden');
    if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4)) fail('PNG CRC mismatch');
    if(kind==='IDAT') idat=true;
    if(kind==='IEND'){if(length!==0 || end!==bytes.length) fail('Invalid PNG end');ended=true;}
    offset=end;count++;
  }
  if(!ended||!idat) fail('PNG missing image data');
  const meta=await sharp(bytes,{failOn:'warning',limitInputPixels:1000000}).metadata();
  if(meta.width!==1000||meta.height!==1000||meta.format!=='png'||(meta.pages??1)!==1) fail('1000x1000 PNG required');
  return sharp(bytes,{failOn:'warning',limitInputPixels:1000000}).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
}
export async function boundedBytes(response,limit) {
  if(!response.body) fail('Missing binary body');
  const chunks=[];let size=0;const reader=response.body.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('Body exceeds limit');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export function epsURL(value) {
  if(typeof value!=='string') fail('EPS URL missing');
  const u=new URL(value);
  const modern=/^\/images\/(?:g|z)\/[^/]+\/[^/]+$/.test(u.pathname);
  const legacy=/^\/00\/s\/[A-Za-z0-9=_-]+\/(?:g|z)\/[^/]+\/\$_(?:1|57)\.(?:png|jpe?g)$/i.test(u.pathname);
  const queryOK=!u.search || (legacy && [...u.searchParams].length===1 && /^\d+$/.test(u.searchParams.get('set_id')??''));
  if(u.protocol!=='https:'||u.hostname!=='i.ebayimg.com'||u.port||u.username||u.password||u.hash||!queryOK||(!modern&&!legacy)) fail('Invalid EPS URL');
  return u.href;
}
export async function verifyEPS(url,sourcePixels,fetcher=fetch) {
  const response=await fetcher(epsURL(url),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok || !/^image\/(png|jpeg)(;|$)/i.test(response.headers.get('content-type')??'')) fail('EPS readback HTTP/MIME failure');
  const bytes=await boundedBytes(response,8*1024*1024);
  const meta=await sharp(bytes,{failOn:'warning',limitInputPixels:1000000}).metadata();
  if(meta.width!==1000||meta.height!==1000||!['png','jpeg'].includes(meta.format)||(meta.pages??1)!==1) fail('EPS readback decode/size mismatch');
  const pixels=await sharp(bytes,{failOn:'warning',limitInputPixels:1000000}).flatten({background:'#ffffff'}).removeAlpha().toColourspace('srgb').raw().toBuffer();
  if(pixels.length!==sourcePixels.length) fail('EPS pixel length mismatch');
  let total=0;const tiles=new Float64Array(100);
  for(let i=0;i<pixels.length;i++){const d=Math.abs(pixels[i]-sourcePixels[i]);total+=d;const p=Math.floor(i/3);tiles[Math.floor(p/100000)*10+Math.floor((p%1000)/100)]+=d;}
  const pixelMAE=total/pixels.length, maxTileMAE=Math.max(...tiles)/30000;
  if(pixelMAE>5||maxTileMAE>12) fail('EPS content pixel mismatch');
  return {readbackSHA256:sha256(bytes),readbackPixelSHA256:sha256(pixels),sourcePixelSHA256:sha256(sourcePixels),pixelMAE,maxTileMAE,width:1000,height:1000,readbackBytes:bytes.length};
}
