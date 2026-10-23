'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {ChevronLeft,ChevronRight,ExternalLink,Search,X} from 'lucide-react';
import {divisions,projects} from '../lib/alfred-data';
import {RESULTADO_MAX,RESULTADO_MIN,type Decision} from '../lib/office-limits';
import {DecisionPicker,decisionLabel,embudoExperimentos} from './decision-picker';
import {shareEquipo,useEquipo,type Status} from './equipo-panel';
import './projects.css';

type Project=(typeof projects)[number];
type Line={id:string;d:string;color:string;kind:'core'|'branch';x1:number;y1:number;x2:number;y2:number};

// Quadrants around Alfred. Left areas open their projects outward to the left.
// By the order of the areas in the data: first top-left, then top-right, bottom-right and bottom-left.
const QUADRANTS:{area:string;side:'left'|'right'}[]=[{area:'tl',side:'left'},{area:'tr',side:'right'},{area:'br',side:'right'},{area:'bl',side:'left'}];
const layout:Record<string,{area:string;side:'left'|'right'}>=Object.fromEntries(divisions.slice(0,4).map((d,i)=>[d.id,QUADRANTS[i]]));
const narrowQuery='(max-width: 899px)';

export default function ProjectsView({filter,setFilter,search,setSearch,focusId,selected,onSelect,onChooseFocus,onRequest,saving}:{
 filter:string;setFilter:(v:string)=>void;search:string;setSearch:(v:string)=>void;focusId:string;
 selected:Project|null;onSelect:(p:Project|null)=>void;onChooseFocus:(p:Project)=>void;onRequest:(p:Project)=>void;saving:boolean;
}){
 const scene=useRef<HTMLDivElement>(null),core=useRef<HTMLSpanElement>(null);
 const hubs=useRef<Record<string,HTMLElement|null>>({}),dots=useRef<Record<string,HTMLElement|null>>({});
 const [lines,setLines]=useState<Line[]>([]),[size,setSize]=useState({w:0,h:0}),[hover,setHover]=useState<string|null>(null);
 const query=search.trim().toLowerCase();
 // The agent team's real activity on the selected project (only projects the team works on carry `team`).
 const equipo=useEquipo(),team=selected?.team||'';
 const teamItems:any[]=team?(((equipo as any)?.tablero||[]) as any[]).filter(i=>i.proyecto===team&&i.fuente!=='hermes'):[];
 const p=team?equipo?.proyectos?.[team]:undefined,lanz=p?.lanzamientos_7d,embudo=embudoExperimentos(lanz),exps=p?.experimentos||[],lastExp=exps[exps.length-1],sinMedir=lanz?.sin_medir||[],porLanzar=lanz?.por_lanzar||[];
 // Closing the circuit from the panel: mark the first announced experiment as launched, or write down the result of the first unmeasured one.
 const [sending,setSending]=useState(false),[formOpen,setFormOpen]=useState(false),[texto,setTexto]=useState(''),[decision,setDecision]=useState<Decision|null>(null),[expMsg,setExpMsg]=useState<{text:string;error:boolean}|null>(null);
 const current=useRef(selected?.id);
 current.current=selected?.id;
 useEffect(()=>{setSending(false);setFormOpen(false);setTexto('');setDecision(null);setExpMsg(null);},[selected?.id]);
 async function sendExp(payload:Record<string,unknown>,done:string,after?:()=>void){
  const id=selected?.id;setSending(true);setExpMsg(null);
  try{
   const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   shareEquipo(j as Status);
   if(current.current===id){after?.();setExpMsg({text:done,error:false});}
  }catch(e){if(current.current===id)setExpMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setSending(false);}
 }
 const teamDone=teamItems.filter(i=>i.columna==='hecho').sort((a,b)=>(b.hora||'').localeCompare(a.hora||'')),teamNow=teamItems.filter(i=>i.columna==='curso'),teamWaiting=teamItems.filter(i=>i.columna==='para-ti').length;
 const matches=(p:Project)=>!query||p.name.toLowerCase().includes(query)||p.line.toLowerCase().includes(query);
 const matchCount=projects.filter(matches).length;

 const measure=useCallback(()=>{
  const el=scene.current;if(!el)return;
  const box=el.getBoundingClientRect(),narrow=window.matchMedia(narrowQuery).matches;
  const at=(node?:HTMLElement|null)=>{if(!node)return null;const r=node.getBoundingClientRect();return {x:r.left-box.left+r.width/2,y:r.top-box.top+r.height/2,r:r.width/2};};
  const next:Line[]=[],c=at(core.current);
  for(const d of divisions){
   const h=at(hubs.current[d.id]);if(!h)continue;
   if(c&&!narrow){const mx=(c.x+h.x)/2;next.push({id:'core-'+d.id,kind:'core',color:d.color,x1:c.x,y1:c.y,x2:h.x,y2:h.y,d:`M${c.x} ${c.y} C${mx} ${c.y} ${mx} ${h.y} ${h.x} ${h.y}`});}
   for(const p of projects.filter(p=>p.division===d.id)){
    const t=at(dots.current[p.id]);if(!t)continue;
    if(narrow){const top=h.y+h.r+4,bend=Math.min(10,Math.abs(t.y-top));next.push({id:p.id,kind:'branch',color:d.color,x1:h.x,y1:top,x2:t.x-t.r,y2:t.y,d:`M${h.x} ${top} V${t.y-bend} Q${h.x} ${t.y} ${h.x+bend} ${t.y} H${t.x-t.r}`});continue;}
    const dir=t.x<h.x?-1:1,sx=h.x+dir*(h.r+6),ex=t.x-dir*(t.r+3),mx=(sx+ex)/2;
    next.push({id:p.id,kind:'branch',color:d.color,x1:sx,y1:h.y,x2:ex,y2:t.y,d:`M${sx} ${h.y} C${mx} ${h.y} ${mx} ${t.y} ${ex} ${t.y}`});
   }
  }
  setSize({w:box.width,h:box.height});setLines(next);
 },[]);

 useLayoutEffect(()=>{
  measure();const el=scene.current;if(!el)return;
  const observer=new ResizeObserver(measure);observer.observe(el);
  document.fonts?.ready.then(measure).catch(()=>{});
  return ()=>observer.disconnect();
 },[measure]);

 // The scene narrows while the panel slides in; follow it for the length of the transition.
 useEffect(()=>{
  let frame=0;const until=performance.now()+700;
  const tick=()=>{measure();if(performance.now()<until)frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(frame);
 },[Boolean(selected),measure]);

 useEffect(()=>{
  if(!selected)return;
  const onKey=(e:KeyboardEvent)=>{
   if(e.target instanceof Element&&e.target.closest('input,textarea,select'))return;
   if(e.key==='Escape'){e.preventDefault();onSelect(null);}
   if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();step(e.key==='ArrowRight'?1:-1);}
  };
  window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);
 });

 function step(direction:number){if(!selected)return;const i=projects.findIndex(p=>p.id===selected.id);onSelect(projects[(i+direction+projects.length)%projects.length]);}
 const lit=(id:string)=>selected?.id===id||hover===id||(!selected&&id===focusId);
 const dimmed=(p:Project)=>(selected?selected.id!==p.id:false)||(filter!=='all'&&p.division!==filter)||!matches(p);
 const area=selected?divisions.find(d=>d.id===selected.division):null;
 const index=selected?projects.findIndex(p=>p.id===selected.id)+1:0;

 return <section className={'pj'+(selected?' pj-has-panel':'')} aria-label="Proyectos">
  <div className="pj-body">
  <header className="pj-head">
   <div><span className="pj-eyebrow">PROYECTOS</span><h1>{projects.length} proyectos en {new Set(projects.map(p=>p.division)).size} áreas.</h1><p className="pj-sub">Foco: {projects.find(p=>p.id===focusId)?.name||'sin elegir'}{projects.some(p=>p.source)?' · desde tus notas de Obsidian':''}</p></div>
   <div className="pj-tools">
    <div className="pj-segment" role="group" aria-label="Filtrar por área">
     {[{id:'all',short:'Todas'},...divisions].map(d=><button key={d.id} aria-pressed={filter===d.id} onClick={()=>setFilter(d.id)}>{d.short}</button>)}
    </div>
    <label className="pj-search"><Search size={14}/><input aria-label="Buscar proyecto" placeholder="Buscar" value={search} onChange={e=>setSearch(e.target.value)}/>{query&&<span className="pj-search-count">{matchCount}</span>}</label>
   </div>
  </header>

  <div className="pj-scene" ref={scene}>
   <svg className="pj-lines" width={size.w} height={size.h} viewBox={`0 0 ${size.w||1} ${size.h||1}`} aria-hidden="true">
    <defs>
     <filter id="pj-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
     <filter id="pj-flow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1"/></filter>
     {/* Each connection is a gradient: strong at its source, fading toward the far end (toward the hub for the core links). */}
     {lines.map(l=><linearGradient key={'g'+l.id} id={'pjg-'+l.id} gradientUnits="userSpaceOnUse" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}>
      <stop offset="0" stopColor={l.color} stopOpacity={l.kind==='core'?0:1}/><stop offset="1" stopColor={l.color} stopOpacity={l.kind==='core'?.9:.45}/></linearGradient>)}
    </defs>
    <g filter="url(#pj-soft)" className="pj-glow">{lines.map(l=><path key={'glow'+l.id} d={l.d} stroke={l.color}/>)}</g>
    {lines.map(l=>{
     const p=l.kind==='branch'?projects.find(p=>p.id===l.id):null;
     const on=p?lit(p.id):false,off=p?dimmed(p):filter!=='all'&&'core-'+filter!==l.id;
     return <path key={l.id} d={l.d} className={'pj-line '+l.kind+(on?' on':'')+(off?' off':'')} style={{'--c':l.color,stroke:`url(#pjg-${l.id})`} as CSSProperties}/>;
    })}
    <g filter="url(#pj-flow)" className="pj-flows">{lines.filter(l=>l.kind==='branch').map((l,i)=><path key={'flow'+l.id} d={l.d} pathLength={100} className="pj-flow" style={{animationDelay:`${-((i*.83)%5).toFixed(2)}s`,animationDuration:`${4.4+(i%3)*.8}s`}}/>)}</g>
   </svg>

   <button className="pj-core" onClick={()=>{setFilter('all');onSelect(null);}} aria-label="Ver todas las áreas"><span className="pj-core-ring" ref={core}><i/></span><span className="pj-core-word">ALFRED</span></button>

   {divisions.map((d,di)=>{
    const list=projects.filter(p=>p.division===d.id),pos=layout[d.id];
    const areaOff=filter!=='all'&&filter!==d.id;
    return <div key={d.id} className={`pj-area pj-${pos.area} pj-${pos.side}`+(areaOff?' off':'')+(filter===d.id?' chosen':'')} style={{'--c':d.color,'--i':di} as CSSProperties}>
     <button className="pj-hub" aria-pressed={filter===d.id} aria-label={`Área ${d.name}, ${list.length} proyectos`} onClick={()=>setFilter(filter===d.id?'all':d.id)}>
      <span className="pj-hub-ring" ref={el=>{hubs.current[d.id]=el;}}><span className="pj-hub-count">{list.length}</span></span>
      <span className="pj-hub-name">{d.name}</span>
     </button>
     <ul className="pj-list">
      {list.map(p=><li key={p.id}>
       <button className={'pj-project'+(lit(p.id)?' on':'')+(dimmed(p)?' off':'')+(p.id===focusId?' focus':'')+(selected?.id===p.id?' selected':'')}
        aria-current={selected?.id===p.id?'true':undefined} onClick={()=>onSelect(selected?.id===p.id?null:p)}
        onPointerEnter={()=>setHover(p.id)} onPointerLeave={()=>setHover(null)} onFocus={()=>setHover(p.id)} onBlur={()=>setHover(null)}>
        <span className="pj-dot" ref={el=>{dots.current[p.id]=el;}}/>
        <span className="pj-copy"><strong>{p.name}{p.id===focusId&&<em>Foco</em>}</strong><small>{p.stage}</small></span>
       </button>
      </li>)}
     </ul>
    </div>;
   })}
  </div>
  </div>

  {selected&&area&&<aside className="pj-panel" role="dialog" aria-label={'Proyecto '+selected.name} style={{'--c':area.color} as CSSProperties}>
   <div className="pj-panel-top">
    <span className="pj-eyebrow"><i/>{area.name.toUpperCase()}</span>
    <div className="pj-panel-nav">
     <button onClick={()=>step(-1)} aria-label="Proyecto anterior"><ChevronLeft size={16}/></button>
     <span>{index} / {projects.length}</span>
     <button onClick={()=>step(1)} aria-label="Proyecto siguiente"><ChevronRight size={16}/></button>
     <button onClick={()=>onSelect(null)} aria-label="Cerrar proyecto"><X size={16}/></button>
    </div>
   </div>
   <h2>{selected.name}</h2>
   <p className="pj-meta">{selected.line}<span>{selected.stage}</span></p>
   <label>EL SIGUIENTE PASO</label>
   <p className="pj-next">{selected.next}</p>
   <label>LO QUE SABEMOS</label>
   <p className="pj-evidence">{selected.evidence}</p>
   {selected.source&&<p className="pj-source">Nota «{selected.source.replace(/\.md$/,'')}» en Obsidian{selected.updated&&/^\d{4}-\d{2}-\d{2}$/.test(selected.updated)?' · actualizada el '+new Date(selected.updated+'T12:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'}):''}</p>}
   {team&&<><label>EL EQUIPO EN ESTE PROYECTO</label>
    <p className="pj-team">{teamDone.length} {teamDone.length===1?'tarea hecha':'tareas hechas'} esta semana{teamNow.length?` · ${teamNow.length} en curso`:''}{teamWaiting?` · ${teamWaiting} para ti`:''}</p>
    {teamNow[0]?<p className="pj-team-last">Ahora: {teamNow[0].titulo}</p>:teamDone[0]?<p className="pj-team-last">Última: {teamDone[0].titulo}</p>:null}
    {((lanz?.avisados||0)>0||porLanzar.length>0||lastExp)&&<><label>EXPERIMENTOS (7 DÍAS)</label>
     {embudo&&<p className="pj-team">{embudo}</p>}
     {porLanzar[0]&&<div className="pj-exp-row"><p className="pj-team-last">Listo para lanzar: «{porLanzar[0].titulo}»</p>
      <button className="pj-exp-btn" disabled={sending} onClick={()=>sendExp({action:'lanzado',tarea:porLanzar[0].tarea},'Marcado como lanzado.')}>Ya lo he lanzado</button></div>}
     {sinMedir[0]&&<div className="pj-exp-row"><p className="pj-team-last">Sin medir: «{sinMedir[0].titulo}»{sinMedir.length>1?` y ${sinMedir.length-1} más`:''}</p>
      <button className="pj-exp-btn" disabled={sending} aria-expanded={formOpen} onClick={()=>setFormOpen(o=>!o)}>Apuntar resultado</button></div>}
     {sinMedir[0]&&formOpen&&<form className="pj-exp-form" onSubmit={e=>{e.preventDefault();if(texto.trim().length<RESULTADO_MIN||sending)return;sendExp({action:'resultado',project:team,tarea:sinMedir[0].tarea,texto,...(decision?{decision}:{})},'Apuntado.',()=>{setFormOpen(false);setTexto('');setDecision(null);});}}>
      <textarea value={texto} onChange={e=>setTexto(e.target.value)} maxLength={RESULTADO_MAX} rows={3} placeholder="Qué pasó y con qué cifras" aria-label="Resultado del experimento"/>
      <DecisionPicker value={decision} onChange={setDecision} disabled={sending} className="pj-exp-btn"/>
      <button className="pj-exp-btn" disabled={sending||texto.trim().length<RESULTADO_MIN}>Guardar</button></form>}
     {expMsg&&<p className={'pj-exp-msg'+(expMsg.error?' error':'')} role="status">{expMsg.text}</p>}
     {lastExp&&(()=>{const decision=decisionLabel((lastExp as {decision?:unknown}).decision);return <p className="pj-team-last">Último resultado: {decision?decision+' · ':''}{lastExp.texto.length>140?lastExp.texto.slice(0,139).trimEnd()+'…':lastExp.texto}</p>;})()}</>}</>}
   <div className="pj-links">
    {selected.note&&<a className="pj-link" href={'obsidian://open?path='+encodeURIComponent(selected.note)}>Abrir nota en Obsidian <ExternalLink size={13}/></a>}
    {selected.repo&&<a className="pj-link" href={selected.repo} target="_blank" rel="noreferrer">Ver repositorio <ExternalLink size={13}/></a>}
   </div>
   <div className="pj-actions">
    {selected.id===focusId
     ?<p className="pj-is-focus"><i/>Es tu foco actual</p>
     :<button className="pj-primary" disabled={saving} onClick={()=>onChooseFocus(selected)}>Elegir como foco</button>}
    <button className="pj-secondary" onClick={()=>onRequest(selected)}>Preparar una entrega</button>
   </div>
  </aside>}
 </section>;
}
