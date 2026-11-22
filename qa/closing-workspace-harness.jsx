import React from 'react';
import {createRoot} from 'react-dom/client';
import ClosingWorkspace from '../closing-workspace.jsx';

const item={id:'roll',name:'Burger rolls',base_unit:'each',pack_unit:'each',pack_quantity:12,each_unit:'each',each_quantity:1,count_unit:'each',count_enabled:1,requisition_enabled:1,active:1};
const state={reconciliation:null,count:null,entries:[],requisition:null,requestItems:[],checklist:null,checklistResponses:[]};
window.closingFixture={calls:[],offline:false,state};
const failure=message=>{throw Object.assign(new Error(message),{status:409})};
async function request(path,method='GET',body){
 window.closingFixture.calls.push({path,method,body});
 if(window.closingFixture.offline)throw Error('Network unavailable');
 if(path==='/shift-reconciliation/shift'){
  if(method==='GET')return {reconciliation:state.reconciliation,available:{channels:[{id:'direct',name:'Direct'}],methods:[{name:'Cash'}]}};
  if(state.reconciliation?.status==='submitted')failure('Submitted reconciliation is immutable.');
  state.reconciliation={status:'draft',payload:body};return {reconciliation:state.reconciliation};
 }
 if(path==='/shift-reconciliation/shift/submit'){
  state.reconciliation={status:'submitted',payload:body};return {reconciliation:state.reconciliation};
 }
 if(path==='/stock-control/items')return {items:[item]};
 if(path==='/stock-control/schedules')return {schedules:[{id:'daily',name:'Daily critical',frequency:'daily',active:1}]};
 if(path==='/stock-control/schedules/daily')return {schedule:{id:'daily'},items:[{item_id:'roll',sort_order:0}]};
 if(path==='/stock-control/counts'){
  if(method==='GET')return {counts:state.count?[state.count]:[]};
  state.count??={id:'count',status:'draft',shift_id:'shift',schedule_id:body.scheduleId,revision:0};return {id:'count',count:state.count};
 }
 if(path==='/stock-control/counts/count')return {count:state.count,entries:state.entries};
 if(path==='/stock-control/counts/count/entries'){
  if(body.expectedRevision!==state.count.revision)failure('Another staff member saved this count.');state.entries=body.entries.map(e=>({item_id:e.itemId,quantity_base:e.quantity}));state.count.revision++;return {ok:true,revision:state.count.revision};
 }
 if(path==='/stock-control/counts/count/submit'){
  if(!state.entries.length||state.entries.some(e=>e.quantity_base===null))failure('Count every item.');
  state.count.status='submitted';return {count:state.count};
 }
 if(path==='/stock-control/requisitions'){
  if(method==='GET')return {requisitions:state.requisition?[state.requisition]:[]};
  state.requisition??={id:'requisition',shift_id:'shift',count_id:body.countId,status:'draft'};return {id:state.requisition.id};
 }
 if(path==='/stock-control/requisitions/requisition')return {requisition:state.requisition,items:state.requestItems};
 if(path==='/stock-control/requisitions/requisition/items'){
  state.requestItems=body.items.map(e=>({item_id:e.itemId,requested_base:e.quantity}));return {ok:true};
 }
 if(path==='/stock-control/requisitions/requisition/submit'){
  state.requisition.status='submitted';return {requisition:state.requisition};
 }
 throw Error('Unexpected request '+method+' '+path);
}
async function checklistRequest(path,method='GET',body){
 window.closingFixture.calls.push({path:'/kitchen-ready'+path,method,body});if(window.closingFixture.offline)throw Error('Network unavailable');
 if(path==='/closing/shift'){const stages={sales:{required:true,complete:state.reconciliation?.status==='submitted'},cleaning:{required:true,complete:!!state.checklist?.completed_at},stock:{required:true,complete:state.count?.status==='submitted'},requisition:{required:true,complete:state.requisition?.status==='submitted'}},missing=Object.entries(stages).filter(([,value])=>!value.complete).map(([name])=>name);if(method==='POST'){if(missing.length)failure('Complete the required stages.');state.finalised={accountId:'staff',completedAt:new Date().toISOString()};return {ok:true}}return {shiftId:'shift',stages,missing,finalised:state.finalised||null}}
 if(path==='/templates')return [{id:'template',name_en:'Closing checks'}];
 if(path==='/runs'&&method==='POST'){state.checklist??={id:'run',template_id:'template',shift_id:body.shiftId};return {id:'run'}};
 if(path==='/runs/run')return {run:state.checklist,items:[{id:'grill',label_en:'Grill cleaned',reading_required:1,photo_required:1}],responses:state.checklistResponses,evidence:state.checklistEvidence?[{id:state.checklistEvidence,item_id:'grill'}]:[]};
 if(path==='/runs/run/respond'){state.checklistResponses=[{item_id:body.itemId,...body}];return {ok:true}};
 if(path==='/runs/run/items/grill/evidence'){state.checklistEvidence='photo';return {id:'photo'}};
 if(path==='/runs/run/complete'){state.checklist.completed_at=new Date().toISOString();return {ok:true}};
 throw Error('Unexpected checklist request '+method+' '+path);
}
createRoot(document.getElementById('root')).render(<ClosingWorkspace request={request} checklistRequest={checklistRequest} shift={{id:'shift',opened_at:'2026-11-20T10:00:00Z'}} user={{id:'staff',tenantId:'tenant',device:{locationId:'location'},permissions:['operations.closing.reconcile','operations.closing.checklist','operations.stock.count','operations.stock.requisition']}}/>);
