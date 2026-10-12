// Shared producer/Worker contract. Text URLs/hashes are metadata, image bytes are not.
const fail=()=>{throw Error('Photo/binary metadata schema rejected');};
const photoMagic=s=>s.startsWith('\x89PNG\r\n\x1a\n')||s.startsWith('\xff\xd8\xff')||/^GIF8[79]a/.test(s)||/^RIFF[\s\S]{4}WEBP/.test(s);
// Bounded semantic decoding, not a blanket ban on whitespace or ordinary notes.
function encodedText(s,depth,budget){
 if(depth>8||s.length>1024*1024||(budget.left-=s.length)<0)fail();
 if(photoMagic(s))fail();
 for(let i=0;i<4;i++){
  const next=s.replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&(amp|colon|sol|quot|apos|lt|gt);/gi,(_,n)=>({amp:'&',colon:':',sol:'/',quot:'"',apos:"'",lt:'<',gt:'>'}[n.toLowerCase()])).replace(/\\u([0-9a-f]{4})/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
  try{s=decodeURIComponent(next);}catch{s=next;}
 }
 if(/^[a-f0-9]{64}$/i.test(s))return;
 if(/data\s*:\s*(?:image\/|application\/octet-stream)/i.test(s))fail();
 // Coalesce standard Unicode whitespace before looking for encoded image bytes.
 // Scan both original and coalesced tokens, so normal text surrounding a payload
 // does not hide it; each decoded printable token can itself be another encoding.
 for(const form of new Set([s,s.replace(/\s/g,'')])){
  if(/(?:iVBORw0KGgo|\/9j\/|R0lGOD[lh]|ZGF0YTppbWFnZS)/i.test(form))fail();
  if(/[A-Za-z0-9+/_=-]{1024,}/.test(form))fail();
  for(const match of form.matchAll(/[A-Za-z0-9+/_=-]{8,}/g)){
   const token=match[0];if(/^[a-f0-9]{64}$/i.test(token))continue;
   const decoded=[];
   if(token.length%2===0&&/^[a-f0-9]+$/i.test(token))decoded.push(token.replace(/../g,n=>String.fromCharCode(parseInt(n,16))));
   try{decoded.push(atob(token.replaceAll('-','+').replaceAll('_','/')));}catch{}
   for(const value of decoded){
    if(photoMagic(value))fail();
    if(value.length>=8&&/^[\x09\x0a\x0d\x20-\x7e]+$/.test(value))encodedText(value,depth+1,budget);
   }
  }
 }
}
export function textMetadata(v,depth=0){
 if(depth>40)fail();
 if(typeof v==='string'){
  encodedText(v,0,{left:16*1024*1024});
  let s=v;
  for(let i=0;i<4;i++){
   const next=s.replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&(amp|colon|sol|quot|apos|lt|gt);/gi,(_,n)=>({amp:'&',colon:':',sol:'/',quot:'"',apos:"'",lt:'<',gt:'>'}[n.toLowerCase()])).replace(/\\u([0-9a-f]{4})/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
   try{s=decodeURIComponent(next);}catch{s=next;}
  }
  if(/^[a-f0-9]{64}$/i.test(s))return; // Whole SHA is typed text, not a hex-encoded photograph.
  if(/^\s*[\[{]/.test(s)){let parsed;try{parsed=JSON.parse(s);}catch{}if(parsed!==undefined){textMetadata(parsed,depth+1);return;}}
  if(/data\s*:\s*(?:image\/|application\/octet-stream)|(?:iVBORw0KGgo|\/9j\/|R0lGOD[lh]|ZGF0YTppbWFnZS)/i.test(s))fail();
  if(/[A-Za-z0-9+/_=-]{1024,}/.test(s))fail();
  for(const token of s.match(/[A-Za-z0-9+/_=-]{12,}/g)??[]){
   if(/^[a-f0-9]{64}$/i.test(token))continue;
   let decoded;try{decoded=atob(token.replaceAll('-','+').replaceAll('_','/'));}catch{continue;}
   if(decoded.startsWith('\x89PNG\r\n\x1a\n')||decoded.startsWith('\xff\xd8\xff')||/^GIF8[79]a/.test(decoded)||/^RIFF[\s\S]{4}WEBP/.test(decoded))fail();
   if(/^\s*[\[{]/.test(decoded)||/data\s*:\s*image\//i.test(decoded))textMetadata(decoded,depth+1);
  }
  return;
 }
 if(typeof v==='number'){if(!Number.isFinite(v))fail();return;}
 if(v===null||typeof v==='boolean')return;
 if(!v||typeof v!=='object'||(!Array.isArray(v)&&Object.prototype.toString.call(v)!=='[object Object]'))fail();
 const descriptors=Object.getOwnPropertyDescriptors(v);if(Object.values(descriptors).some(d=>d.get||d.set)||typeof v.toJSON==='function')fail();
 if(Array.isArray(v)){if(Object.getPrototypeOf(v)?.constructor?.name!=='Array'||(v.length&&v.every(n=>typeof n==='number')))fail();for(const x of v)textMetadata(x,depth+1);return;}
 const proto=Object.getPrototypeOf(v);if(proto&&(Object.getPrototypeOf(proto)!==null||proto.constructor?.name!=='Object'))fail();
 const names=Object.keys(v);if(names.length&&names.every(k=>/^\d+$/.test(k))&&Object.values(v).every(n=>typeof n==='number'))fail();
 for(const [k,x] of Object.entries(v)){if(/password|credential|token|secret|authorization|base64|photodata|imagebytes|thumbnail|^pixels$|^data$/i.test(k))fail();textMetadata(x,depth+1);}
}
const S='string',N='number',B='boolean',A=s=>[s],O=(fields)=>({fields}),M=s=>({map:s});
const result=O({status:S,listingId:S,listingUrl:S,checkedAt:S,error:S});
const row=O({id:S,itemNumber:S,price:S,shippingPolicy:S,memo:S,executionMode:S,preparationStatus:S,partNumber:S,photoCount:N,statusUpdatedAt:S,usResult:result,auResult:result});
const spec=M(A(S)),compat=A(M(S));
const pkg=O({version:N,date:S,itemId:S,referenceItemNumber:S,partNumber:S,usdPrice:S,shippingPolicy:S,title:S,descriptionHtml:S,type:S,preparedAt:S,images:A(O({pathname:S,url:S,filename:S,size:N})),us:O({categoryId:S,storeCategoryIds:A(S),itemSpecifics:spec,compatibility:compat,compatibilityNotes:A(S)}),au:O({categoryId:S,storeCategoryNames:A(S),itemSpecifics:spec,compatibility:compat})});
const manifest=O({version:N,date:S,itemId:S,referenceItemNumber:S,partNumber:S,usdPrice:S,shippingPolicy:S,marketplace:S,photoApproval:O({allApproved:B,approvedAt:S}),images:A(O({filename:S,sourcePath:S,sha256:S,size:N,order:N}))});
const approval=O({date:S,checkedAt:S,photoApproval:B,rows:A(O({itemId:S,referenceItemNumber:S,partNumber:S,galleryIndex0:N,finalPath:S,finalSHA256:S,approved:B,publicationAppearanceApproved:B,originalWholeViewed:B,final1000PNGWholeViewed:B}))});
const target=O({packageText:{json:pkg},manifestText:{json:manifest},approvalText:{json:approval},approvalSHA256:S,row,agent:N,packageSHA256:S,manifestSHA256:S});
const session=O({version:N,nonce:S,date:S,targets:A(target),batchMemo:S,expiresAt:S});
const receipt=O({version:N,operation:S,marketplace:S,seller:S,date:S,itemId:S,partNumber:S,manifestSHA256:S,index:N,filename:S,sourceSHA256:S,sourcePath:S,sourcePixelSHA256:S,maxDimensionImageURL:S,readbackSHA256:S,readbackPixelSHA256:S,readbackBytes:N,epsURL:S,imageId:S,imageLocation:S,expirationDate:S,verifiedAt:S,width:N,height:N,pixelMAE:N,maxTileMAE:N,listingMutation:B,boardMutation:B,blobPhotoWrite:B});
const signed=s=>O({receipt:s,signature:S});
const publication=O({listingId:S,listingUrl:S,price:S,exchangeRate:N});
const published=O({nonce:S,itemId:S,market:S,result:publication,photos:A(signed(receipt))});
const qa=O({date:S,itemId:S,market:S,listingId:S,packageSHA256:S,rawGetItemSHA256:S,publicSHA256:S,gallerySHA256s:A(S),checkedAt:S,allVerified:B});
const claim=O({nonce:S,itemId:S,market:S,sku:S,createdAt:S});
const photoClaim=O({manifestSHA256:S,seller:S,index:N,stage:S,createdAt:S});
const audit=O({packageSemanticSHA256:S,browserScreenshotSHA256:S,referenceItemNumber:S,approvedPackageSHA256:S,compatibilitySHA256:S,operation:S,date:S,itemId:S,market:S,referenceSHA256:S,referenceBytes:N,templateSHA256:S,templateBytes:N,checkedAt:S,qa,runtimeExpected:O({payment:S,returns:S,shipping:S,storeIds:A(S)}),descriptionSHA256:S,publicResult:O({photoCount:N,descriptionURL:S,vinURLs:A(S),sellerEvidence:S}),vinSHA256s:A(S)});
const ledger=O({date:S,itemId:S,referenceItemNumber:S,partNumber:S,us:result,au:result,updatedAt:S});
function check(v,s){
 if(typeof s==='string'){if(typeof v!==s)fail();return;}
 if(Array.isArray(s)){if(!Array.isArray(v))fail();for(const x of v)check(x,s[0]);return;}
 if(s.json){if(typeof v!=='string')fail();check(JSON.parse(v),s.json);return;}
 if(!v||typeof v!=='object'||Array.isArray(v))fail();
 for(const [k,x] of Object.entries(v)){const t=s.map??s.fields[k];if(!t)fail();check(x,t);}
}
export function validatePackageMetadata(v){textMetadata(v);check(v,pkg);}
export function validateSourceTexts(t){textMetadata(t);check(t,target);}
export function validateMetadataRecord(key,v){
 textMetadata(v);
 const namespace=key.split('/')[0];let schema;
 if(namespace==='execution-ledgers')schema=ledger;
 else if(namespace==='local-eps-photo-receipts')schema=signed(receipt);
 else if(namespace==='local-eps-photo-claims')schema=signed(photoClaim);
 else if(namespace==='local-eps-pipeline-claims')schema=signed(claim);
 else if(namespace==='local-eps-audits')schema=signed(audit);
 else if(namespace==='local-eps-pipeline')schema=signed(key.endsWith('/source.json')?session:key.endsWith('/published.json')?published:qa);
 else fail();
 check(v,schema);
}
export function validateBoardMetadata(v){textMetadata(v);check(v,O({date:S,batchMemo:S,groups:A(O({agent:N,items:A(row)})),scheduledTime:S,automationEnabled:B,publishMode:S,automationStatus:S}));}
