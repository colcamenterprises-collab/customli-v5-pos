import assert from 'node:assert/strict';
import {test} from 'node:test';
import {defaults,normalizeMarketingUrl,sampleOrder,simplePacking} from '../print-model.mjs';
import {renderDocument} from '../print-render.mjs';

test('receipt styles render centered receipt identity and preserve modifier totals at both widths',async()=>{
 const order=sampleOrder();order.partner_reference='GRAB-ORDER-123456789';order.receipt_number='4821';order.channel_id='GrabFood';order.discount_total=1500;order.partner_item_discount=500;order.partner_order_discount=1000;order.tax=0;
 order.items[0].price=13000;order.items[0].modifiers=[{name:'Extra cheese',quantity:1,priceMinor:1000}];
 for(const width of [58,80])for(const stylePreset of ['promotional','minimalist','editorial']){
  const template={...defaults('customer'),width,stylePreset,businessName:'Smash Brothers Burgers',address:'Rawai, Phuket',header:'Enjoy your meal',footer:'Thank you — see you soon'};
  const result=await renderDocument({template,order,packing:simplePacking(order),packageCount:2});
  const text=result.svg.replace(/<\/text>/g,' </text>');
  assert(result.png.length>1000);assert.match(text,/GRAB-ORDER-1234/);assert.match(text,/56789|12345678|GRAB-ORDER-1234/);assert.match(text,/Receipt #4821/);assert.match(text,/Smash Brothers Burgers/);assert.match(text,/Extra cheese/);assert.match(text,/THB 20\.00/);assert.match(text,/THB 260\.00/);assert.match(text,/Item discounts/);assert.match(text,/Order discount/);assert.match(text,/THANK YOU|Thank you/);
  assert.equal(result.width,width*8);assert(result.height>500);
 }
});

test('marketing links accept bare hosts and reject insecure or credentialed URLs',()=>{
 assert.equal(normalizeMarketingUrl('example.com'),'https://example.com/');
 assert.equal(normalizeMarketingUrl('https://www.example.com/path'),'https://www.example.com/path');
 assert.throws(()=>normalizeMarketingUrl('http://example.com'));
 assert.throws(()=>normalizeMarketingUrl('https://user:pass@example.com'));
});
