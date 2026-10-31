import {fileURLToPath} from 'node:url';
process.env.FONTCONFIG_FILE ||= fileURLToPath(new URL('./fonts/fonts.conf',import.meta.url));
import sharp from 'sharp';
import QRCode from 'qrcode';
import {fail} from './print-model.mjs';
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const money=n=>'THB '+(Number(n||0)/100).toFixed(2);
const segmenter=new Intl.Segmenter('th',{granularity:'grapheme'});
export function wrap(text,limit){const lines=[];for(const part of String(text??'').split('\n')){let line='';for(const {segment} of segmenter.segment(part)){if([...segmenter.segment(line)].length>=limit){lines.push(line);line='';}line+=segment;}lines.push(line);}return lines;}
export async function renderDocument(document,assets={}){
 const t=document.template,o=document.order,p=t.purpose,label=p.endsWith('label'),width=Math.round(t.width*8),font=t.fontSize,margin=16,lineHeight=Math.ceil(font*1.55),nodes=[];let y=margin;
 const text=(s,bold=false,indent=0)=>{for(const l of wrap(s,Math.max(6,Math.floor((width-margin*2-indent)/(font*.7))))){y+=lineHeight;nodes.push(`<text x="${margin+indent}" y="${y}" font-size="${font}" font-weight="${bold?700:400}">${xml(l)}</text>`);}};
 const image=(data,w,h,position='center')=>{nodes.push(`<image x="${position==='left'?margin:position==='right'?width-margin-w:Math.round((width-w)/2)}" y="${y}" width="${w}" height="${h}" href="${xml(data)}"/>`);y+=h+8;};
 if(t.logoAsset&&assets[t.logoAsset]){const a=assets[t.logoAsset],w=Math.min(width*.42,150),h=w*a.height/a.width;image(a.data,w,h,t.logoPosition);}
 if(t.businessName)text(t.businessName,true);
 if(!label){for(const k of ['address','phone','taxId','header'])if(t[k])text(t[k]);}
 if(document.reprint)text('REPRINT · '+document.reprint,true);
 if(document.void)text('VOID — DO NOT PACK',true);
 text((p==='payment'?'UNPAID PAYMENT REQUEST':p==='summary_label'?'ORDER SUMMARY':p==='package_label'?'PACKAGE LABEL':p.toUpperCase())+' #'+o.receipt_number,true);
 if(o.partner_reference)text(o.partner_reference,true);
 text(o.channel_id||o.mode||'');
 if(t.showTime)text(new Intl.DateTimeFormat('en-GB',{timeZone:t.timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(o.created_at)));
 if(label)text(`Batch ${String(document.batchId||'PREVIEW').slice(0,8)} · Revision ${document.revision}`);
 if(document.unit){text(`Package ${document.sequence} of ${document.packageCount}`,true);text(document.unit.quantity+' × '+document.unit.name,true);if(document.unit.parent!==document.unit.name)text(document.unit.parent);if(t.showModifiers)for(const m of document.unit.modifiers)text('+ '+m.name+(m.quantity>1?' ×'+m.quantity:''));if(document.unit.instructions)text(document.unit.instructions,true);}
 else if(['packing','kitchen','summary_label'].includes(p)){
 for(const line of document.packing.lines){text((t.checkboxes?'□ ':'')+line.quantity+' × '+line.name,true);for(const c of line.components)if(c.name!==line.name||line.components.length>1)text((t.componentBoxes?'□ ':'')+c.quantity+' × '+c.name,false,12);if(t.showModifiers)for(const m of line.modifiers)text('+ '+m.name+(m.quantity>1?' ×'+m.quantity:''),false,12);if(line.instructions)text(line.instructions,true,12);}
 if(p!=='kitchen')text('Packages: '+document.packageCount,true);
 }else{
 for(const item of o.items){text((t.checkboxes?'□ ':'')+item.quantity+' × '+item.name,true);text(money(item.price*item.quantity),false,10);if(item.partner_discount)text('Item discount −'+money(item.partner_discount),false,10);if(t.showModifiers)for(const m of item.modifiers||[])text('+ '+m.name+(m.quantity>1?' ×'+m.quantity:''),false,10);if(item.instructions)text(item.instructions,false,10);}
 text('Subtotal '+money(o.subtotal));if(o.partner_item_discount)text('Item discounts −'+money(o.partner_item_discount));const discount=o.partner_reference?o.partner_order_discount:o.discount_total;if(discount)text('Order discount −'+money(discount));if(o.tax)text('Tax '+money(o.tax));text((p==='payment'?'AMOUNT DUE ':'SALE TOTAL ')+money(o.total-o.discount_total),true);if(o.refund_total){text('Refunded −'+money(o.refund_total));text('Net sale '+money(o.total-o.discount_total-o.refund_total),true);}if(p!=='payment')text('Payment: '+o.payment_method);if(o.payment_method==='Cash'){text('Received '+money(o.received));text('Change '+money(o.change_due));}
 }
 if(t.signoff){if(p==='packing')text('□ Food  □ Drinks  □ Order  □ Sealed');text('Packed by __________');text('Time __________');}if(t.checker)text('Checked by __________');
 if(p==='payment'&&t.paymentAsset&&assets[t.paymentAsset]){text('PAYMENT QR · Verify payment manually',true);const a=assets[t.paymentAsset];image(a.data,Math.min(width-32,220),Math.min(width-32,220));}
 const date=o.created_at,marketing=t.marketingUrl&&(!t.qrChannels.length||t.qrChannels.includes(o.channel_id))&&(!t.campaignStart||date>=t.campaignStart)&&(!t.campaignEnd||date<=t.campaignEnd)&&p!=='payment';
 const qrValue=label&&t.packageQr?JSON.stringify({order:o.id,batch:document.batchId||'preview',revision:document.revision,unit:document.unit?.id||'summary'}):marketing?t.marketingUrl:'';
 if(qrValue){const size=Math.min(width-32,{small:160,medium:200,large:240}[t.qrSize]);const data=await QRCode.toDataURL(qrValue,{errorCorrectionLevel:'M',margin:4,width:size,color:{dark:'#000000',light:'#ffffff'}});image(data,size,size);text(label?'Package verification':t.marketingCaption||'Information');}
 if(!label&&t.footer)text(t.footer);
 y+=margin;const height=label?Math.round(t.height*8):y;
 if(y>height)fail(422,'Content exceeds this label. Choose larger media or reduce text and optional fields.');
 if(height>16000)fail(422,'Receipt is too long for one print job.');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Noto Sans Thai,DejaVu Sans,sans-serif">${nodes.join('')}</g></svg>`;
 // Preview and every transport consume exactly the same raster; no separate CSS layout.
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
