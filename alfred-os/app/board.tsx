'use client';
// Entregas: the operations app of the owner OS, built like Apple's own work apps (Mail, Reminders, Xcode):
// a source list of smart lists, people and projects · a grouped list · an inspector with the evidence.
// Every row is real work reported by the engine, the office or Hermes; nothing here invents progress.
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Hexagon,Search,Code2,PenTool,ArrowUpRight,ShieldCheck,User,Bot,X,Plus,Pause,Play,Check,Lightbulb,GitMerge,MessageCircle,Inbox,Sun,Layers,Clock3,AlertTriangle,CircleCheck,MessagesSquare,Plug,Settings,FolderClosed,ChevronLeft,ExternalLink} from 'lucide-react';
import {ACCEPTED_VISIBLE_MS,projects,type Entry} from '../lib/alfred-data';
import {REQUEST_STEPS,requestStep,requestText} from '../lib/request-path';
import {FASE_FALTA_FUSIONAR,RESULTADO_MAX,RESULTADO_MIN,type Decision} from '../lib/office-limits';
import {DecisionPicker,decisionLabel} from './decision-picker';
import {SetupPanel} from './setup';
import {BatchApproval,MesaView,TelegramLink,HermesView,SaludView,type Status} from './equipo-panel';
import './equipo.css';
import './board.css';

type Column='para-ti'|'cola'|'curso'|'bloqueado'|'hecho';
export type Item={id:string;fuente:'equipo'|'lote'|'mesa'|'hermes'|'encargo'|'fusion';proyecto:string;titulo:string;detalle?:string|string[];columna:Column;responsable:string;
 propone?:string;origen?:'alfred'|'lote';fase?:string;parada?:string;intento?:number;hora?:string;archivos?:string[];pruebas?:{prueba:string;ok:boolean}[];revision?:{decision?:string;motivos?:string}|null;
 intentos?:number;commit?:string|null;rama?:string;base?:string;fusionada?:boolean;motivo?:string;entry?:Entry;
 viene_de?:{tarea:string;titulo:string;resultado?:string};
 lanzamiento?:{que:string;a_quien:string;metrica:string;umbral:string};lanzado?:string;medido?:boolean;decision?:string;descartado?:string;descarte?:string;
 grupo?:Grupo;miembros?:Item[];pregunta?:Grupo;decisiones?:Grupo[]};
// What waits for the owner, grouped and explained in plain words by the engine (status.para_ti, the same as /lote in Telegram).
type Grupo={id:string;tipo:'lanzar'|'medir'|'decidir'|'pregunta';proyecto?:string;titulo:string;que_es:string;tu_parte:string;por_que:string;si_dices_que_si:string;claves:string[]};
type Source={kind:'smart'|'owner'|'project'|'mesa'|'conexiones'|'salud'|'config';id:string};

export const OWNERS:Record<string,{name:string;role:string;color:string;icon:any}>={
 owner:{name:'Tú',role:'Decides, apruebas y fusionas',color:'#e3c98a',icon:User},
 alfred:{name:'Operaciones',role:'Planifica y coordina',color:'#77c9bc',icon:Hexagon},
 radar:{name:'Inteligencia',role:'Investiga con fuentes',color:'#89a8df',icon:Search},
 product:{name:'Producto',role:'Construye y prueba',color:'#d49db8',icon:Code2},
 studio:{name:'Creativo',role:'Marca, textos y piezas',color:'#b19edc',icon:PenTool},
 business:{name:'Negocio',role:'Oferta y distribución',color:'#dca17c',icon:ArrowUpRight},
 control:{name:'Control',role:'Revisa calidad y riesgos',color:'#c8bf7c',icon:ShieldCheck},
 hermes:{name:'Hermes',role:'Automatizaciones',color:'#8a96a8',icon:Bot},
};
const owner=(id:string)=>OWNERS[id]||{name:id,role:'',color:'#8a96a8',icon:User};
const STATUS:Record<Column,{name:string;tint:string}>={'para-ti':{name:'Para ti',tint:'#e3c98a'},cola:{name:'En cola',tint:'#9aa6b8'},curso:{name:'En curso',tint:'#7cc4ff'},bloqueado:{name:'Bloqueado',tint:'#ff9f6e'},hecho:{name:'Hecho',tint:'#7fd18b'}};
const ORDER:Column[]=['para-ti','curso','bloqueado','cola','hecho'];
const SMART:{id:string;name:string;icon:any;tint:string}[]=[
 {id:'para-ti',name:'Para ti',icon:Inbox,tint:'#e3c98a'},{id:'hoy',name:'Hoy',icon:Sun,tint:'#f2c14e'},{id:'curso',name:'En curso',icon:Play,tint:'#7cc4ff'},
 {id:'bloqueado',name:'Bloqueado',icon:AlertTriangle,tint:'#ff9f6e'},{id:'cola',name:'En cola',icon:Clock3,tint:'#9aa6b8'},{id:'hecho',name:'Hecho',icon:CircleCheck,tint:'#7fd18b'},{id:'todo',name:'Todo',icon:Layers,tint:'#c9d2de'},
];

function since(iso?:string){
 if(!iso)return '';if(/^\d{2}:\d{2}$/.test(iso))return iso;const t=new Date(iso).getTime();if(!Number.isFinite(t))return '';
 const d=Date.now()-t;if(d<60_000)return 'Ahora';if(d<3_600_000)return `Hace ${Math.floor(d/60_000)} min`;
 const day=new Date(t),today=new Date(),hm=day.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 if(day.toDateString()===today.toDateString())return hm;
 if(new Date(today.getTime()-86_400_000).toDateString()===day.toDateString())return 'Ayer';
 return day.toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','');
}
const isToday=(iso?:string)=>!!iso&&new Date(iso).toDateString()===new Date().toDateString();
function phaseStep(f?:string){return f==='revisando'?4:f==='probando'?3:2}
function phase(i:Item){
 if(i.grupo)return i.grupo.tipo==='medir'?'Cuenta qué salió':'Lo haces tú';
 if(i.fuente==='lote')return i.decisiones?'Necesita tu sí':'Propuesto por Operaciones';
 if(i.fuente==='fusion')return 'Terminado y revisado';
 if(i.fuente==='mesa')return `Pregunta de ${owner(i.propone||'').name}`;
 if(i.fuente==='hermes')return 'Hermes · '+(i.fase||'');
 if(i.columna==='curso')return ({revisando:'En revisión',probando:'Probando'} as any)[i.fase||'']||'Construyendo';
 if(i.columna==='hecho')return i.fusionada?'Fusionada':'Lista para fusionar';
 if(i.columna==='bloqueado')return 'Bloqueada';
 if(i.columna==='cola')return i.fase==='esperando dependencia'?'Espera a otra tarea':'Lista para empezar';
 return i.fase?i.fase[0].toUpperCase()+i.fase.slice(1):'';
}

// The status glyph, Things/Reminders style: ring = to do, arc = in progress, check = done, ! = blocked.
function Glyph({c}:{c:Column}){
 const t=STATUS[c].tint;
 return <svg className={'ob-glyph '+c} viewBox="0 0 20 20" aria-label={STATUS[c].name} role="img">
  {c==='hecho'?<><circle cx="10" cy="10" r="8.5" fill={t}/><path d="M6.3 10.3l2.4 2.3 5-5.1" fill="none" stroke="#0b0d10" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></>
  :c==='curso'?<><circle cx="10" cy="10" r="7.6" fill="none" stroke={t} strokeOpacity=".28" strokeWidth="1.8"/><path className="ob-spin" d="M10 2.4a7.6 7.6 0 0 1 7.6 7.6" fill="none" stroke={t} strokeWidth="1.8" strokeLinecap="round"/></>
  :c==='bloqueado'?<><circle cx="10" cy="10" r="7.6" fill="none" stroke={t} strokeWidth="1.8"/><path d="M10 6v4.6" stroke={t} strokeWidth="1.9" strokeLinecap="round"/><circle cx="10" cy="13.6" r="1.1" fill={t}/></>
  :c==='para-ti'?<><circle cx="10" cy="10" r="7.6" fill="none" stroke={t} strokeWidth="1.8"/><circle cx="10" cy="10" r="3.6" fill={t}/></>
  :<circle cx="10" cy="10" r="7.6" fill="none" stroke={t} strokeOpacity=".7" strokeWidth="1.6" strokeDasharray="2.4 2.2"/>}
 </svg>;
}
function Avatar({id,size=20}:{id:string;size?:number}){const o=owner(id),Icon=o.icon;return <span className="ob-avatar" style={{'--c':o.color,width:size,height:size} as any} title={o.name}><Icon size={Math.round(size*.58)}/></span>;}

const fromAlfred=(i:Item)=>i.fuente==='equipo'&&i.origen==='alfred';

// The engine's plain words over the board: the cards of one experiment become one row that says what to do, a merge says
// which improvements it brings, and a question from the team gets its plain title. The technical cards stay inside.
function plain(items:Item[],status:Status|null):Item[]{
 const grupos:Grupo[]=(status as any)?.para_ti||[],byId=new Map(items.map(i=>[i.id,i])),used=new Set<string>(),out:Item[]=[];
 for(const g of grupos){
  if(g.tipo!=='lanzar'&&g.tipo!=='medir')continue;
  const miembros=g.claves.map(k=>byId.get(k.slice(2))).filter((i):i is Item=>!!i&&i.fuente==='equipo');
  if(!miembros.length)continue;miembros.forEach(m=>used.add(m.id));
  out.push({id:'g:'+g.id,fuente:'equipo',proyecto:g.proyecto||miembros[0].proyecto,titulo:g.titulo,columna:'para-ti',responsable:'owner',
   hora:miembros.map(m=>m.hora||'').sort().pop(),grupo:g,miembros});
 }
 const preguntas=new Map<string,Grupo>();for(const g of grupos)if(g.tipo==='pregunta')for(const k of g.claves)preguntas.set(k.slice(2),g);
 for(const i of items){
  if(used.has(i.id))continue;
  const p=(status as any)?.proyectos?.[i.proyecto],mejoras:string[]=p?.mejoras||[];
  if(i.fuente==='fusion'){const n=Number(p?.por_fusionar)||(Array.isArray(i.detalle)?i.detalle.length:0);
   out.push({...i,titulo:`Juntar ${n} ${n===1?'mejora':'mejoras'} a ${p?.nombre||i.proyecto}`,detalle:mejoras.length?mejoras:i.detalle});continue;}
  if(i.fuente==='lote'){const ds=grupos.filter(g=>g.tipo==='decidir'&&g.claves.some(k=>k.startsWith(`d:${i.proyecto}:`)));
   if(ds.length){out.push({...i,titulo:ds.length===1?ds[0].titulo:`Decidir ${ds.length} cosas de ${p?.nombre||i.proyecto}`,decisiones:ds});continue;}}
  const q=i.fuente==='mesa'?preguntas.get(i.id):undefined;
  out.push(q?{...i,titulo:q.titulo,pregunta:q}:i);
 }
 return out;
}

function fromOffice(entries:Entry[]):Item[]{
 const col:Record<string,Column>={review:'para-ti',queued:'cola',dispatching:'curso',linked:'curso',blocked:'bloqueado',accepted:'hecho'};
 const week=Date.now()-ACCEPTED_VISIBLE_MS;
 return entries.filter(e=>e.kind==='request'&&col[e.status]&&(e.status!=='accepted'||(e.updated_at||0)>week)).map(e=>({
  id:'enc-'+e.id,fuente:'encargo' as const,proyecto:e.project||'general',titulo:e.title,detalle:requestText(e).text,columna:col[e.status],
  responsable:e.status==='review'?'owner':e.role||'alfred',propone:e.role,fase:e.status==='review'?'resultado para revisar':e.status==='blocked'?'bloqueado':e.status==='queued'?'en cola':e.status==='accepted'?'aceptado':'en curso',
  hora:e.updated_at?new Date(e.updated_at).toISOString():'',entry:e}));
}

export function OperationsBoard({office,onSelect,onRequest,onCapture}:{office:any;onSelect:(n:any)=>void;onRequest:()=>void;onCapture:()=>void}){
 const [status,setStatus]=useState<Status|null>(null),[source,setSource]=useState<Source>({kind:'smart',id:'para-ti'}),[query,setQuery]=useState('');
 const [group,setGroup]=useState<'proyecto'|'estado'|'responsable'>('proyecto'),[selected,setSelected]=useState<string|null>(null),[sheet,setSheet]=useState(false),[busy,setBusy]=useState(false);
 const listRef=useRef<HTMLDivElement>(null);
 async function load(){try{const r=await fetch('/api/equipo',{cache:'no-store'});if(r.ok)setStatus(await r.json() as Status);}catch{}}
 useEffect(()=>{load();const t=setInterval(load,10000);return()=>clearInterval(t);},[]);
 const entries:Entry[]=office?.entries||[];
 const all=useMemo(()=>plain([...(((status as any)?.tablero||[]) as Item[]),...fromOffice(entries)],status),[status,entries]);
 const pname=(pid:string)=>status?.proyectos[pid]?.nombre||projects.find(p=>p.id===pid)?.name||status?.hermes?.tableros.find(b=>b.slug===pid)?.nombre||(pid==='general'?'General':pid);
 const projectSources=[...Object.entries(status?.proyectos||{}).map(([id,p])=>({id,name:p.nombre})),{id:'encargo',name:'Encargos a Alfred'},{id:'hermes',name:'Hermes'}];
 const inSource=(i:Item,s:Source)=>s.kind==='owner'?i.responsable===s.id:s.kind==='project'?(s.id==='encargo'?i.fuente==='encargo'||fromAlfred(i):s.id==='hermes'?i.fuente===s.id:i.proyecto===s.id&&i.fuente!=='hermes'&&i.fuente!=='encargo')
  :s.id==='todo'?true:s.id==='hoy'?isToday(i.hora)||i.columna==='curso':i.columna===s.id;
 const expRank=(i:Item)=>i.grupo?(i.grupo.tipo==='lanzar'?0:1):i.fuente!=='equipo'||!i.lanzamiento?2:!i.lanzado?0:!i.medido||i.fase==='falta decidir'?1:2;
 const count=(s:Source)=>all.filter(i=>inSource(i,s)).length;
 const q=query.trim().toLowerCase();
 const list=all.filter(i=>(source.kind==='mesa'||source.kind==='conexiones'||source.kind==='salud'||source.kind==='config')?false:inSource(i,source)).filter(i=>!q||(i.titulo+' '+pname(i.proyecto)+' '+owner(i.responsable).name).toLowerCase().includes(q))
  .sort((a,b)=>ORDER.indexOf(a.columna)-ORDER.indexOf(b.columna)||(a.columna==='para-ti'?expRank(a)-expRank(b):0)||(b.hora||'').localeCompare(a.hora||''));
 const key=(i:Item)=>group==='proyecto'?pname(i.proyecto):group==='responsable'?owner(i.responsable).name:STATUS[i.columna].name;
 const sections=useMemo(()=>{const m=new Map<string,Item[]>();for(const i of list){const k=key(i);m.set(k,[...(m.get(k)||[]),i]);}return [...m.entries()];},[list,group]);// eslint-disable-line
 const flat=sections.flatMap(([,v])=>v);
 const current=flat.find(i=>i.id===selected)||null;
 useEffect(()=>{if(!flat.length){setSelected(null);return;}if(!current&&window.innerWidth>1000)setSelected(flat[0].id);},[source,query,group,status]);// eslint-disable-line
 useEffect(()=>{
  const k=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;if(t&&/input|textarea|select/i.test(t.tagName))return;
   if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const i=flat.findIndex(x=>x.id===selected),n=flat[Math.max(0,Math.min(flat.length-1,i+(e.key==='ArrowDown'?1:-1)))];if(n){setSelected(n.id);listRef.current?.querySelector(`[data-id="${CSS.escape(n.id)}"]`)?.scrollIntoView({block:'nearest'});}}
   if(e.key==='Escape')setSheet(false);};
  window.addEventListener('keydown',k);return()=>window.removeEventListener('keydown',k);
 },[flat,selected]);
 async function pause(){setBusy(true);try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:status?.pausado?'resume':'pause'})});if(r.ok)setStatus(await r.json());}finally{setBusy(false);}}
 const ideas=entries.filter(e=>e.kind==='idea'&&!['cancelled','parked'].includes(e.status)).length;
 const title=source.kind==='smart'?SMART.find(s=>s.id===source.id)?.name:source.kind==='owner'?owner(source.id).name:source.kind==='project'?projectSources.find(p=>p.id===source.id)?.name:source.kind==='mesa'?'Mesa del equipo':source.kind==='config'?'Configuración':source.kind==='salud'?'Salud del sistema':'Conexiones';
 const pick=(s:Source)=>{setSource(s);setSelected(null);setSheet(false);};
 const nav=(s:Source,label:string,icon:ReactNode,n?:number)=>{const on=source.kind===s.kind&&source.id===s.id;return <button key={s.kind+s.id} className={'ob-nav'+(on?' on':'')} aria-current={on?'true':undefined} onClick={()=>pick(s)}>{icon}<span>{label}</span>{n?<b>{n}</b>:null}</button>;};

 return <section className="j-workspace ob">
  <aside className="ob-side" aria-label="Listas">
   <div className="ob-side-scroll">
    <div className="ob-side-group">{SMART.map(s=>{const Icon=s.icon;return nav({kind:'smart',id:s.id},s.name,<span className="ob-ico" style={{color:s.tint}}><Icon size={15}/></span>,count({kind:'smart',id:s.id}));})}</div>
    <h3>Responsables</h3>
    <div className="ob-side-group">{Object.keys(OWNERS).map(id=>nav({kind:'owner',id},owner(id).name,<Avatar id={id} size={18}/>,count({kind:'owner',id})))}</div>
    <h3>Proyectos</h3>
    <div className="ob-side-group">{projectSources.map(p=>nav({kind:'project',id:p.id},p.name,<span className="ob-ico"><FolderClosed size={15}/></span>,count({kind:'project',id:p.id})))}</div>
    <h3>Equipo</h3>
    <div className="ob-side-group">
     {nav({kind:'salud',id:'salud'},'Salud del sistema',<span className="ob-ico"><i className={'sa-dot sa-'+(status?.salud?.resumen||'none')}/></span>,status?.salud?.checks.filter(c=>c.estado!=='ok').length)}
     {nav({kind:'mesa',id:'mesa'},'Mesa del equipo',<span className="ob-ico"><MessagesSquare size={15}/></span>)}
     {nav({kind:'conexiones',id:'conexiones'},'Conexiones',<span className="ob-ico"><Plug size={15}/></span>)}
     {nav({kind:'config',id:'config'},'Configuración',<span className="ob-ico"><Settings size={15}/></span>)}
    </div>
   </div>
   {status&&<button className="ob-team-state" disabled={busy} onClick={pause} title={status.pausado?'Reanudar el equipo':'Pausar el equipo'}><i className={status.pausado?'off':'on'}/>{status.pausado?'Equipo en pausa':'Equipo activo'}<span>{status.pausado?<Play size={13}/>:<Pause size={13}/>}</span></button>}
  </aside>

  {source.kind==='mesa'||source.kind==='conexiones'||source.kind==='salud'||source.kind==='config'?<div className="ob-wide">
   <header className="ob-list-head"><div className="ob-title"><h1>{title}</h1></div></header>
   <div className="ob-wide-body">{source.kind==='config'?<SetupPanel/>:source.kind==='salud'?<SaludView salud={status?.salud}/>:source.kind==='mesa'?(status?.mesa?<MesaView mesa={status.mesa} onSent={setStatus}/>:<p className="ob-blank">La mesa del equipo solo existe en la app del Mac.</p>):<><TelegramLink/>{status?.hermes&&<HermesView hermes={status.hermes}/>}</>}</div>
  </div>:<>
   <div className="ob-main">
    <header className="ob-list-head">
     <div className="ob-title"><h1>{title}</h1><span>{list.length} {list.length===1?'elemento':'elementos'}</span></div>
     <div className="ob-tools">
      <label className="ob-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar entregas"/>{query&&<button onClick={()=>setQuery('')} aria-label="Borrar búsqueda"><X size={12}/></button>}</label>
      <select className="ob-select" value={group} onChange={e=>setGroup(e.target.value as any)} aria-label="Agrupar por"><option value="proyecto">Por proyecto</option><option value="estado">Por estado</option><option value="responsable">Por responsable</option></select>
      <button className="ob-icon-btn" onClick={onCapture} title={`Ideas guardadas${ideas?` (${ideas})`:''}`} aria-label="Ideas guardadas"><Lightbulb size={15}/></button>
      <button className="ob-icon-btn" onClick={onRequest} title="Nuevo encargo a Alfred" aria-label="Nuevo encargo"><Plus size={16}/></button>
     </div>
    </header>
    {source.kind==='smart'&&source.id==='para-ti'&&!q&&list[0]&&(()=>{const n=list[0],verb=n.grupo?(n.grupo.tipo==='medir'?'Contar qué salió':n.grupo.tipo==='lanzar'&&n.miembros?.some(m=>m.fase===FASE_FALTA_FUSIONAR)?'Fusionar y lanzar':'Ver qué hacer'):n.fuente==='lote'?'Revisar y aprobar':n.fuente==='fusion'?'Ver las mejoras':n.fuente==='mesa'?'Responder':n.fuente==='equipo'&&n.fase===FASE_FALTA_FUSIONAR?'Fusionar y lanzar':n.fuente==='equipo'&&n.lanzamiento&&n.lanzado&&!n.medido?'Apuntar lo medido':n.fuente==='equipo'&&n.lanzamiento&&n.medido&&n.fase==='falta decidir'?'Decidir qué hacer':n.fuente==='equipo'&&n.lanzamiento?'Ver el experimento':'Decidir';
     // One clear action: the first decision waiting for the owner, big, with a single button. The full list stays below.
     return <div className="ob-next"><div className="ob-next-text"><span>Lo siguiente{list.length>1?` · ${list.length-1} más después`:''}</span><strong>{n.titulo}</strong><small>{pname(n.proyecto)} · {phase(n)}</small></div><button className="ob-primary" onClick={()=>{setSelected(n.id);setSheet(true);}}>{verb}</button></div>;})()}
    <div className="ob-list" ref={listRef} role="listbox" aria-label={title}>
     {sections.map(([name,rows])=><section key={name} className="ob-sec"><h2>{name}<span>{rows.length}</span></h2>
      {rows.map(i=><button key={i.id} data-id={i.id} role="option" aria-selected={i.id===selected} className={'ob-row'+(i.id===selected?' sel':'')} onClick={()=>{setSelected(i.id);setSheet(true);}} onDoubleClick={()=>{if(i.fuente==='encargo'&&i.entry)onSelect({kind:'task',data:i.entry});}}>
       <Glyph c={i.columna}/>
       <span className="ob-row-text"><strong>{i.titulo}</strong><small>{group!=='proyecto'&&<>{pname(i.proyecto)} · </>}{fromAlfred(i)&&'Encargo de Alfred · '}{phase(i)}{i.medido&&decisionLabel(i.decision)&&' · '+decisionLabel(i.decision)}</small></span>
       <span className="ob-row-meta"><time>{since(i.hora)}</time><Avatar id={i.responsable} size={18}/></span>
      </button>)}
     </section>)}
     {!list.length&&<div className="ob-blank"><CircleCheck size={26}/><p>{q?'Nada coincide con la búsqueda.':source.id==='para-ti'?'Nada espera tu decisión.':'No hay nada aquí.'}</p></div>}
    </div>
   </div>
   <div className={'ob-inspector'+(sheet&&current?' open':'')}>
    {current?<Inspector item={current} status={status} pname={pname} onBack={()=>setSheet(false)} onStatus={setStatus} onOpenEntry={e=>onSelect({kind:'task',data:e})}/>
     :<div className="ob-blank"><Layers size={26}/><p>Selecciona un elemento para ver su detalle.</p></div>}
   </div>
  </>}
 </section>;
}

const Group=({title,children}:{title?:string;children:ReactNode})=><section className="ob-group">{title&&<h4>{title}</h4>}<div className="ob-group-box">{children}</div></section>;
const Line=({label,children}:{label:string;children:ReactNode})=><div className="ob-line"><span>{label}</span><div>{children}</div></div>;

// The inspector: what it is, who has it, where it is in the pipeline, and the evidence behind it.
function Inspector({item,status,pname,onBack,onStatus,onOpenEntry}:{item:Item;status:Status|null;pname:(p:string)=>string;onBack:()=>void;onStatus:(s:Status)=>void;onOpenEntry:(e:Entry)=>void}){
 const o=owner(item.responsable);
 const [reply,setReply]=useState(''),[resultado,setResultado]=useState(''),[decision,setDecision]=useState<Decision|null>(null),[descartando,setDescartando]=useState(false),[motivoDescarte,setMotivoDescarte]=useState(''),[sent,setSent]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const [launching,setLaunching]=useState(false),[launchMsg,setLaunchMsg]=useState<{text:string;error:boolean}|null>(null);
 const current=useRef(item.id);
 current.current=item.id;
 useEffect(()=>{setReply('');setResultado('');setDecision(null);setDescartando(false);setMotivoDescarte('');setSent('');setMore(false);setLaunching(false);setLaunchMsg(null);},[item.id]);
 const encargo=item.fuente==='encargo';
 const steps:readonly string[]=encargo?REQUEST_STEPS:['Propuesta','Aprobada','Construcción','Pruebas','Revisión','Integrada','Fusionada'];
 const at=encargo?requestStep(item.entry?.status||'').at:item.fuente!=='equipo'||item.grupo?-1:item.columna==='cola'?1:item.columna==='curso'?phaseStep(item.fase):item.columna==='hecho'||item.columna==='para-ti'?(item.fusionada?6:5):item.columna==='bloqueado'?phaseStep(item.parada):0;
 const lote=item.fuente==='lote'&&status?status.proyectos[item.proyecto]:null;
 async function answer(){
  if(!reply.trim()||!item.propone)return;setBusy(true);
  try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mensaje',para:item.propone,texto:reply.trim(),responde_a:item.id})});if(r.ok){onStatus(await r.json());setSent('Enviado. Te responden en menos de cinco minutos.');setReply('');}}
  finally{setBusy(false);}
 }
 async function launched(){
  const id=item.id;setLaunching(true);setLaunchMsg(null);
  try{
   const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lanzado',tarea:id})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   if(current.current===id){onStatus(j as Status);setLaunchMsg({text:'Marcado como lanzado.',error:false});}
  }catch(e){if(current.current===id)setLaunchMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setLaunching(false);}
 }
 async function juntar(){
  const id=item.id;setLaunching(true);setLaunchMsg(null);
  try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'fusionar',project:item.proyecto})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   if(current.current===id){onStatus(j as Status);setLaunchMsg({text:'Juntando: te aviso por Telegram cuando acabe.',error:false});}}
  catch(e){if(current.current===id)setLaunchMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setLaunching(false);}
 }
 async function apuntar(){
  const id=item.id,texto=resultado;setLaunching(true);setLaunchMsg(null);
  try{
   const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resultado',project:item.proyecto,tarea:id,texto,...(decision?{decision}:{})})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   if(current.current===id){onStatus(j as Status);setResultado('');setDecision(null);setLaunchMsg({text:'Apuntado.',error:false});}
  }catch(e){if(current.current===id)setLaunchMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setLaunching(false);}
 }
 async function decidir(){
  const id=item.id;if(!decision)return;setLaunching(true);setLaunchMsg(null);
  try{
   const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'decidir',tarea:id,decision})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   if(current.current===id){onStatus(j as Status);setDecision(null);setLaunchMsg({text:'Decisión guardada.',error:false});}
  }catch(e){if(current.current===id)setLaunchMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setLaunching(false);}
 }
 async function descartar(){
  const id=item.id,texto=motivoDescarte.trim();setLaunching(true);setLaunchMsg(null);
  try{
   const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'descartar',tarea:id,texto})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);
   if(current.current===id){onStatus(j as Status);setDescartando(false);setMotivoDescarte('');setLaunchMsg({text:'Descartado.',error:false});}
  }catch(e){if(current.current===id)setLaunchMsg({text:e instanceof Error&&e.message?e.message:'No se ha podido.',error:true});}
  finally{if(current.current===id)setLaunching(false);}
 }
 const motivos=item.revision?.motivos||'';
 return <article className="ob-insp" aria-label={item.titulo}>
  <button className="ob-back" onClick={onBack}><ChevronLeft size={16}/>Lista</button>
  <p className="ob-insp-eyebrow">{pname(item.proyecto)}</p>
  <h2>{item.titulo}</h2>
  <div className="ob-pills">
   <span className="ob-pill"><Avatar id={item.responsable} size={18}/>{o.name}</span>
   <span className="ob-pill status" style={{'--t':STATUS[item.columna].tint} as any}><Glyph c={item.columna}/>{phase(item)}</span>
   {fromAlfred(item)&&<span className="ob-pill plain">Encargo de Alfred</span>}
   {since(item.hora)&&<span className="ob-pill plain">{since(item.hora)}</span>}
  </div>
  {at>=0&&<ol className="ob-track" aria-label="Recorrido">{steps.map((s,i)=><li key={s} className={i<at?'done':i===at?(item.columna==='bloqueado'?'stuck':'now'):''}><i/><span>{s}</span></li>)}</ol>}

  {item.decisiones?.map(d=><PlainDecision key={d.id} g={d} onStatus={onStatus}/>)}
  {lote&&!item.decisiones&&<Group title="Aprueba el lote de hoy"><div className="ob-pad"><BatchApproval id={item.proyecto} project={lote} onDone={onStatus}/></div></Group>}
  {item.pregunta&&<Group title="En pocas palabras">{item.pregunta.que_es&&<Line label="Qué es">{item.pregunta.que_es}</Line>}{item.pregunta.por_que&&<Line label="Por qué">{item.pregunta.por_que}</Line>}</Group>}
  {item.fuente==='mesa'&&<Group title={`${owner(item.propone||'').name} te pregunta`}><div className="ob-pad"><p className="ob-quote">{item.detalle}</p>
   <textarea className="ob-text" value={reply} onChange={e=>setReply(e.target.value)} placeholder="Tu respuesta…" maxLength={1100} rows={3}/>
   <div className="ob-actions"><button className="ob-primary" disabled={busy||!reply.trim()} onClick={answer}><MessageCircle size={14}/>Responder</button>{sent&&<span className="ob-note">{sent}</span>}</div></div></Group>}
  {item.fuente==='fusion'&&Array.isArray(item.detalle)&&<>
   <Group title="Qué trae">{item.detalle.map(t=><div key={t} className="ob-line check"><Check size={14}/><div>{t}</div></div>)}</Group>
   <Group><div className="ob-pad ob-note-block"><GitMerge size={15}/><p>El equipo lo terminó, lo probó y Control lo revisó. Para que llegue a tu proyecto hay que juntarlo: antes lo pruebo otra vez y solo lo junto si todo sigue funcionando. Nada se junta sin ti.</p></div>
    <div className="ob-pad"><div className="ob-actions"><button className="ob-primary" disabled={launching} onClick={juntar}><GitMerge size={14}/>Sí, júntalas</button>{launchMsg&&<span className="ob-note" role="status">{launchMsg.text}</span>}</div></div></Group>
  </>}
  {item.fuente==='encargo'&&item.entry&&<Group title={requestText(item.entry).label}><div className="ob-pad"><p className="ob-body">{typeof item.detalle==='string'?item.detalle:''}</p><div className="ob-actions"><button className="ob-primary" onClick={()=>onOpenEntry(item.entry!)}><ExternalLink size={14}/>{item.columna==='bloqueado'?'Reintentar o cancelar':'Abrir encargo'}</button></div></div></Group>}

  {item.grupo&&<PlainGroup key={item.id} item={item} onStatus={onStatus} pname={pname}/>}
  {(item.fuente==='equipo'||item.fuente==='hermes')&&!item.grupo&&<>
   {item.fuente==='equipo'&&item.lanzamiento&&<Group title="Experimento">
    {item.viene_de&&<><Line label="Viene de">«{item.viene_de.titulo}»</Line>
     {item.viene_de.resultado&&<Line label="Se midió">{item.viene_de.resultado.length>140?item.viene_de.resultado.slice(0,139).trimEnd()+'…':item.viene_de.resultado}</Line>}</>}
    <Line label="Qué se lanza">{item.lanzamiento.que}</Line>
    <Line label="A quién">{item.lanzamiento.a_quien}</Line>
    <Line label="Cómo se mide">{item.lanzamiento.metrica}</Line>
    <Line label="Umbral">{item.lanzamiento.umbral}</Line>
    {item.fuente==='equipo'&&item.lanzamiento&&!item.lanzado&&!item.descartado&&(item.columna==='hecho'||item.columna==='para-ti')&&item.commit&&item.fusionada===false&&/^[a-z0-9-]{2,30}$/.test(item.proyecto)&&<Line label="Antes de lanzar">Aún no está en la versión principal: se fusiona esta noche o júntalo ahora. <button className="ob-link" disabled={launching} onClick={juntar}><GitMerge size={14}/>Fusionar ahora</button></Line>}
    {item.descartado&&<><Line label="Descartado">{since(item.descartado)}</Line><Line label="Motivo">{item.descarte}</Line></>}
    {item.lanzado?<Line label="Lanzado">{since(item.lanzado)}</Line>
     :!item.descartado&&(item.columna==='hecho'||item.columna==='para-ti')&&<div className="ob-pad"><div className="ob-actions"><button className="ob-primary" disabled={launching} onClick={launched}>Ya lo he lanzado</button>
      <button className="ob-link" disabled={launching} onClick={()=>setDescartando(v=>!v)}>No lo voy a lanzar</button>
      {launchMsg&&!descartando&&<span className="ob-note" role="status">{launchMsg.text}</span>}</div>
      {descartando&&<>
       <textarea className="ob-text" value={motivoDescarte} onChange={e=>setMotivoDescarte(e.target.value)} maxLength={RESULTADO_MAX} rows={3} placeholder="Por qué no lo lanzas (el equipo lo tendrá en cuenta)" aria-label="Motivo para no lanzar"/>
       <div className="ob-actions"><button className="ob-primary" disabled={launching||motivoDescarte.trim().length<RESULTADO_MIN} onClick={descartar}>Descartar</button>
        {launchMsg&&<span className="ob-note" role="status">{launchMsg.text}</span>}</div></>}</div>}
    {item.lanzado&&(item.medido?<><Line label="Resultado">{decisionLabel(item.decision)?'Apuntado · '+decisionLabel(item.decision):'Apuntado'}</Line>
     {decisionLabel(item.decision)===null&&<div className="ob-pad"><DecisionPicker value={decision} onChange={setDecision} disabled={launching} className="ob-link"/>
      <div className="ob-actions"><button className="ob-primary" disabled={launching||!decision} onClick={decidir}>Guardar decisión</button></div></div>}</>
     :<div className="ob-pad"><textarea className="ob-text" value={resultado} onChange={e=>setResultado(e.target.value)} maxLength={RESULTADO_MAX} rows={3} placeholder="Qué pasó y con qué cifras" aria-label="Resultado del experimento"/>
      <DecisionPicker value={decision} onChange={setDecision} disabled={launching} className="ob-link"/>
      <div className="ob-actions"><button className="ob-primary" disabled={launching||resultado.trim().length<RESULTADO_MIN} onClick={apuntar}>Apuntar resultado</button></div></div>)}
    {(item.lanzado||item.descartado)&&launchMsg&&<div className="ob-pad"><span className="ob-note" role="status">{launchMsg.text}</span></div>}
   </Group>}
   {(item.detalle||item.motivo)&&<Group title="Contexto">
    {typeof item.detalle==='string'&&item.detalle&&<Line label="Por qué">{item.detalle}</Line>}
    {item.motivo&&<Line label="Bloqueo">{item.motivo}</Line>}
   </Group>}
   {(item.pruebas?.length||item.revision?.decision||item.intentos)?<Group title="Evidencia">
    {item.pruebas?.length?<Line label="Pruebas"><span className="ob-tags">{item.pruebas.map(t=><span key={t.prueba} className={'ob-tag '+(t.ok?'ok':'ko')}>{t.ok?'✓':'✕'} {t.prueba}</span>)}</span></Line>:null}
    {item.revision?.decision&&<Line label="Control">{item.revision.decision==='aprobar'?'Aprobada':'Pidió cambios'}{motivos&&<p className={'ob-clamp'+(more?' open':'')}>{motivos}</p>}{motivos.length>220&&<button className="ob-link" onClick={()=>setMore(!more)}>{more?'Ver menos':'Ver todo'}</button>}</Line>}
    {item.intentos?<Line label="Intentos">{item.intentos}</Line>:null}
   </Group>:null}
   {(item.commit||item.archivos?.length)&&<Group title="Código">
    {item.rama&&<Line label="Rama"><code>{item.rama}</code></Line>}
    {item.commit&&<Line label="Commit"><code>{item.commit.slice(0,8)}</code>{item.fusionada?<span className="ob-note"> · ya en la rama principal</span>:<span className="ob-note"> · por fusionar</span>}</Line>}
    {item.archivos?.length?<Line label="Archivos"><span className="ob-files">{item.archivos.map(f=><code key={f}>{f}</code>)}</span></Line>:null}
   </Group>}
  </>}
 </article>;
}

async function equipoPost(body:object):Promise<Status>{
 const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j:any=await r.json();if(!r.ok)throw new Error(j.error||'No se ha podido.');return j as Status;
}
// One thing to do, said plainly (the same words and buttons as /lote in Telegram), with the team's cards folded away.
function PlainGroup({item,onStatus,pname}:{item:Item;onStatus:(s:Status)=>void;pname:(p:string)=>string}){
 const g=item.grupo!,miembros=item.miembros||[];
 const fusionProjects=[...new Set(miembros.filter(m=>m.fase===FASE_FALTA_FUSIONAR&&m.fusionada===false&&m.fuente==='equipo'&&/^[a-z0-9-]{2,30}$/.test(m.proyecto)).map(m=>m.proyecto))];
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[fichas,setFichas]=useState(false),[resultado,setResultado]=useState(''),[decision,setDecision]=useState<Decision|null>(null);
 const run=async(bodies:object[],ok:string)=>{setBusy(true);setMsg('');try{let s:Status|null=null;for(const b of bodies)s=await equipoPost(b);if(s)onStatus(s);setMsg(ok);}catch(e){setMsg(e instanceof Error?e.message:'No se ha podido.');}finally{setBusy(false);}};
 return <>
  <Group title="Qué tienes que hacer">
   {g.que_es&&<Line label="Qué es">{g.que_es}</Line>}
   {g.tu_parte&&<Line label="Tu parte">{g.tu_parte}</Line>}
   {g.por_que&&<Line label="Por qué">{g.por_que}</Line>}
   {g.tipo==='lanzar'?<div className="ob-pad">{fusionProjects.length>0&&<Line label="Antes de lanzar">Aún no está en la versión principal: se fusiona esta noche o júntalo ahora. {fusionProjects.map(project=><button key={project} className="ob-link" disabled={busy} onClick={()=>run([{action:'fusionar',project}],'Juntando: te aviso por Telegram cuando acabe.')}><GitMerge size={14}/>{fusionProjects.length===1?'Fusionar ahora':'Fusionar '+pname(project)}</button>)}</Line>}<div className="ob-actions">
     <button className="ob-primary" disabled={busy} onClick={()=>run(miembros.map(m=>({action:'lanzado',tarea:m.id})),'Apuntado: ya está en marcha. En unos días te pregunto qué salió.')}><Check size={14}/>Hecho, ya está</button>
     <button className="ob-link" disabled={busy} onClick={()=>run(miembros.map(m=>({action:'descartar',tarea:m.id,texto:'No se va a hacer (decidido desde Entregas).'})),'Hecho: el equipo no lo volverá a pedir.')}>No lo haré</button>
     {msg&&<span className="ob-note" role="status">{msg}</span>}</div></div>
   :<div className="ob-pad"><textarea className="ob-text" value={resultado} onChange={e=>setResultado(e.target.value)} maxLength={RESULTADO_MAX} rows={3} placeholder="Qué pasó y con qué cifras (por ejemplo: 300 vistas, 2 clics)" aria-label="Qué salió"/>
     <DecisionPicker value={decision} onChange={setDecision} disabled={busy} className="ob-link"/>
     <div className="ob-actions"><button className="ob-primary" disabled={busy||resultado.trim().length<RESULTADO_MIN} onClick={()=>run(miembros.map(m=>({action:'resultado',project:m.proyecto,tarea:m.id,texto:resultado.trim(),...(decision?{decision}:{})})),'Apuntado.')}>Apuntar lo que salió</button>
      {msg&&<span className="ob-note" role="status">{msg}</span>}</div></div>}
  </Group>
  {miembros.length>0&&<section className="ob-group"><button className="ob-link ob-fichas" onClick={()=>setFichas(v=>!v)}>{fichas?'Ocultar':'Ver'} {miembros.length===1?'la ficha técnica del equipo':`las ${miembros.length} fichas técnicas del equipo`}</button>
   {fichas&&miembros.map(m=><div key={m.id} className="ob-group-box ob-ficha"><div className="ob-line"><span>Ficha</span><div>{m.titulo}</div></div>
    {m.lanzamiento&&<><Line label="Qué se lanza">{m.lanzamiento.que}</Line><Line label="Cómo se mide">{m.lanzamiento.metrica}</Line><Line label="Umbral">{m.lanzamiento.umbral}</Line></>}</div>)}
  </section>}
 </>;
}

// A decision of the batch in plain words, decided in one tap (the same as «Sí / No / Más tarde» in Telegram).
function PlainDecision({g,onStatus}:{g:Grupo;onStatus:(s:Status)=>void}){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const decide=async(decision:'si'|'no'|'luego',ok:string)=>{setBusy(true);setMsg('');
  try{let s:Status|null=null;for(const k of g.claves){const [,project,indice]=k.split(':');s=await equipoPost({action:'decidir',project,indice:Number(indice),decision});}if(s)onStatus(s);setMsg(ok);}
  catch(e){setMsg(e instanceof Error?e.message:'No se ha podido.');}finally{setBusy(false);}};
 return <Group title={g.titulo}>
  {g.que_es&&<Line label="Qué es">{g.que_es}</Line>}{g.por_que&&<Line label="Por qué">{g.por_que}</Line>}{g.si_dices_que_si&&<Line label="Si dices que sí">{g.si_dices_que_si}</Line>}
  <div className="ob-pad"><div className="ob-actions">
   <button className="ob-primary" disabled={busy} onClick={()=>decide('si','Adelante: el equipo se pone con ello.')}><Check size={14}/>Sí, adelante</button>
   <button className="ob-link" disabled={busy} onClick={()=>decide('no','Hecho: no se hará.')}>No</button>
   <button className="ob-link" disabled={busy} onClick={()=>decide('luego','Te lo vuelvo a preguntar más tarde.')}>Más tarde</button>
   {msg&&<span className="ob-note" role="status">{msg}</span>}</div></div>
 </Group>;
}
