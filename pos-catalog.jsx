import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import styles from './pos-catalog.module.css';

export default function PosCatalog({categories,products,search,renderProduct}){
 const [active,setActive]=useState('All'),[height,setHeight]=useState(500);
 const viewport=useRef(null),navigation=useRef(null),sectionRefs=useRef(new Map());
 const sections=useMemo(()=>{
  const names=[...new Set([...categories.map(c=>c.name),...products.map(p=>p.category||'Uncategorised')])];
  const query=search.trim().toLocaleLowerCase();
  return names.map(name=>({name,items:products.filter(p=>(p.category||'Uncategorised')===name&&p.name.toLocaleLowerCase().includes(query))})).filter(s=>s.items.length);
 },[categories,products,search]);
 const sectionKey=sections.map(s=>s.name+':'+s.items.map(p=>p.id).join(',')).join('|');
 useLayoutEffect(()=>{
  const size=()=>{if(viewport.current)setHeight(Math.max(180,Math.floor(innerHeight-viewport.current.getBoundingClientRect().top-(matchMedia('(max-width:600px)').matches?80:24))))};
  size();const observer=new ResizeObserver(size);if(navigation.current)observer.observe(navigation.current);
  window.addEventListener('resize',size);return()=>{observer.disconnect();window.removeEventListener('resize',size)};
 },[]);
 useEffect(()=>{
  const scroller=viewport.current;if(!scroller)return;
  scroller.scrollTop=0;setActive('All');
 },[search]);
 useEffect(()=>{
  const scroller=viewport.current;if(!scroller)return;
  let frame;
  const sync=()=>{
   cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    if(scroller.scrollTop<=1){setActive('All');return}
    if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2){setActive(sections.at(-1)?.name||'All');return}
    const edge=scroller.getBoundingClientRect().top+12;
    let name=sections[0]?.name||'All';
    for(const section of sections){const el=sectionRefs.current.get(section.name);if(el&&el.getBoundingClientRect().top<=edge)name=section.name;else break}
    setActive(name);
   });
  };
  scroller.addEventListener('scroll',sync,{passive:true});
  if(active!=='All'&&!sections.some(s=>s.name===active))setActive('All');
  return()=>{scroller.removeEventListener('scroll',sync);cancelAnimationFrame(frame)};
 },[sectionKey]);
 useEffect(()=>{
  const nav=navigation.current,button=nav?.querySelector('[aria-current="location"]');if(!button)return;
  const left=button.offsetLeft,right=left+button.offsetWidth;
  if(left<nav.scrollLeft)nav.scrollLeft=left-8;
  else if(right>nav.scrollLeft+nav.clientWidth)nav.scrollLeft=right-nav.clientWidth+8;
 },[active]);
 const go=name=>{
  const scroller=viewport.current;if(!scroller)return;
  setActive(name);
  const target=sectionRefs.current.get(name),top=name==='All'?0:target?target.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop:0;
  scroller.scrollTo({top,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 };
 return <div className={styles.catalog}>
  <nav className={styles.navigation} ref={navigation} aria-label="Menu categories">
   {['All',...sections.map(s=>s.name)].map(name=><button key={name} type="button" className={styles.category+(active===name?' '+styles.active:'')} aria-current={active===name?'location':undefined} onClick={()=>go(name)}>{name}</button>)}
  </nav>
  <div className={styles.viewport} ref={viewport} style={{height}} aria-label="Menu items" tabIndex={0}>
   {sections.map(section=><section className={styles.section} aria-label={section.name} key={section.name} ref={el=>{if(el)sectionRefs.current.set(section.name,el);else sectionRefs.current.delete(section.name)}}>
    <h2 className={styles.heading}>{section.name}</h2>
    <div className="grid">{section.items.map(renderProduct)}</div>
   </section>)}
   {!sections.length&&<p className={styles.empty}>No items found.</p>}
  </div>
 </div>
}
