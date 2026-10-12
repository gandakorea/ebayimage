import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {epsURL,decodePng,verifyEPS} from './local-photo-validation.mjs';
const legacy='https://i.ebayimg.com/00/s/MTAwMFgxMDAw/z/ulwAAeSwZ4ZqzRbF/$_57.PNG?set_id=8800005007';
test('accept actual legacy Media API EPS readback and reject unrelated origins/parameters',()=>{
 assert.equal(epsURL(legacy),legacy);assert.equal(epsURL('https://i.ebayimg.com/images/g/asset/s-l1600.png'),'https://i.ebayimg.com/images/g/asset/s-l1600.png');
 for(const value of [legacy.replace('https:','http:'),legacy.replace('i.ebayimg.com','i.ebayimg.com.evil.example'),legacy+'&target=x',legacy.replace('8800005007','x'),legacy+'#fragment','https://user@i.ebayimg.com/images/g/asset/s-l1600.png','https://i.ebayimg.com/api/request'])assert.throws(()=>epsURL(value));
});
test('validate legacy returned pixels without reuploading and detect replacement image',async()=>{
 const source=await sharp({create:{width:1000,height:1000,channels:3,background:'#f8f8f8'}}).png().toBuffer(),pixels=await decodePng(source);
 const proof=await verifyEPS(legacy,pixels,async()=>new Response(source,{headers:{'content-type':'image/png'}}));assert.equal(proof.pixelMAE,0);assert.equal(proof.sourcePixelSHA256,proof.readbackPixelSHA256);
 const wrong=await sharp({create:{width:1000,height:1000,channels:3,background:'#202020'}}).png().toBuffer();await assert.rejects(verifyEPS(legacy,pixels,async()=>new Response(wrong,{headers:{'content-type':'image/png'}})),/pixel mismatch/);
 const damaged=Buffer.from(source);damaged[50]^=1;await assert.rejects(decodePng(damaged),/CRC|Truncated/);
});
