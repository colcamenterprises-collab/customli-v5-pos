import React from 'react';
import {Tag,CheckCircle2,LockKeyhole,Plus,Pencil,ShieldCheck} from 'lucide-react';
import styles from './discount-rules.module.css';

/**
 * A single visual model for approved discounts. The POS remains the
 * source of truth for authorization, values, and edit actions.
 * No discount may be created/applied from presentation-only state.
 */
export default function DiscountRules({rules,onAdd,onEdit,money}){
 const access={cashier:'Cashier allowed',manager_pin:'Manager approval',manager_only:'Managers only'};
 return <section className={styles.workspace} aria-label="Approved Discounts">
  <div className={styles.panel}>
   <header className={styles.header}>
    <div><h2>Approved Discounts</h2><p>Only authorized discount rules are available for checkout.</p></div>
    <button type="button" className={styles.add} onClick={onAdd}><Plus size={17}/>Add discount</button>
   </header>
   <div className={styles.list}>
    {rules.map(rule=>{
     const percentage=rule.kind==='percent';
     const amount=percentage?String(rule.value/100)+'%':money(rule.value);
     const approval=access[rule.access_mode]||'Manager approval';
     return <button type="button" key={rule.id} className={styles.row}
       onClick={()=>onEdit(rule)} aria-label={'Edit '+rule.name}>
      <span className={styles.tag}><Tag size={20} aria-hidden="true"/></span>
      <span className={styles.name}><strong>{rule.name}</strong><small>{rule.description||'Approved discount rule'}</small></span>
      <span className={styles.value}><strong>{amount}</strong><small>{percentage?'Discount':'Amount'}</small></span>
      <span className={styles.status}><span className={rule.active?styles.enabled:styles.disabled}><CheckCircle2 size={14}/>{rule.active?'Active':'Inactive'}</span></span>
      <span className={styles.access}><LockKeyhole size={17}/><span>{approval}</span></span>
      <Pencil size={16} className={styles.editIcon} aria-hidden="true"/>
     </button>
    })}
    {!rules.length&&<div className={styles.empty}><ShieldCheck size={23}/>No approved discounts configured. Add a rule to make it available at checkout.</div>}
   </div>
  </div>
 </section>;
}
