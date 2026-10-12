import { createHash, createHmac, timingSafeEqual } from 'node:crypto';


import {Buffer} from 'node:buffer';
import {textMetadata} from './metadata-contract.mjs';
import {dateOK} from './board-contract.mjs';
export function metadataPackage(p){return Object.fromEntries(['reference','localUUID','partNumber','title','descriptionHtml','itemSpecifics','priceUSD','shippingPolicyInput','US','storeModel','taxonomyQuery','images'].map(k=>[k,k==='images'?p.images.map(i=>({sha256:i.sha256,filename:i.filename??i.path?.split('/').pop()})):k==='US'?Object.fromEntries(['categoryId','compatibilityFullRows','compatibilityNotes','storeCategoryId','storeCategory2Id'].filter(n=>p.US[n]!==undefined).map(n=>[n,p.US[n]])):p[k]]));}
export function executorReady(env){return ['AUTOMATION_ADMIN_SECRET','EXECUTOR_RECEIPT_SECRET',...['US','AU'].flatMap(m=>['CLIENT_ID','CLIENT_SECRET','REFRESH_TOKEN','PAYMENT_POLICY_ID','RETURN_POLICY_ID','FAST_POLICY_ID','NORMAL_POLICY_ID'].map(k=>'EBAY_'+m+'_'+k)),'EBAY_AU_MERCHANT_LOCATION_KEY'].every(k=>Boolean(env[k]));}
export async function executor(request,env){
 if(!env.AUTOMATION_ADMIN_SECRET||request.headers.get('authorization')!=='Bearer '+env.AUTOMATION_ADMIN_SECRET)return Response.json({ok:false,error:'Unauthorized'},{status:401});
 const getRecord=async key=>{const r=await env.DB.prepare('SELECT body FROM executor_records WHERE key=?').bind(key).first();return r?JSON.parse(r.body):null;};
 const createRecord=async(key,value)=>{textMetadata(value);const r=await env.DB.prepare('INSERT OR IGNORE INTO executor_records VALUES(?,?,?)').bind(key,JSON.stringify(value),new Date().toISOString()).run();if(r.meta.changes!==1)throw Error('Exclusive operation already exists; inspect exact status, do not retry');};
 try{
 const raw=Buffer.from(await request.arrayBuffer());if(raw.length>4*1024*1024)throw Error('Request too large');
 const input=request.headers.get('content-type')==='application/octet-stream'?null:JSON.parse(raw.toString());
 if(input?.action==='identity'&&!input.run){const market=input.market;if(!['US','AU'].includes(market))throw Error('Invalid marketplace');const result=await identityOnly(env,market);return Response.json({ok:true,result});}
 if(input?.action==='store'&&!input.run){const market=input.market;if(!['US','AU'].includes(market))throw Error('Invalid marketplace');const h=readOnly(env),t=await h.token(market);return Response.json({ok:true,result:{xml:await h.trading(t,'GetStore','<CategoryStructureOnly>true</CategoryStructureOnly>',market)}});}
 if(input?.action==='reference'){if(!/^\d{9,15}$/.test(input.itemId))throw Error('Invalid reference');return await referenceOnly(env,input.itemId,input.market??'US');}
 if(input?.action==='begin'){
  textMetadata(input);const {date,run,items}=input;if(!dateOK(date)||!/^[-a-f0-9]{36}$/.test(run)||!Array.isArray(items)||items.length<1||items.length>8||new Set(items.map(p=>p.localUUID)).size!==items.length)throw Error('Invalid exact batch');
  const row=await env.DB.prepare('SELECT body,deleted FROM work_batches WHERE date=?').bind(date).first();if(!row||row.deleted)throw Error('Saved board required');const board=JSON.parse(row.body);
  for(const p of items){if(!/^[-a-f0-9]{36}$/.test(p.localUUID)||!/^\d{9,15}$/.test(p.reference)||!/^\d+$/.test(String(p.US?.categoryId))||!/^\d+$/.test(String(p.US?.storeCategoryId)))throw Error('Invalid exact package identity/category');const rows=board.groups.flatMap(g=>g.items).filter(r=>r.id===p.localUUID);if(rows.length!==1||rows[0].itemNumber!==p.reference||Number(rows[0].price)!==Number(p.priceUSD)||rows[0].shippingPolicy!==p.shippingPolicyInput||!Number.isFinite(Number(p.priceUSD))||Number(p.priceUSD)<=0||!/^[A-Z0-9_-]+$/.test(p.partNumber)||!p.title?.startsWith('⭐Genuine ')||p.title.length>80||!p.descriptionHtml?.includes(p.title)||!Array.isArray(p.images)||!p.images.length||p.images.length>24||p.images.some(i=>!/^[a-f0-9]{64}$/.test(i.sha256))||!p.US?.categoryId||p.US.compatibilityFullRows.length!==p.US.compatibilityNotes.length)throw Error('Approved package/board scope mismatch');}
  await createRecord('run/'+run,{date,items,createdAt:Date.now()});return Response.json({ok:true,result:{run,date,itemCount:items.length}});
 }
 const run=input?.run??request.headers.get('x-exact-run'),saved=await getRecord('run/'+run);if(!saved)throw Error('Begin exact approved batch first');const {date,items}=saved;
 const assertBoard=async()=>{const row=await env.DB.prepare('SELECT body,deleted FROM work_batches WHERE date=?').bind(date).first();if(!row||row.deleted)throw Error('Board missing');const board=JSON.parse(row.body);for(const p of items){const r=board.groups.flatMap(g=>g.items).find(r=>r.id===p.localUUID);if(!r||r.itemNumber!==p.reference||Number(r.price)!==Number(p.priceUSD)||r.shippingPolicy!==p.shippingPolicyInput)throw Error('Board changed');}};
 const mutationClaim=async(item,market)=>{await assertBoard();await createRecord('mutation/'+date+'/'+market+'/'+item.localUUID,{run,market,itemId:item.localUUID,at:Date.now()});};
const shippingKey=(item,market)=>'EBAY_'+market+'_'+(item.shippingPolicyInput==='7day normal'?'NORMAL':'FAST')+'_POLICY_ID';

const x = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const required = k => { if (!env[k]) throw Error('Missing configuration: '+k); return env[k]; };
const hash = b => createHash('sha256').update(b).digest('hex');
const sign = value => ({value,mac:createHmac('sha256',required('EXECUTOR_RECEIPT_SECRET')).update(JSON.stringify(value)).digest('hex')});
function signed(receipt) {
  if (!receipt?.value || typeof receipt.mac!=='string' || receipt.mac.length!==64) throw Error('Missing signed receipt');
  const expected=sign(receipt.value).mac;
  if (!timingSafeEqual(Buffer.from(expected),Buffer.from(receipt.mac))) throw Error('Receipt signature mismatch');
  return receipt.value;
}
async function token(market) {
  const prefix='EBAY_'+market;
  const scope=['','/commerce.identity.readonly','/sell.inventory','/sell.account','/sell.stores','/sell.listing'].map(s=>'https://api.ebay.com/oauth/api_scope'+s).join(' ');
  const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{authorization:'Basic '+Buffer.from(required(prefix+'_CLIENT_ID')+':'+required(prefix+'_CLIENT_SECRET')).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:required(prefix+'_REFRESH_TOKEN'),scope})});
  const b=await r.json(); if(!r.ok||!b.access_token) throw Error('Token refresh failed');
  const identity=await fetch('https://apiz.ebay.com/commerce/identity/v1/user/',{headers:{authorization:'Bearer '+b.access_token}});
  const user=await identity.json();
  if(!identity.ok||user.username!==(market==='US'?'gandakorea':'sihooshop')||user.registrationMarketplaceId!=='EBAY_'+market) throw Error('Seller identity mismatch');
  return b.access_token;
}
async function trading(t,call,fields,market='US') {
  const r=await fetch('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'content-type':'text/xml; charset=utf-8','x-ebay-api-call-name':call,'x-ebay-api-siteid':market==='US'?'100':'15','x-ebay-api-compatibility-level':'1193','x-ebay-api-iaf-token':t},body:`<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>${fields}</${call}Request>`});
  const text=await r.text(); if(!r.ok||!/<Ack>(Success|Warning)<\/Ack>/.test(text)) throw Error(`${call}: ${[...text.matchAll(/<LongMessage>([\s\S]*?)<\/LongMessage>/g)].map(m=>m[1]).join(' | ') || r.status}`);
  return text;
}
async function json(t,path,method='GET',body,market='AU') {
  const r=await fetch('https://api.ebay.com'+path,{method,headers:{authorization:'Bearer '+t,'x-ebay-c-marketplace-id':'EBAY_'+market,'content-language':market==='US'?'en-US':'en-AU','accept-language':market==='US'?'en-US':'en-AU','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();const b=raw?JSON.parse(raw):{}; if(!r.ok) throw Error(`eBay ${method} ${r.status}: ${JSON.stringify(b.errors??[]).slice(0,1000)}`); return b;
}
async function photos(input,item,market) {
  if(!Array.isArray(input.receipts)||input.receipts.length!==item.images.length) throw Error('Photo count mismatch');
  const urls=input.receipts.map((r,i)=>{const p=signed(r); if(p.kind!=='photo'||p.ref!==item.reference||p.market!==market||p.index!==i||p.sha256!==item.images[i].sha256||!/^https:\/\/i\.ebayimg\.com\//.test(p.url)) throw Error('Photo receipt mismatch');return p.url;});for(let i=0;i<input.receipts.length;i++){const saved=await getRecord('photo/'+run+'/'+market+'/'+item.localUUID+'/'+i);if(JSON.stringify(saved)!==JSON.stringify(input.receipts[i]))throw Error('Unregistered EPS receipt');const photo=input.receipts[i].value;if(!Number.isFinite(Date.parse(photo.expirationDate))||Date.parse(photo.expirationDate)<=Date.now()+60000)throw Error('EPS receipt expired');}return urls;
}
function xmlValues(values) {return Object.entries(values).map(([name,vs])=>`<NameValueList><Name>${x(name)}</Name>${vs.map(v=>`<Value>${x(v)}</Value>`).join('')}</NameValueList>`).join('');}
function usFields(item,urls) {
  const p=item.US;
  const compat=p.compatibilityFullRows.map((row,i)=>`<Compatibility>${row.map(v=>`<NameValueList><Name>${x(v.name)}</Name>${v.values.map(s=>`<Value>${x(s)}</Value>`).join('')}</NameValueList>`).join('')}<CompatibilityNotes>${x(p.compatibilityNotes[i])}</CompatibilityNotes></Compatibility>`).join('');
  return `<Item><SKU>${x(item.partNumber+'-US-'+date.replaceAll('-','')+'-'+item.localUUID.slice(0,8))}</SKU><Title>${x(item.title)}</Title><Description><![CDATA[${item.descriptionHtml.replaceAll(']]>',']]]]><![CDATA[>')}]]></Description><PrimaryCategory><CategoryID>${p.categoryId}</CategoryID></PrimaryCategory><StartPrice currencyID="USD">${item.priceUSD}</StartPrice><CategoryMappingAllowed>true</CategoryMappingAllowed><ConditionID>1000</ConditionID><Country>KR</Country><Location>Seoul, South Korea</Location><Site>eBayMotors</Site><Currency>USD</Currency><DispatchTimeMax>3</DispatchTimeMax><ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType><Quantity>5</Quantity><PictureDetails>${urls.map(u=>`<PictureURL>${x(u)}</PictureURL>`).join('')}</PictureDetails><SellerProfiles><SellerPaymentProfile><PaymentProfileID>${required('EBAY_US_PAYMENT_POLICY_ID')}</PaymentProfileID></SellerPaymentProfile><SellerReturnProfile><ReturnProfileID>${required('EBAY_US_RETURN_POLICY_ID')}</ReturnProfileID></SellerReturnProfile><SellerShippingProfile><ShippingProfileID>${required(shippingKey(item,'US'))}</ShippingProfileID></SellerShippingProfile></SellerProfiles><ItemSpecifics>${xmlValues(item.itemSpecifics)}</ItemSpecifics><ItemCompatibilityList>${compat}</ItemCompatibilityList><Storefront><StoreCategoryID>${p.storeCategoryId}</StoreCategoryID>${p.storeCategory2Id?`<StoreCategory2ID>${p.storeCategory2Id}</StoreCategory2ID>`:''}</Storefront></Item>`;
}
async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method!=='POST'||req.headers.authorization!=='Bearer '+required('AUTOMATION_ADMIN_SECRET')) {res.statusCode=401;return res.end('Unauthorized');}

    const buffers=[]; let size=0; for await(const c of req){size+=c.length;if(size>4*1024*1024) throw Error('Request too large');buffers.push(c);} const raw=Buffer.concat(buffers);
    const binary=req.headers['content-type']==='application/octet-stream';
    const input=binary?{action:'upload',ref:req.headers['x-exact-ref'],market:req.headers['x-exact-market'],index:Number(req.headers['x-exact-index']),itemId:req.headers['x-exact-item-id']}:JSON.parse(raw.toString());
    const market=input.market; if(!['US','AU'].includes(market)) throw Error('Invalid marketplace');
    const item=items.find(i=>i.reference===input.ref && (!input.itemId || i.localUUID===input.itemId)); if(!item) throw Error('Outside requested final3 scope');
    if(items.filter(i=>i.reference===input.ref).length>1&&!input.itemId)throw Error('Exact item UUID required');await assertBoard();if(market==='AU')for(const target of items)if(!(await getRecord('qa/'+run+'/US/'+target.localUUID))?.passed)throw Error('Complete US batch public/API QA before AU');const t=await token(market); let result;
    if(input.action==='identity') result={seller:market==='US'?'gandakorea':'sihooshop',marketplace:'EBAY_'+market};
    else if(input.action==='policy') result=await json(t,'/sell/account/v1/fulfillment_policy/'+required(shippingKey(item,market)),'GET',undefined,market);
    else if(input.action==='store') result={xml:await trading(t,'GetStore','<CategoryStructureOnly>true</CategoryStructureOnly>',market)};
    else if(input.action==='ensureAUStoreCategory') {
      if(market!=='AU'||!/^\d+$/.test(input.parentCategoryId))throw Error('AU store parent required');
      const makes=[...new Set(item.US.compatibilityFullRows.flatMap(row=>row.filter(v=>v.name==='Make').flatMap(v=>v.values)))];if(makes.length!==1)throw Error('Exact source make required');
      const xml=await trading(t,'GetStore','<CategoryStructureOnly>true</CategoryStructureOnly>',market);
      const parent=[...xml.matchAll(/<CustomCategory>([\s\S]*?)<\/CustomCategory>/g)].find(m=>m[1].startsWith(`<CategoryID>${input.parentCategoryId}</CategoryID><Name>${x(makes[0])}</Name>`));if(!parent)throw Error('Actual store parent/make mismatch');
      const child=[...parent[1].matchAll(/<ChildCategory><CategoryID>(\d+)<\/CategoryID><Name>([^<]+)<\/Name>/g)].find(m=>m[2].toUpperCase()===x(item.storeModel).toUpperCase());
      if(child)result={created:false,categoryId:child[1],xml};
      else {await createRecord('store-category-attempt/AU/'+input.parentCategoryId+'/'+item.storeModel,{run,at:Date.now()});const updateXML=await trading(t,'SetStoreCategories',`<Action>Add</Action><DestinationParentCategoryID>${input.parentCategoryId}</DestinationParentCategoryID><StoreCategories><CustomCategory><Name>${x(item.storeModel)}</Name></CustomCategory></StoreCategories>`,market);result={created:true,updateXML,xml:await trading(t,'GetStore','<CategoryStructureOnly>true</CategoryStructureOnly>',market)};}
    }
    else if(input.action==='upload') {
      const i=input.index;if(!Number.isInteger(i)||i<0||i>=item.images.length||hash(raw)!==item.images[i].sha256||raw.toString('hex',0,8)!=='89504e470d0a1a0a'||raw.readUInt32BE(16)!==1000||raw.readUInt32BE(20)!==1000) throw Error('Unapproved image');
      await createRecord('upload-attempt/'+run+'/'+market+'/'+item.localUUID+'/'+i,{attemptedAt:Date.now(),sha256:hash(raw)});const form=new FormData();form.append('image',new Blob([raw],{type:'image/png'}),item.partNumber+(i?'_'+i:'')+'.png');
      const r=await fetch('https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file',{method:'POST',headers:{authorization:'Bearer '+t,accept:'application/json'},body:form});
      const b=await r.json();const url=b.imageUrl;const asset=u=>{const v=new URL(u);if(v.protocol!=='https:'||v.hostname!=='i.ebayimg.com'||v.port||v.username||v.password)throw Error('EPS host mismatch');return v.pathname.match(/\/(?:g|z)\/([^/]+)/)?.[1];};if(!url||!b.maxDimensionImageUrl||!asset(url)||asset(url)!==asset(b.maxDimensionImageUrl))throw Error('EPS asset mismatch');if(r.status!==201||!url||!/^https:\/\/i\.ebayimg\.com\//.test(url)||!b.maxDimensionImageUrl||!Number.isFinite(Date.parse(b.expirationDate))||Date.parse(b.expirationDate)<=Date.now()+60000) throw Error('EPS upload failed');
      result=sign({kind:'photo',ref:item.reference,market,index:i,sha256:hash(raw),url,maxDimensionImageUrl:b.maxDimensionImageUrl,expirationDate:b.expirationDate,at:new Date().toISOString()});await createRecord('photo/'+run+'/'+market+'/'+item.localUUID+'/'+i,result);
    }
    else if(input.action==='verifyUS'||input.action==='publishUS') {
      if(market!=='US') throw Error('US action mismatch');const urls=await photos(input,item,market);const fields=usFields(item,urls);const requestHash=hash(fields);
      if(input.action==='publishUS') {const v=signed(input.verification);if(v.kind!=='verifiedUS'||v.ref!==item.reference||v.requestHash!==requestHash||Date.now()-v.at>60*60*1000) throw Error('Fresh VerifyAdd receipt required');}
      if(input.action==='publishUS')await mutationClaim(item,market);const xml=await trading(t,input.action==='verifyUS'?'VerifyAddFixedPriceItem':'AddFixedPriceItem',fields);
      if(input.action==='verifyUS') result={xml,verification:sign({kind:'verifiedUS',ref:item.reference,requestHash,at:Date.now()})};
      else {const id=xml.match(/<ItemID>(\d+)<\/ItemID>/)?.[1];if(!id) throw Error('Publication returned no ID');result={xml,publication:sign({kind:'published',ref:item.reference,market,listingId:id,at:Date.now()})};}
    }
    else if(input.action==='read') {
      const p=signed(input.publication);if(p.kind!=='published'||p.ref!==item.reference||p.market!==market) throw Error('Readback receipt mismatch');
      result={xml:await trading(t,'GetItem',`<ItemID>${p.listingId}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>`,market)};
    }
    else if(input.action==='prepareAU') {
      if(market!=='AU') throw Error('AU mismatch');
      const suggest=await json(t,'/commerce/taxonomy/v1/category_tree/15/get_category_suggestions?q='+encodeURIComponent(item.taxonomyQuery));
      const location=await json(t,'/sell/inventory/v1/location/'+encodeURIComponent(required('EBAY_AU_MERCHANT_LOCATION_KEY')));
      const rateResponse=await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD');const rate=await rateResponse.json();if(!rateResponse.ok||!Number.isFinite(rate.rates?.AUD)) throw Error('AUD rate unavailable');
      result={suggest,location,rate};
    }
    else if(input.action==='auCatalog') {
      if(market!=='AU'||!/^\d{3,10}$/.test(input.categoryId)) throw Error('AU catalog scope mismatch');
      result=await json(t,'/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values','POST',{categoryId:input.categoryId,propertyFilters:[{propertyName:'Make',propertyValue:item.storeModel==='G80'?'Genesis':item.storeModel==='Sedona'?'Kia':'Hyundai'},{propertyName:'Model',propertyValue:item.storeModel}],propertyNames:['Year','Make','Model','Submodel','Variant','Engine']});
    }
    else if(input.action==='auStatus') {
 const sku=item.partNumber+'-AU-'+date.replaceAll('-','')+'-'+item.localUUID.slice(0,8);result={inventory:await json(t,'/sell/inventory/v1/inventory_item/'+encodeURIComponent(sku)),offers:await json(t,'/sell/inventory/v1/offer?sku='+encodeURIComponent(sku)+'&marketplace_id=EBAY_AU')};
 }
 else if(input.action==='publishAU') {
      if(market!=='AU'||!Array.isArray(input.usPublications)||input.usPublications.length!==items.length) throw Error('US batch evidence required');
      for(let i=0;i<items.length;i++){const u=signed(input.usPublications[i]);if(u.kind!=='published'||u.market!=='US'||u.ref!==items[i].reference) throw Error('US batch mismatch');}
      const urls=await photos(input,item,market);
      const prep=signed(input.preparation);if(prep.kind!=='preparedAU'||prep.ref!==item.reference||Date.now()-prep.at>60*60*1000) throw Error('Fresh AU preparation required');
      await mutationClaim(item,market);const sku=item.partNumber+'-AU-'+date.replaceAll('-','')+'-'+item.localUUID.slice(0,8),base='/sell/inventory/v1/inventory_item/'+encodeURIComponent(sku);
      const aspects={...item.itemSpecifics,Brand:['Genuine Hyundai Mobis'],'Manufacturer Part Number':item.itemSpecifics['Manufacturer Part Number']};
      await json(t,base,'PUT',{availability:{shipToLocationAvailability:{quantity:5}},condition:'NEW',product:{title:item.title,brand:'Genuine Hyundai Mobis',mpn:item.itemSpecifics['Manufacturer Part Number'].join(', '),imageUrls:urls,aspects}});
      const offer=await json(t,'/sell/inventory/v1/offer','POST',{sku,marketplaceId:'EBAY_AU',format:'FIXED_PRICE',availableQuantity:5,categoryId:prep.categoryId,merchantLocationKey:required('EBAY_AU_MERCHANT_LOCATION_KEY'),listingDescription:item.descriptionHtml,listingPolicies:{paymentPolicyId:required('EBAY_AU_PAYMENT_POLICY_ID'),returnPolicyId:required('EBAY_AU_RETURN_POLICY_ID'),fulfillmentPolicyId:required(shippingKey(item,'AU'))},pricingSummary:{price:{value:prep.price,currency:'AUD'}},storeCategoryNames:[prep.storeCategory],listingDuration:'GTC',includeCatalogProductDetails:false});
      const published=await json(t,'/sell/inventory/v1/offer/'+encodeURIComponent(offer.offerId)+'/publish','POST',{});
      if(!/^\d{9,15}$/.test(String(published.listingId))) throw Error('AU publication returned no ID');
      result={offerId:offer.offerId,price:prep.price,publication:sign({kind:'published',ref:item.reference,market,listingId:String(published.listingId),at:Date.now()})};
    }
    else if(input.action==='approveAUPreparation') {
      if(market!=='AU'||!/^\d{3,10}$/.test(input.categoryId)||typeof input.storeCategory!=='string'||!input.storeCategory.toUpperCase().endsWith('/'+item.storeModel.toUpperCase())) throw Error('AU preparation mismatch');
      const r=await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD');const b=await r.json();if(!r.ok||!Number.isFinite(b.rates?.AUD)) throw Error('Rate failed');
      result=sign({kind:'preparedAU',ref:item.reference,categoryId:input.categoryId,storeCategory:input.storeCategory,price:(Number(item.priceUSD)*b.rates.AUD).toFixed(2),rate:b.rates.AUD,rateDate:b.date,at:Date.now()});
    }
    else if(input.action==='qa'){const pub=await getRecord('published/'+run+'/'+market+'/'+item.localUUID);if(!pub||input.listingId!==pub.publication.value.listingId||input.publicGalleryVerified!==true||input.vinVerified!==true||input.apiVerified!==true||!/^([a-f0-9]{64})$/.test(input.evidenceSHA256??''))throw Error('Exact complete local QA evidence required');const raw=await trading(t,'GetItem',`<ItemID>${input.listingId}</ItemID><DetailLevel>ReturnAll</DetailLevel>`,market);if(!raw.includes(`<UserID>${market==='US'?'gandakorea':'sihooshop'}</UserID>`)||!raw.includes('<ListingStatus>Active</ListingStatus>'))throw Error('QA listing mismatch');result={passed:true,listingId:input.listingId,at:Date.now(),evidenceSHA256:input.evidenceSHA256};await createRecord('qa/'+run+'/'+market+'/'+item.localUUID,result);}else if(input.action==='status')result={publication:await getRecord('published/'+run+'/'+market+'/'+item.localUUID),attempt:await getRecord('mutation/'+date+'/'+market+'/'+item.localUUID),qa:await getRecord('qa/'+run+'/'+market+'/'+item.localUUID)};else throw Error('Unknown operation');
    if(result?.publication)await createRecord('published/'+run+'/'+market+'/'+item.localUUID,result);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,result}));
  } catch(e) {res.statusCode=422;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:e instanceof Error?e.message:'Exact2 failed'}));}
}

 const req={method:request.method,headers:Object.fromEntries(request.headers),async *[Symbol.asyncIterator](){yield raw;}};
 let status=200,content='';const res={setHeader(){},set statusCode(n){status=n;},end(s){content=s;}};
 await handler(req,res);return new Response(content,{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 }catch{return Response.json({ok:false,error:'Executor rejected; inspect exact local receipts and status; no blind retry'},{status:422});}
}

function readOnly(env){const required=k=>{if(!env[k])throw Error('Missing configuration');return env[k];};const x=s=>String(s);async function token(market) {
  const prefix='EBAY_'+market;
  const scope=['','/commerce.identity.readonly','/sell.inventory','/sell.account','/sell.stores','/sell.listing'].map(s=>'https://api.ebay.com/oauth/api_scope'+s).join(' ');
  const r=await fetch('https://api.ebay.com/identity/v1/oauth2/token',{method:'POST',headers:{authorization:'Basic '+Buffer.from(required(prefix+'_CLIENT_ID')+':'+required(prefix+'_CLIENT_SECRET')).toString('base64'),'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:required(prefix+'_REFRESH_TOKEN'),scope})});
  const b=await r.json(); if(!r.ok||!b.access_token) throw Error('Token refresh failed');
  const identity=await fetch('https://apiz.ebay.com/commerce/identity/v1/user/',{headers:{authorization:'Bearer '+b.access_token}});
  const user=await identity.json();
  if(!identity.ok||user.username!==(market==='US'?'gandakorea':'sihooshop')||user.registrationMarketplaceId!=='EBAY_'+market) throw Error('Seller identity mismatch');
  return b.access_token;
}
async function trading(t,call,fields,market='US') {
  const r=await fetch('https://api.ebay.com/ws/api.dll',{method:'POST',headers:{'content-type':'text/xml; charset=utf-8','x-ebay-api-call-name':call,'x-ebay-api-siteid':market==='US'?'100':'15','x-ebay-api-compatibility-level':'1193','x-ebay-api-iaf-token':t},body:`<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents"><ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>${fields}</${call}Request>`});
  const text=await r.text(); if(!r.ok||!/<Ack>(Success|Warning)<\/Ack>/.test(text)) throw Error(`${call}: ${[...text.matchAll(/<LongMessage>([\s\S]*?)<\/LongMessage>/g)].map(m=>m[1]).join(' | ') || r.status}`);
  return text;
}
async function json(t,path,method='GET',body,market='AU') {
  const r=await fetch('https://api.ebay.com'+path,{method,headers:{authorization:'Bearer '+t,'x-ebay-c-marketplace-id':'EBAY_'+market,'content-language':market==='US'?'en-US':'en-AU','accept-language':market==='US'?'en-US':'en-AU','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await r.text();const b=raw?JSON.parse(raw):{}; if(!r.ok) throw Error(`eBay ${method} ${r.status}: ${JSON.stringify(b.errors??[]).slice(0,1000)}`); return b;
}
;return {token,trading};}
async function identityOnly(env,market){await readOnly(env).token(market);return {seller:market==='US'?'gandakorea':'sihooshop',marketplace:'EBAY_'+market};}
async function referenceOnly(env,id,market){if(!['US','AU'].includes(market))throw Error('Invalid marketplace');const h=readOnly(env),t=await h.token(market);const xml=await h.trading(t,'GetItem',`<ItemID>${id}</ItemID><DetailLevel>ReturnAll</DetailLevel><IncludeItemSpecifics>true</IncludeItemSpecifics><IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>`,market);return Response.json({ok:true,result:{xml}});}
