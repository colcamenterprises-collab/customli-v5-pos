import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {defaults,sampleOrder,simplePacking} from '../print-model.mjs';
import {encodeDocument,renderDocument} from '../print-render.mjs';

for(const width of [58,80])test('Bluetooth receipt commands preserve every image pixel at '+width+' mm',async()=>{
 const order=sampleOrder();
 order.items[0].name='A long burger name with bacon and cheese that must wrap before its price';
 const template={...defaults('customer'),width,fontSize:22,header:'Welcome',footer:'Thank you'};
 const document={template,order,packing:simplePacking(order)};
 const rendered=await renderDocument(document);
 const pixels=await sharp(rendered.png).flatten({background:'#fff'}).greyscale().threshold(160).raw().toBuffer();
 const bytes=await encodeDocument(document,{language:'escpos',transport:'bluetooth',width});
 assert.deepEqual([...bytes.subarray(0,8)],[27,64,27,97,0,27,51,24]);
 let offset=8;
 for(let top=0;top<rendered.height;top+=24){
  assert.deepEqual([...bytes.subarray(offset,offset+5)],[27,42,33,rendered.width&255,rendered.width>>8]);
  offset+=5;
  for(let x=0;x<rendered.width;x++)for(let dy=0;dy<24;dy++){
   const ink=Boolean(bytes[offset+x*3+(dy>>3)]&(128>>(dy%8)));
   assert.equal(ink,top+dy<rendered.height&&pixels[(top+dy)*rendered.width+x]<128);
  }
  offset+=rendered.width*3;
  assert.equal(bytes[offset++],10);
 }
 assert.deepEqual([...bytes.subarray(offset)],[27,50,10,10]);
});
