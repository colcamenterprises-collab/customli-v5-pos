import React,{useMemo,useState}from 'react';
import {X,Minus,Plus} from 'lucide-react';
import './modifier-picker.css';
const baht=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'THB'}).format(n/100);
export default function ModifierPicker({product,groups,onCancel,onAdd}){
 const[chosen,setChosen]=useState({}),[notes,setNotes]=useState(''),[error,setError]=useState('');
 const selected=useMemo(()=>groups.flatMap(g=>g.options.filter(o=>chosen[o.id]>0).map(o=>({optionId:o.id,quantity:chosen[o.id],name:o.name,group:g.name,priceMinor:o.price_minor}))),[groups,chosen]);
 const total=product.price+selected.reduce((n,m)=>n+m.priceMinor*m.quantity,0);
 const adjust=(g,o,delta)=>{
  setError('');
  setChosen(prev=>{
   const count=prev[o.id]||0,next=Math.max(0,Math.min(30,count+delta));
   const groupTotal=g.options.reduce((n,item)=>n+(item.id===o.id?next:prev[item.id]||0),0);
   if(groupTotal>g.max_select)return prev;
   return {...prev,[o.id]:next};
  });
 };
 const commit=e=>{
  e.preventDefault();
  for(const g of groups){
   const amount=g.options.reduce((n,o)=>n+(chosen[o.id]||0),0);
   if(amount<g.min_select||amount>g.max_select){setError(g.name+': select '+g.min_select+'–'+g.max_select+' options.');return}
  }
  onAdd({product,modifiers:selected.map(({optionId,quantity})=>({optionId,quantity})),instructions:notes.trim(),price:total});
 };
 return <div className="modifier-modal-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)onCancel()}}>
  <section className="modifier-modal" role="dialog" aria-modal="true" aria-label={'Customise '+product.name}>
   <header><div><span className="modifier-kicker">CUSTOMISE ITEM</span><h2>{product.name}</h2></div><button type="button" aria-label="Close" className="modifier-close" onClick={onCancel}><X size={19}/></button></header>
   <div className="modifier-modal-content">{groups.map(g=><section key={g.id} className="modifier-group"><div className="modifier-group-title"><strong>{g.name}</strong><span>{g.min_select===g.max_select?'Choose '+g.min_select:'Choose '+g.min_select+'–'+g.max_select}</span></div>
    {g.options.map(o=><div className="modifier-option" key={o.id}><div><strong>{o.name}</strong><span>{o.price_minor?'+ '+baht(o.price_minor):'Included'}</span></div><div className="modifier-qty"><button type="button" aria-label={'Remove '+o.name} disabled={!chosen[o.id]} onClick={()=>adjust(g,o,-1)}><Minus size={14}/></button><span>{chosen[o.id]||0}</span><button type="button" aria-label={'Add '+o.name} onClick={()=>adjust(g,o,1)} disabled={g.options.reduce((n,opt)=>n+(chosen[opt.id]||0),0)>=g.max_select}><Plus size={14}/></button></div></div>)}
   </section>)}<label className="modifier-notes">Preparation instructions<textarea rows={2} maxLength={500} placeholder="Optional" value={notes} onChange={e=>setNotes(e.target.value)}/></label>{error&&<div className="modifier-error" role="alert">{error}</div>}</div>
   <footer><div><span>Item price</span><strong>{baht(total)}</strong></div><button type="button" onClick={commit}>Add to cart</button></footer>
  </section>
 </div>
}
