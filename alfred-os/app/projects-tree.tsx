'use client';
import {useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ArrowUp,ChevronLeft,ChevronRight,ExternalLink,X} from 'lucide-react';
import {divisions,projects} from '../lib/alfred-data';
import {useEquipo} from './equipo-panel';
import {decisionLabel,embudoExperimentos} from './decision-picker';
import ProjectsView from './projects-view';
import './projects-tree.css';

type Project=(typeof projects)[number];
type Task={id:string;proyecto:string;columna:string;titulo:string;detalle?:string;hora?:string;responsable?:string;archivos?:string[];revision?:{decision?:string;resumen?:string};fuente?:string};
type Node={id:string;x:number;y:number;label:string;meta?:string;chips?:{kind:string;n:number}[];on?:boolean;off?:boolean;focus?:boolean};

// One grammar on both levels (after Control AI + the tree layout the owner shared):
// centre node → glass cards → a fan of fine, tapering branches to labelled leaves.
const STATES=[{id:'curso',name:'En curso'},{id:'para-ti',name:'Para ti'},{id:'cola',name:'En cola'},{id:'bloqueado',name:'Bloqueadas'},{id:'hecho',name:'Hechas'}];
const CARD={w:208,h:62,gap:12},MAX_LEAVES=13,PANEL=400;

// A branch as a filled shape that thins from its source to its leaf (stroke width cannot taper in SVG).
function taper(x1:number,y1:number,x2:number,y2:number,w1:number,w2:number){
 const dx=(x2-x1)*.55,pts:[number,number,number][]=[];
 for(let i=0;i<=28;i++){const t=i/28,u=1-t;
  const x=u*u*u*x1+3*u*u*t*(x1+dx)+3*u*t*t*(x2-dx)+t*t*t*x2,y=u*u*u*y1+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y2;
  const tx=3*u*u*dx+6*u*t*((x2-dx)-(x1+dx))+3*t*t*dx,ty=6*u*t*(y2-y1),len=Math.hypot(tx,ty)||1;
  pts.push([x+(-ty/len)*(w1+(w2-w1)*t)/2,y+(tx/len)*(w1+(w2-w1)*t)/2,0]);
  pts.push([x-(-ty/len)*(w1+(w2-w1)*t)/2,y-(tx/len)*(w1+(w2-w1)*t)/2,1]);}
 const a=pts.filter(p=>!p[2]),b=pts.filter(p=>p[2]).reverse();
 return 'M'+a.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L')+'L'+b.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L')+'Z';
}
const spine=(x1:number,y1:number,x2:number,y2:number)=>{const dx=(x2-x1)*.55;return `M${x1} ${y1}C${x1+dx} ${y1} ${x2-dx} ${y2} ${x2} ${y2}`;};
const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1).trimEnd()+'…':s;
function ago(iso?:string){if(!iso)return '';const t=new Date(iso).getTime();if(!Number.isFinite(t))return '';const m=Math.round((Date.now()-t)/60000);
 return m<60?`hace ${Math.max(1,m)} min`:m<1440?`hace ${Math.round(m/60)} h`:new Date(t).toLocaleDateString('es-ES',{day:'numeric',month:'short'});}

function useNarrow(){const [n,setN]=useState(false);useEffect(()=>{const q=window.matchMedia('(max-width: 899px)');const f=()=>setN(q.matches);f();q.addEventListener('change',f);return()=>q.removeEventListener('change',f);},[]);return n;}

export default function ProjectsTree(props:{
 filter:string;setFilter:(v:string)=>void;search:string;setSearch:(v:string)=>void;focusId:string;
 selected:Project|null;onSelect:(p:Project|null)=>void;onChooseFocus:(p:Project)=>void;onRequest:(p:Project)=>void;saving:boolean;onAsk?:(p:Project,text:string)=>void;
}){
 const narrow=useNarrow();
 if(narrow)return <ProjectsView {...props}/>;
 return <Tree {...props}/>;
}

function Tree({filter,setFilter,focusId,selected,onSelect,onChooseFocus,onRequest,saving,onAsk}:Parameters<typeof ProjectsTree>[0]){
 const scene=useRef<HTMLDivElement>(null),[size,setSize]=useState({w:0,h:0});
 const [state,setState]=useState<string|null>(null),[taskId,setTaskId]=useState<string|null>(null),[hover,setHover]=useState<string|null>(null),[ask,setAsk]=useState('');
 const equipo=useEquipo(),board:Task[]=(((equipo as any)?.tablero||[]) as Task[]).filter(t=>t.fuente!=='hermes');
 const focusArea=projects.find(p=>p.id===focusId)?.division||divisions[0].id;
 const area=selected?.division||(filter!=='all'?filter:focusArea);
 const teamOf=(p:Project)=>p.team?board.filter(t=>t.proyecto===p.team):[];
 const count=(list:Task[],col:string)=>list.filter(t=>t.columna===col).length;

 // Measure synchronously on mount (ResizeObserver only reports on a painted frame, which can come late),
 // then follow later changes.
 useLayoutEffect(()=>{const el=scene.current;if(!el)return;const read=()=>{const r=el.getBoundingClientRect();setSize(s=>s.w===r.width&&s.h===r.height?s:{w:r.width,h:r.height});};
  read();const ro=new ResizeObserver(read);ro.observe(el);window.addEventListener('resize',read);return()=>{ro.disconnect();window.removeEventListener('resize',read);};},[]);
 useEffect(()=>{setTaskId(null);setState(null);},[selected?.id]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(e.target instanceof Element&&e.target.closest('input,textarea'))return;
   if(e.key==='Escape'){if(taskId)setTaskId(null);else if(selected)onSelect(null);else return;e.preventDefault();e.stopPropagation();}
   if(selected&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();const list=projects.filter(p=>p.division===selected.division),i=list.findIndex(p=>p.id===selected.id);onSelect(list[(i+(e.key==='ArrowRight'?1:-1)+list.length)%list.length]);}};
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 });

 const team=selected?teamOf(selected):[];
 const states=STATES.map(s=>({...s,n:count(team,s.id)})).filter(s=>s.n>0);
 const activeState=state&&states.some(s=>s.id===state)?state:states[0]?.id||null;
 const task=taskId?team.find(t=>t.id===taskId)||null:null;

 // Layout: everything in scene pixels, shared by the HTML labels and the SVG branches.
 const W=Math.max(0,size.w-(selected?PANEL:0)),H=size.h;
 const layout=useMemo(()=>{
  if(!W||!H)return null;
  // Compact when the inspector leaves little room: smaller root, narrower cards, two-line labels.
  const compact=W<780,cardW=compact?176:CARD.w,labelW=compact?214:346,cx=compact?Math.max(84,W*.09):Math.max(100,W*.1),cy=H/2,x0=cx+(compact?112:148);
  const cards=selected
   ?states.map(s=>({id:s.id,title:s.name,n:s.n,sub:s.id==='hecho'?'del equipo':s.id==='para-ti'?'esperan tu decisión':'tareas'}))
   :divisions.map(d=>{const list=projects.filter(p=>p.division===d.id),work=list.flatMap(teamOf);return {id:d.id,title:d.name,n:list.length,sub:work.length?`${count(work,'curso')} en curso · ${count(work,'hecho')} hechas`:'proyectos'};});
  const total=cards.length*CARD.h+Math.max(0,cards.length-1)*CARD.gap,top=cy-total/2;
  const placed=cards.map((c,i)=>({...c,x:x0,y:top+i*(CARD.h+CARD.gap)}));
  const from=placed.find(c=>c.id===(selected?activeState:area));
  let leaves:Node[]=[];
  if(from){
   const items:Node[]=selected
    ?team.filter(t=>t.columna===activeState).sort((a,b)=>(b.hora||'').localeCompare(a.hora||'')).map(t=>({id:t.id,x:0,y:0,label:clip(t.titulo,52),meta:[t.responsable,ago(t.hora)].filter(Boolean).join(' · '),on:t.id===taskId}))
    :projects.filter(p=>p.division===area).map(p=>{const w=teamOf(p);return {id:p.id,x:0,y:0,label:p.name,meta:p.stage,focus:p.id===focusId,
      chips:w.length?[{kind:'curso',n:count(w,'curso')},{kind:'para-ti',n:count(w,'para-ti')},{kind:'bloqueado',n:count(w,'bloqueado')},{kind:'hecho',n:count(w,'hecho')}].filter(c=>c.n):undefined};});
   // As many leaves as the height allows at 44 px apart; the rest fold into «y N más».
   const room=Math.max(3,Math.min(MAX_LEAVES,Math.floor(H*.86/44)+1)),fits=items.length<=room;
   const shown=fits?items:items.slice(0,room-1);if(!fits)shown.push({id:'mas',x:0,y:0,label:`y ${items.length-room+1} más`,off:true});
   // Leaves sit on an elliptical arc: even vertical spacing (never closer than 46 px) and an
   // arc depth that always leaves room for the label before the inspector.
   const ox=x0+cardW,acx=ox+(compact?26:44),n=shown.length,gap=n>1?Math.max(46,Math.min(62,H*.84/(n-1))):0;
   const half=gap*(n-1)/2,Ry=Math.max(half*1.18,1),Rx=Math.max(36,Math.min(240,W-acx-labelW-16));
   leaves=shown.map((l,i)=>{const y=cy-half+gap*i,k=Math.min(1,Math.abs(y-cy)/Ry);return {...l,x:acx+Rx*Math.sqrt(1-k*k),y};});
  }
  return {cx,cy,placed,from,leaves,compact,cardW};
 },[W,H,selected?.id,area,activeState,taskId,board.length,focusId]);

 const color=divisions.find(d=>d.id===area)?.color||'#c9d2de';
 const crumb=[{label:'Cartera',go:()=>{onSelect(null);setFilter('all');}},{label:divisions.find(d=>d.id===area)?.name||'',go:()=>onSelect(null)},...(selected?[{label:selected.name,go:()=>setTaskId(null)}]:[])];
 const kpi=selected&&team.length?[{n:count(team,'hecho'),l:'Hechas'},{n:count(team,'curso'),l:'En curso'},{n:count(team,'bloqueado'),l:'Bloqueadas'},{n:count(team,'para-ti'),l:'Para ti'}]:null;

 return <section className={'pt'+(selected?' pt-open':'')+(layout?.compact?' pt-compact':'')} style={{'--c':color} as CSSProperties} aria-label="Proyectos">
  <header className="pt-head">
   <span className="pt-eyebrow">PROYECTOS</span>
   <nav className="pt-crumb" aria-label="Ruta">{crumb.map((c,i)=><span key={i}>{i>0&&<ChevronRight size={14} aria-hidden="true"/>}<button onClick={c.go} aria-current={i===crumb.length-1?'page':undefined}>{c.label}</button></span>)}</nav>
  </header>

  <div className="pt-scene" ref={scene}>
   {layout&&<>
    <svg className="pt-svg" width={size.w} height={size.h} aria-hidden="true">
     <defs>
      <linearGradient id="pt-fade" x1="0" x2="1"><stop offset="0" stopColor="var(--c)" stopOpacity=".85"/><stop offset="1" stopColor="var(--c)" stopOpacity=".18"/></linearGradient>
      <linearGradient id="pt-trunk" x1="0" x2="1"><stop offset="0" stopColor="#dfe6ef" stopOpacity=".55"/><stop offset="1" stopColor="#dfe6ef" stopOpacity=".12"/></linearGradient>
     </defs>
     <g key={'t'+(selected?.id||area)} className="pt-trunks">
      {layout.placed.map(c=>{const on=c.id===layout.from?.id;return <path key={c.id} className={'pt-trunk'+(on?' on':'')} d={taper(layout.cx+(layout.compact?40:58),layout.cy,c.x,c.y+CARD.h/2,on?3.2:1.6,on?1.4:.7)} fill={on?'url(#pt-fade)':'url(#pt-trunk)'}/>;})}
     </g>
     {layout.from&&<g key={'f'+(selected?.id||'')+area+activeState} className="pt-fan">
      {layout.leaves.map((l,i)=>{const x1=layout.from!.x+layout.cardW,y1=layout.from!.y+CARD.h/2,on=l.on||hover===l.id;
       return <g key={l.id} style={{'--i':i} as CSSProperties}>
        <path className={'pt-branch'+(on?' on':'')+(l.off?' off':'')} d={taper(x1,y1,l.x-6,l.y,on?2:1.3,.35)} fill="url(#pt-fade)"/>
        {on&&<path className="pt-flow" d={spine(x1,y1,l.x-6,l.y)} pathLength={100}/>}
       </g>;})}
     </g>}
    </svg>

    <button className="pt-root" style={{left:layout.cx,top:layout.cy}} onClick={()=>selected?onSelect(null):setFilter('all')} aria-label={selected?'Volver al área':'Cartera'}>
     <span className="pt-root-ring"><i/></span>
     <span className="pt-root-name">{selected?clip(selected.name,22):'Cartera'}</span>
     <small>{selected?selected.stage:`${projects.length} proyectos`}</small>
    </button>

    <div key={'c'+(selected?.id||'')} className="pt-cards">
     {layout.placed.map((c,i)=><button key={c.id} className={'pt-card'+(c.id===layout.from?.id?' on':'')} style={{left:c.x,top:c.y,width:layout.cardW,'--i':i} as CSSProperties}
      aria-pressed={c.id===layout.from?.id} onClick={()=>{if(selected){setState(c.id);setTaskId(null);}else{setFilter(c.id);}}}>
      <strong>{c.n}</strong><span><b>{c.title}</b><small>{c.sub}</small></span>
     </button>)}
    </div>

    <div key={'l'+(selected?.id||'')+area+activeState} className="pt-leaves">
     {layout.leaves.map((l,i)=><button key={l.id} className={'pt-leaf'+(l.on?' on':'')+(l.off?' off':'')+(l.focus?' focus':'')} style={{left:l.x,top:l.y,'--i':i} as CSSProperties} disabled={l.off}
      onPointerEnter={()=>setHover(l.id)} onPointerLeave={()=>setHover(null)} onFocus={()=>setHover(l.id)} onBlur={()=>setHover(null)}
      onClick={()=>{if(selected)setTaskId(taskId===l.id?null:l.id);else{const p=projects.find(p=>p.id===l.id);if(p)onSelect(p);}}}>
      <i className="pt-dot"/>
      <span className="pt-leaf-copy"><b>{l.label}{l.focus&&<em>Foco</em>}</b>{(l.meta||l.chips)&&<small>{l.meta}{l.chips?.map(c=><span key={c.kind} className={'pt-chip '+c.kind}>{c.n}</span>)}</small>}</span>
     </button>)}
     {selected&&!team.length&&<p className="pt-empty" style={{left:layout.cx+(layout.compact?112:148),top:layout.cy}}>El equipo aún no trabaja en este proyecto.</p>}
    </div>
   </>}
  </div>

  {selected&&<aside className="pt-panel" aria-label={'Proyecto '+selected.name}>
   <div className="pt-panel-top">
    <span className="pt-eyebrow"><i/>{divisions.find(d=>d.id===selected.division)?.name.toUpperCase()}</span>
    <div className="pt-panel-nav">
     <button onClick={()=>{const list=projects.filter(p=>p.division===selected.division),i=list.findIndex(p=>p.id===selected.id);onSelect(list[(i-1+list.length)%list.length]);}} aria-label="Proyecto anterior"><ChevronLeft size={16}/></button>
     <button onClick={()=>{const list=projects.filter(p=>p.division===selected.division),i=list.findIndex(p=>p.id===selected.id);onSelect(list[(i+1)%list.length]);}} aria-label="Proyecto siguiente"><ChevronRight size={16}/></button>
     <button onClick={()=>onSelect(null)} aria-label="Cerrar proyecto"><X size={16}/></button>
    </div>
   </div>
   <div className="pt-panel-body">
    {task?<div className="pt-task">
      <label>TAREA · {STATES.find(s=>s.id===task.columna)?.name.toUpperCase()}</label>
      <h3>{task.titulo}</h3>
      <p className="pt-task-meta">{[task.responsable,ago(task.hora),task.archivos?.length?`${task.archivos.length} archivos`:''].filter(Boolean).join(' · ')}</p>
      {task.detalle&&<p className="pt-task-detail">{task.detalle}</p>}
      {task.revision?.decision&&<p className="pt-task-review">Revisión: {task.revision.decision}{task.revision.resumen?` · ${clip(task.revision.resumen,160)}`:''}</p>}
      <button className="pt-back" onClick={()=>setTaskId(null)}><ChevronLeft size={14}/>Volver al proyecto</button>
     </div>:<>
      <h2>{selected.name}</h2>
      <p className="pt-meta">{selected.line}<span>{selected.stage}</span></p>
      {kpi&&<div className="pt-kpi">{kpi.map(k=><div key={k.l}><strong>{k.n}</strong><span>{k.l}</span></div>)}</div>}
      <label>EL SIGUIENTE PASO</label>
      <p className="pt-next">{selected.next}</p>
      <label>LO QUE SABEMOS</label>
      <p className="pt-evidence">{selected.evidence}</p>
      {(()=>{
       // The team's experiments on this project over 7 days (same data as the list view's panel).
       const p=selected.team?(equipo as any)?.proyectos?.[selected.team]:undefined,lanz=p?.lanzamientos_7d,embudo=embudoExperimentos(lanz),exps:any[]=p?.experimentos||[],last=exps[exps.length-1],sinMedir:any[]=lanz?.sin_medir||[];
       if(!((lanz?.avisados||0)>0||last))return null;
       return <><label>EXPERIMENTOS (7 DÍAS)</label>
        {embudo&&<p className="pt-evidence">{embudo}</p>}
        {sinMedir[0]&&<p className="pt-evidence">Sin medir: «{sinMedir[0].titulo}»{sinMedir.length>1?` y ${sinMedir.length-1} más`:''}</p>}
        {last&&(()=>{const decision=decisionLabel(last.decision);return <p className="pt-evidence">Último resultado: {decision?decision+' · ':''}{clip(last.texto,140)}</p>;})()}</>;
      })()}
      <div className="pt-links">
       {selected.note&&<a href={'obsidian://open?path='+encodeURIComponent(selected.note)}>Abrir nota en Obsidian <ExternalLink size={12}/></a>}
       {selected.repo&&<a href={selected.repo} target="_blank" rel="noreferrer">Ver repositorio <ExternalLink size={12}/></a>}
      </div>
      <div className="pt-actions">
       {selected.id===focusId?<p className="pt-is-focus"><i/>Es tu foco actual</p>:<button className="pt-primary" disabled={saving} onClick={()=>onChooseFocus(selected)}>Elegir como foco</button>}
       <button className="pt-secondary" onClick={()=>onRequest(selected)}>Preparar una entrega</button>
      </div>
     </>}
   </div>
   {onAsk&&<form className="pt-ask" onSubmit={e=>{e.preventDefault();const t=ask.trim();if(!t)return;onAsk(selected,t);setAsk('');}}>
    <input value={ask} onChange={e=>setAsk(e.target.value)} placeholder={`Pregunta sobre ${clip(selected.name,26)}…`} aria-label={'Preguntar sobre '+selected.name}/>
    <button aria-label="Enviar pregunta" disabled={!ask.trim()}><ArrowUp size={16}/></button>
   </form>}
  </aside>}
 </section>;
}
