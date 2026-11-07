import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
if(process.env.V5_DATA_DIR){process.env.XDG_CACHE_HOME=path.join(process.env.V5_DATA_DIR,'font-cache');mkdirSync(process.env.XDG_CACHE_HOME,{recursive:true});}
process.env.FONTCONFIG_FILE ||= fileURLToPath(new URL('./fonts/fonts.conf',import.meta.url));
import sharp from 'sharp';
import QRCode from 'qrcode';
import {fail} from './print-model.mjs';
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const money=n=>'THB '+(Number(n||0)/100).toFixed(2);
const segmenter=new Intl.Segmenter('th',{granularity:'grapheme'});
export function wrap(text,limit){const lines=[];for(const part of String(text??'').split('\n')){let line='';for(const {segment} of segmenter.segment(part)){if([...segmenter.segment(line)].length>=limit){lines.push(line);line='';}line+=segment;}lines.push(line);}return lines;}
export async function renderDocument(document,assets={}){
 const t=document.template,o=document.order,p=t.purpose,label=p.endsWith('label'),width=Math.round(t.width*8),font=t.fontSize,margin=16,lineHeight=Math.ceil(font*1.5),nodes=[];let y=margin;
 const preset=['promotional','minimalist','editorial'].includes(t.stylePreset)?t.stylePreset:'editorial';
 const sizeFor=function(scale){return Math.max(8,Math.min(48,Math.round(font*(scale||1))))};
 const text=function(value,align,size,bold,indent,family){
  size=size||font;align=align||'left';indent=indent||0;
  const limit=Math.max(5,Math.floor((width-margin*2-indent)/(size*.68)));
  for(const line of wrap(value,limit)){
   y+=Math.ceil(size*1.45);
   const x=align==='center'?width/2:align==='right'?width-margin:margin+indent;
   const anchor=align==='center'?'middle':align==='right'?'end':'start';
   nodes.push('<text x="'+x+'" y="'+y+'" font-size="'+size+'" font-weight="'+(bold?700:400)+'" text-anchor="'+anchor+'"'+(family?' font-family="'+xml(family)+'"':'')+'>'+xml(line)+'</text>');
  }
 };
 const receipt=['customer','payment','delivery'].includes(p);
 const centered=function(value,scale,bold){text(value,receipt?'center':'left',sizeFor(scale||1),bold!==false,0)};
 const rule=function(){
  y+=Math.ceil(lineHeight*.6);
  nodes.push(preset==='minimalist'
   ? '<line x1="'+margin+'" x2="'+(width-margin)+'" y1="'+y+'" y2="'+y+'" stroke="#555" stroke-width="1"/>'
   : '<line x1="'+margin+'" x2="'+(width-margin)+'" y1="'+y+'" y2="'+y+'" stroke="#222" stroke-width="'+(preset==='promotional'?1.5:1)+'"'+(preset==='editorial'?' stroke-dasharray="5 4"':'')+'/>');
  y+=Math.ceil(lineHeight*.45);
 };
 const amount=function(labelText,value,strong){
  y+=lineHeight*1.25;const size=strong?sizeFor(1.15):font;
  nodes.push('<text x="'+margin+'" y="'+y+'" font-size="'+size+'" font-weight="'+(strong?700:400)+'">'+xml(labelText)+'</text><text x="'+(width-margin)+'" y="'+y+'" font-size="'+size+'" font-weight="'+(strong?700:400)+'" text-anchor="end">'+xml(value)+'</text>');
 };
 const hero=function(value,scale,boxed,editorial){
  const size=sizeFor(scale||1.5),limit=Math.max(4,Math.floor((width-margin*2-20)/(size*(editorial?.63:.66))));
  const lines=wrap(value,limit),leading=Math.ceil(size*(editorial?1.24:1.28)),pad=editorial?8:12;
  if(boxed){const h=lines.length*leading+pad*2;y+=pad;nodes.push('<rect x="'+(margin+8)+'" y="'+(y-size)+'" width="'+(width-2*(margin+8))+'" height="'+h+'" fill="none" stroke="#000" stroke-width="2"/>');}
  for(const line of lines){y+=leading;nodes.push('<text x="'+(width/2)+'" y="'+y+'" font-size="'+size+'" font-weight="'+(editorial?700:900)+'" text-anchor="middle"'+(editorial?' font-family="Noto Serif Thai, Noto Serif, Georgia, serif" letter-spacing="1"':'')+'>'+xml(line)+'</text>');}
  if(boxed)y+=pad;
 };
 const image=function(data,w,h){nodes.push('<image x="'+Math.round((width-w)/2)+'" y="'+y+'" width="'+w+'" height="'+h+'" href="'+xml(data)+'"/>');y+=h+8};
 const logoSize=['small','medium','large'].includes(t.logoSize)?t.logoSize:'small';
 if(t.logoAsset&&assets[t.logoAsset]){
  const a=assets[t.logoAsset],fraction={small:.16,medium:.22,large:.28}[logoSize],w=Math.min(width*fraction,90),h=Math.max(1,w*a.height/a.width);image(a.data,w,h);
 }
 if(t.businessName)centered(t.businessName,preset==='minimalist'?1.15:preset==='promotional'?1.55:1.7,true);
 if(!label){for(const k of ['address','phone','taxId'])if(t[k])centered(t[k],.82,false);if(t.header){rule();if(preset==='promotional')hero(t.header,1.8,true,false);else if(preset==='editorial')hero(t.header,1.7,false,true);else centered(t.header,1.2,true);}rule();}
 if(document.reprint)centered('REPRINT · '+document.reprint,.9,true);
 if(document.void)centered('VOID — DO NOT PACK',1.05,true);
 const externalRef=String(o.partner_reference||'').trim(),internalRef=String(o.receipt_number==null?'':o.receipt_number).trim();
 const delivery=!!externalRef;
 if(t.showOrderType!==false)centered(delivery?String(o.channel_id||'DELIVERY').toUpperCase()+' ORDER':p==='payment'?'PAYMENT REQUEST':p==='summary_label'?'ORDER SUMMARY':p==='package_label'?'PACKAGE LABEL':'ORDER NUMBER',.9,true);
 centered(externalRef||internalRef||'—',preset==='minimalist'?2.05:2.5,true);
 if(externalRef&&internalRef&&t.showInternalReceiptNumber!==false)centered('Receipt #'+internalRef,.82,false);
 if(p==='payment')centered('UNPAID',1.05,true);
 centered(o.channel_id||o.mode||'',.82,false);
 if(t.showTime)centered(new Intl.DateTimeFormat('en-GB',{timeZone:t.timezone||'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}).format(new Date(o.created_at)),.82,false);
 if(label)centered('Batch '+String(document.batchId||'PREVIEW').slice(0,8)+' · Revision '+document.revision,.82,false);
 if(document.unit){
  centered('Package '+document.sequence+' of '+document.packageCount,.95,true);centered(document.unit.quantity+' × '+document.unit.name,1,true);
  if(document.unit.parent!==document.unit.name)centered(document.unit.parent,.9,false);
  if(t.showModifiers)for(const m of document.unit.modifiers||[])centered('+ '+m.name+(m.quantity>1?' ×'+m.quantity:''),.9,false);
  if(document.unit.instructions)centered(document.unit.instructions,.9,true);
 }else if(['packing','kitchen','summary_label'].includes(p)){
  for(const line of document.packing.lines){centered((t.checkboxes?'□ ':'')+line.quantity+' × '+line.name,.95,true);for(const c of line.components)if(c.name!==line.name||line.components.length>1)centered((t.componentBoxes?'□ ':'')+c.quantity+' × '+c.name,.9,false);if(t.showModifiers)for(const m of line.modifiers)centered('+ '+m.name+(m.quantity>1?' ×'+m.quantity:''),.9,false);if(line.instructions)centered(line.instructions,.9,true);}
  if(p!=='kitchen')centered('Packages: '+document.packageCount,.9,true);
 }else{
  for(const item of o.items){
   const mods=t.showModifiers?(item.modifiers||[]):[];
   const modTotal=mods.reduce((sum,m)=>sum+Number(m.priceMinor==null?(m.price||0):m.priceMinor)*Number(m.quantity||1),0);
   const gross=Number(item.price||0)*Number(item.quantity||1),base=Math.max(0,gross-modTotal*Number(item.quantity||1));
   const row=function(name,price,indent,bold){y+=lineHeight*1.35;nodes.push('<text x="'+(margin+(indent||0))+'" y="'+y+'" font-size="'+font+'" font-weight="'+(bold?700:500)+'">'+xml(name)+'</text><text x="'+(width-margin)+'" y="'+y+'" font-size="'+font+'" font-weight="'+(bold?700:400)+'" text-anchor="end">'+xml(price)+'</text>')};
   row(Number(item.quantity||1)+' × '+item.name,money(base),0,true);
   for(const m of mods){const q=Number(m.quantity||1),price=Number(m.priceMinor==null?(m.price||0):m.priceMinor)*q*Number(item.quantity||1);row('+ '+m.name+(q>1?' ×'+q:''),price?money(price):'',12,false);}
   if(item.instructions)centered(item.instructions,.82,false);
   if(Number(item.partner_discount||0)>0)row('Item discount','−'+money(item.partner_discount),12,false);
   if(mods.length)row('Item total',money(gross),12,true);
   y+=Math.ceil(lineHeight*.35);
  }
  rule();amount('Subtotal',money(o.subtotal));
  const itemDiscount=Number(o.partner_item_discount||0);
  const orderDiscount=delivery?Number(o.partner_order_discount==null?Math.max(0,Number(o.discount_total||0)-itemDiscount):o.partner_order_discount):Number(o.discount_total||0);
  if(itemDiscount)amount('Item discounts','−'+money(itemDiscount));
  if(orderDiscount)amount(delivery?'Order discount':'Discount','−'+money(orderDiscount));
  if(o.tax)amount('Tax',money(o.tax));
  rule();amount(p==='payment'?'AMOUNT DUE':'TOTAL',money(Number(o.total||0)-Number(o.discount_total||0)),true);rule();
  if(o.refund_total){centered('Refunded −'+money(o.refund_total),.95,false);centered('Net sale '+money(Number(o.total||0)-Number(o.discount_total||0)-Number(o.refund_total)),1.05,true);}
  if(p!=='payment'&&t.showPayment!==false)centered('Payment: '+(o.payment_method||'—'),.9,false);
  if(o.payment_method==='Cash'&&t.showCashDetails!==false){centered('Received '+money(o.received),.9,false);centered('Change '+money(o.change_due),.9,false);}
 }
 if(t.signoff){if(p==='packing')centered('□ Food  □ Drinks  □ Order  □ Sealed',.9,false);centered('Packed by __________',.9,false);centered('Time __________',.9,false);}
 if(t.checker)centered('Checked by __________',.9,false);
 if(p==='payment'&&t.paymentAsset&&assets[t.paymentAsset]){rule();centered('PAYMENT QR · Verify payment manually',.9,true);const a=assets[t.paymentAsset],size=Math.min(width-32,220);image(a.data,size,size);}
 const date=o.created_at,url=String(t.marketingUrl||'').trim(),marketing=url&&(!t.qrChannels||!t.qrChannels.length||t.qrChannels.includes(o.channel_id))&&(!t.campaignStart||date>=t.campaignStart)&&(!t.campaignEnd||date<=t.campaignEnd)&&p!=='payment';
 const safeUrl=url?(/^[a-z][a-z\d+.-]*:/i.test(url)?url:'https://'+url):'';
 const qrValue=label&&t.packageQr?JSON.stringify({order:o.id,batch:document.batchId||'preview',revision:document.revision,unit:document.unit?document.unit.id:'summary'}):marketing?safeUrl:'';
 if(marketing){rule();if(preset==='promotional')hero(t.marketingCaption||'THANK YOU · COME BACK SOON',1.35,true,false);else if(preset==='editorial')hero(t.marketingCaption||'THANK YOU · COME BACK SOON',1.25,false,true);else centered(t.marketingCaption||'THANK YOU · COME BACK SOON',1.05,true);}
 if(qrValue){const size=Math.min(width-32,{small:160,medium:200,large:240}[t.qrSize]||200);const data=await QRCode.toDataURL(qrValue,{errorCorrectionLevel:'M',margin:4,width:size,color:{dark:'#000000',light:'#ffffff'}});image(data,size,size);if(label)centered('Package verification',.82,false);}
 if(!label&&t.footer){rule();if(preset==='promotional')hero(t.footer,1.45,false,false);else if(preset==='editorial')hero(t.footer,1.35,false,true);else centered(t.footer,1.1,true);}
 y+=margin;const height=label?Math.round(t.height*8):y;
 if(y>height)fail(422,'Content exceeds this label. Choose larger media or reduce text and optional fields.');
 if(height>16000)fail(422,'Receipt is too long for one print job.');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Noto Sans Thai,DejaVu Sans,sans-serif">'+nodes.join('')+'</g></svg>';
 const png=await sharp(Buffer.from(svg)).flatten({background:'#fff'}).png().toBuffer();
 return {width,height,png,svg};
}
export async function encodeDocument(document,profile,assets={}){
 const r=await renderDocument(document,assets);const width=profile.language==='escpos'?(profile.width===58?384:576):Math.round(document.template.width*profile.dpi/25.4/8)*8,height=Math.round(r.height*width/r.width);
 if(document.template.width>profile.width||document.template.purpose.endsWith('label')&&document.template.height!==profile.height)fail(409,'Template dimensions do not match this printer media.');
 const raw=await sharp(r.png).resize(width,height).flatten({background:'#fff'}).greyscale().threshold(160).raw().toBuffer();const row=width/8,bits=Buffer.alloc(row*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(raw[y*width+x]<128)bits[y*row+(x>>3)]|=128>>(x%8);
 if(profile.language==='escpos'){if(document.template.purpose.endsWith('label'))fail(409,'Use a label printer for adhesive labels.');const chunks=[Buffer.from([27,64])];for(let y=0;y<height;y+=256){const h=Math.min(256,height-y);chunks.push(Buffer.from([29,118,48,0,row%256,row>>8,h%256,h>>8]),bits.subarray(y*row,(y+h)*row));}chunks.push(Buffer.from([10,10]));if(profile.cutter)chunks.push(Buffer.from([29,86,0]));return Buffer.concat(chunks);}
 if(!document.template.purpose.endsWith('label'))fail(409,'Use a receipt printer for this document.');
 if(profile.language==='zpl')return Buffer.from(`^XA^PW${width}^LL${height}^FO0,0^GFA,${bits.length},${bits.length},${row},${bits.toString('hex').toUpperCase()}^FS^XZ`);
 if(profile.language==='tspl')return Buffer.concat([Buffer.from(`SIZE ${profile.width} mm,${profile.height} mm\r\n${profile.media==='black-mark'?'BLINE':'GAP'} ${profile.gap||2} mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${row},${height},0,`),Buffer.from(bits.map(b=>255-b)),Buffer.from('\r\nPRINT 1,1\r\n')]);
 fail(400,'Select a supported print language.');
}
export async function normalizeAsset(data){if(typeof data!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(data)||data.length>1400000)fail(400,'Upload a JPG, PNG or WebP smaller than 1 MB.');let img,meta;try{img=sharp(Buffer.from(data.split(',')[1],'base64'),{limitInputPixels:16000000});meta=await img.metadata();}catch{fail(400,'This image could not be read.');}if(!['png','jpeg','webp'].includes(meta.format)||!meta.width||!meta.height||meta.pages>1)fail(400,'Use a single JPG, PNG or WebP image.');const {data:png,info}=await img.rotate().resize({width:600,height:600,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).greyscale().png().toBuffer({resolveWithObject:true});return{data:'data:image/png;base64,'+png.toString('base64'),width:info.width,height:info.height};}
