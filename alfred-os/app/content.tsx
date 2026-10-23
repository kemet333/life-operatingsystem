'use client';
// Contenido: the content calendar of every project (what goes out, when, and how it looks), the profiles' bio preview and,
// as a third part, Tendencias (what works out there). Same split view as Entregas: sidebar · list by day · inspector.
// The content machine stays the backend: a new time or «ya publicado» is written to its calendar by the local server.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {CalendarDays,UserRound,TrendingUp,Sun,Trophy,Layers,FolderClosed,Clock3,CheckCircle2,Inbox,ChevronLeft,Copy,ExternalLink,EyeOff,Check} from 'lucide-react';
import {TrendsView} from './trends';
import './board.css';
import './content.css';

type Video={nombre:string;path:string};
type Item={id:string;fuente:'maquina'|'plan'|'video';brand:string;marca:string;canal:string;tipo:string;fecha:string|null;titulo:string;gancho:string;texto:string;nota:string;
 estado:'publicado'|'programado'|'postonce'|'tu'|'falta'|'fallo'|'plan'|'sin-fecha';detalle:string;url:string;videos:Video[];portadas:string[];elegido:number;horaEditable:boolean;marcable:boolean};
type Perfil={brand:string;red:string;usuario:string;nombre:string;bio:string;enlace:string;nota:string};
type Data={disponible:boolean;motivo:string;plan:string;items:Item[];perfiles:Perfil[];marcas?:{id:string;nombre:string}[]};

const CANAL:Record<string,{name:string;short:string}>={instagram:{name:'Instagram',short:'IG'},tiktok:{name:'TikTok',short:'TT'},x:{name:'X',short:'X'},youtube:{name:'YouTube',short:'YT'},
 telegram:{name:'Telegram',short:'TG'},discord:{name:'Discord',short:'DC'},email:{name:'Email',short:'@'}};
const TONE:Record<Item['estado'],string>={publicado:'#5fd38d',programado:'#7cb6ff',postonce:'#7cb6ff',tu:'#ffb35c',falta:'#ff7a70',fallo:'#ff7a70',plan:'#a3a7b0','sin-fecha':'#a3a7b0'};
const media=(p:string)=>'/api/contenido/media?p='+encodeURIComponent(p);
const isoDay=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const hm=(s:string)=>new Date(s).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
function dayName(key:string){
 const today=isoDay(new Date()),tomorrow=isoDay(new Date(Date.now()+86400000)),d=new Date(key+'T12:00:00');
 const label=d.toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short'}).replace(/\./g,'');
 return key===today?'Hoy · '+label:key===tomorrow?'Mañana · '+label:label[0].toUpperCase()+label.slice(1);
}
/** «2026-10-21T18:00:00Z» → «2026-10-21T20:00» for <input type=datetime-local> (the Mac's time zone). */
const toLocalInput=(s:string|null)=>{const d=s?new Date(s):new Date(Date.now()+3600000);return isoDay(d)+'T'+d.toTimeString().slice(0,5);};
/** Still to go out: from today on, plus anything overdue that is waiting for the owner. */
const upcoming=(i:Item,startToday:number)=>!!i.fecha&&i.estado!=='publicado'&&(Date.parse(i.fecha)>=startToday||['tu','falta','fallo'].includes(i.estado));
function Canal({c}:{c:string}){return <span className="tr-plat" aria-label={CANAL[c]?.name||c}>{CANAL[c]?.short||c.slice(0,2).toUpperCase()}</span>;}

export function ContentView(){
 const [part,setPart]=useState<'hoy'|'calendario'|'perfiles'|'tendencias'>('hoy');
 const [data,setData]=useState<Data|null>(null),[err,setErr]=useState(''),[brand,setBrand]=useState(''),[show,setShow]=useState<'proximo'|'sin-fecha'|'publicado'>('proximo');
 const [selected,setSelected]=useState<string|null>(null),[open,setOpen]=useState(false),[tick,setTick]=useState(0);
 useEffect(()=>{try{const p=localStorage.getItem('ct-part');if(p==='calendario'||p==='perfiles'||p==='tendencias')setPart(p);}catch{}},[]);
 const choosePart=(p:typeof part)=>{setPart(p);setSelected(null);setOpen(false);try{localStorage.setItem('ct-part',p);}catch{}};
 useEffect(()=>{let gone=false;
  fetch('/api/contenido',{cache:'no-store'}).then(async r=>{const j:any=await r.json();if(gone)return;if(!r.ok)throw new Error(j.error);setData(j);setErr('');})
   .catch(e=>{if(!gone)setErr(e instanceof Error?e.message:'No se ha podido leer el contenido.');});
  return()=>{gone=true;};},[tick]);
 const reload=()=>setTick(t=>t+1);
 const items=useMemo(()=>(data?.items||[]).filter(i=>!brand||i.brand===brand),[data,brand]);
 const BRANDS=[{id:'',nombre:'Todo'},...(data?.marcas||[])];   // the accounts come from the configuration
 const startToday=new Date(new Date().setHours(0,0,0,0)).getTime();
 const lists={
  proximo:items.filter(i=>upcoming(i,startToday)),
  'sin-fecha':items.filter(i=>!i.fecha),
  publicado:items.filter(i=>i.estado==='publicado').reverse(),
 };
 const rows=lists[show];
 const groups=useMemo(()=>{const m=new Map<string,Item[]>();for(const i of rows){const k=i.fecha?isoDay(new Date(i.fecha)):'';if(!m.has(k))m.set(k,[]);m.get(k)!.push(i);}return [...m.entries()];},[rows]);
 const item=rows.find(i=>i.id===selected);
 useEffect(()=>{if(part==='calendario'&&rows.length&&!rows.some(r=>r.id===selected)&&window.innerWidth>1180)setSelected(rows[0].id);},[data,show,brand,part]);// eslint-disable-line
 const perfiles=(data?.perfiles||[]).filter(p=>!brand||p.brand===brand);
 const perfil=part==='perfiles'?perfiles.find(p=>p.brand+p.red===selected)||null:null;
 useEffect(()=>{if(part==='perfiles'&&perfiles.length&&!perfil&&window.innerWidth>1180)setSelected(perfiles[0].brand+perfiles[0].red);},[data,part,brand]);// eslint-disable-line
 const pick=(id:string)=>{setSelected(id);setOpen(true);};
 const nav=(id:string,label:string,Icon:any,count?:number,on?:boolean,onClick?:()=>void)=><button key={id} className={'ob-nav'+(on?' on':'')} aria-current={on?'true':undefined} onClick={onClick}><span className="ob-ico"><Icon size={15}/></span><span>{label}</span>{count?<b>{count}</b>:null}</button>;
 const partsNav=<><h3>Contenido</h3><div className="ob-side-group">
  {nav('ph','Hoy',Sun,undefined,part==='hoy',()=>choosePart('hoy'))}
  {nav('pc','Calendario',CalendarDays,undefined,part==='calendario',()=>choosePart('calendario'))}
  {nav('pp','Perfiles',UserRound,undefined,part==='perfiles',()=>choosePart('perfiles'))}
  {nav('pt','Tendencias',TrendingUp,undefined,part==='tendencias',()=>choosePart('tendencias'))}
 </div></>;
 if(part==='tendencias')return <TrendsView arriba={partsNav}/>;
 if(part==='hoy')return <DayView arriba={partsNav}/>;
 const count=(b:string)=>(data?.items||[]).filter(i=>(!b||i.brand===b)&&upcoming(i,startToday)).length;
 const title=part==='perfiles'?'Perfiles':show==='proximo'?'Próximo':show==='sin-fecha'?'Listos, sin fecha':'Publicado';
 const sub=part==='perfiles'?'Cómo se verá cada cuenta':show==='proximo'?'Lo que sale, día a día':show==='sin-fecha'?'Reels terminados que aún no tienen día':'Las últimas dos semanas';
 return <section className="j-workspace ob ct">
  <aside className="ob-side" aria-label="Contenido">
   <div className="ob-side-scroll">
    {partsNav}
    <h3>Proyectos</h3>
    <div className="ob-side-group">{BRANDS.map(b=>nav('b'+b.id,b.nombre,b.id?FolderClosed:Layers,part==='calendario'?count(b.id):undefined,brand===b.id,()=>{setBrand(b.id);setSelected(null);setOpen(false);}))}</div>
    {part==='calendario'&&<><h3>Mostrar</h3><div className="ob-side-group">
     {nav('sp','Próximo',Clock3,lists.proximo.length,show==='proximo',()=>{setShow('proximo');setSelected(null);setOpen(false);})}
     {nav('ss','Listos, sin fecha',Inbox,lists['sin-fecha'].length,show==='sin-fecha',()=>{setShow('sin-fecha');setSelected(null);setOpen(false);})}
     {nav('sd','Publicado',CheckCircle2,lists.publicado.length,show==='publicado',()=>{setShow('publicado');setSelected(null);setOpen(false);})}
    </div></>}
   </div>
  </aside>
  <div className="ob-main">
   <header className="ob-list-head"><div className="ob-title"><h1>{title}</h1><span>{BRANDS.find(b=>b.id===brand)?.nombre} · {sub}</span></div></header>
   <div className="ob-list" role="listbox" aria-label={title}>
    {part==='calendario'&&groups.map(([k,list])=><section key={k||'none'} className="ob-sec"><h2>{k?dayName(k):'Sin fecha'}<span>{list.length}</span></h2>
     {list.map(i=><button key={i.id} role="option" aria-selected={i.id===selected} className={'ob-row'+(i.id===selected?' sel':'')} onClick={()=>pick(i.id)}>
      <Canal c={i.canal}/>
      <span className="ob-row-text"><strong>{i.titulo}</strong><small>{!brand?i.marca+' · ':''}{i.tipo} · <span className="ct-state" style={{'--t':TONE[i.estado]} as any}>{i.detalle}</span></small></span>
      <span className="ob-row-meta">{i.fecha&&<time>{hm(i.fecha)}</time>}{i.videos.length?<span className="ct-has-video" aria-label="Con vídeo"/>:null}</span>
     </button>)}
    </section>)}
    {part==='perfiles'&&perfiles.map(p=><button key={p.brand+p.red} role="option" aria-selected={p.brand+p.red===selected} className={'ob-row'+(p.brand+p.red===selected?' sel':'')} onClick={()=>pick(p.brand+p.red)}>
     <Canal c={p.red}/>
     <span className="ob-row-text"><strong>{p.nombre}</strong><small>{CANAL[p.red]?.name} · {p.bio?p.bio:'Bio sin decidir'}</small></span>
    </button>)}
    {part==='calendario'&&data&&!rows.length&&<div className="ob-blank"><p>{!data.disponible?(data.motivo||'Todavía no hay contenido.'):show==='proximo'?'Nada programado.':show==='sin-fecha'?'No hay reels esperando fecha.':'Nada publicado en las últimas dos semanas.'}</p></div>}
    {err&&<div className="ob-blank"><p>{err}</p></div>}
    {!data&&!err&&<div className="ob-blank"><p>Leyendo el calendario…</p></div>}
   </div>
  </div>
  <div className={'ob-inspector'+(open&&(item||perfil)?' open':'')}>
   {part==='calendario'&&item?<Detail key={item.id} item={item} plan={data?.plan||''} back={title} onBack={()=>setOpen(false)} onChange={reload}/>
   :part==='perfiles'&&perfil?<ProfileDetail key={perfil.brand+perfil.red} perfil={perfil} items={(data?.items||[]).filter(i=>i.brand===perfil.brand&&i.canal===perfil.red)} onBack={()=>setOpen(false)} onSaved={reload}/>
   :<div className="ob-blank"><p>Elige algo de la lista.</p></div>}
  </div>
 </section>;
}

async function post(body:object){
 const r=await fetch('/api/contenido',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const j:any=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'No se ha podido guardar.');return j;
}

function Detail({item,plan,back,onBack,onChange}:{item:Item;plan:string;back:string;onBack:()=>void;onChange:()=>void}){
 const [v,setV]=useState(Math.min(item.elegido,Math.max(0,item.videos.length-1))),[when,setWhen]=useState(toLocalInput(item.fecha)),[busy,setBusy]=useState(''),[msg,setMsg]=useState(''),[copied,setCopied]=useState(false),[url,setUrl]=useState('');
 const video=item.videos[v],cover=item.portadas[Math.min(v,item.portadas.length-1)];
 const act=async(what:string,body:object,ok:string)=>{setBusy(what);setMsg('');try{await post(body);setMsg(ok);onChange();}catch(e){setMsg(e instanceof Error?e.message:String(e));}finally{setBusy('');}};
 const copy=async()=>{try{await navigator.clipboard.writeText(item.texto);setCopied(true);setTimeout(()=>setCopied(false),1600);}catch{}};
 const changed=when&&toLocalInput(item.fecha)!==when;
 const screen=item.gancho&&item.gancho!==item.texto?item.gancho:'';
 return <article className="ob-insp">
  <button className="ob-back" onClick={onBack}><ChevronLeft size={16}/>{back}</button>
  <p className="ob-insp-eyebrow">{item.marca} · {CANAL[item.canal]?.name||item.canal} · {item.tipo}</p>
  <h2>{item.titulo}</h2>
  <div className="ob-pills"><span className="ob-pill status plain" style={{'--t':TONE[item.estado]} as any}>{item.detalle}</span>{item.fecha&&<span className="ob-pill plain">{new Date(item.fecha).toLocaleString('es-ES',{weekday:'long',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}</span>}</div>
  <div className="ct-preview">
   <div className="ct-phone">
    {video?<video key={video.path} src={media(video.path)} poster={cover?media(cover):undefined} controls playsInline preload="metadata"/>
     :cover?<img src={media(cover)} alt=""/>
     :<div className="ct-phone-text"><p>{screen||item.texto||'Sin texto todavía.'}</p></div>}
   </div>
   {item.videos.length>1&&<div className="tr-seg ct-openings" role="group" aria-label="Apertura">{item.videos.map((x,i)=><button key={x.path} className={i===v?'on':''} aria-pressed={i===v} onClick={()=>setV(i)}>{x.nombre}{i===item.elegido&&item.fuente==='maquina'?' · principal':''}</button>)}</div>}
   {!item.videos.length&&item.estado==='falta'&&<p className="ob-note">Todavía no hay vídeo para esta pieza.</p>}
  </div>
  <div className="ob-group"><h4>Cuándo</h4><div className="ob-group-box ct-when">
   {item.horaEditable?<><input type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)} aria-label="Día y hora"/>
    <button className="ob-primary" disabled={!changed||!!busy} onClick={()=>act('hora',{accion:'hora',id:item.id,fecha:new Date(when).toISOString()},'Hora cambiada.')}>{busy==='hora'?'Guardando…':item.fecha?'Cambiar hora':'Poner fecha'}</button></>
    :<p className="ob-note">{item.estado==='postonce'?'Ya está en PostOnce: la hora se cambia allí.':'Publicado: ya no se cambia.'}</p>}
  </div></div>
  {item.marcable&&<div className="ob-group"><h4>¿Ya ha salido?</h4><div className="ob-group-box ct-when">
   {item.estado==='publicado'?<>{item.url&&<a className="tr-link" href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Ver la publicación</a>}
     <button className="ct-ghost" disabled={!!busy} onClick={()=>act('pub',{accion:'publicado',id:item.id,publicado:false},'Vuelve a estar pendiente.')}>Marcar como pendiente</button></>
    :<><input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Enlace (opcional)" aria-label="Enlace de la publicación"/>
     <button className="ob-primary" disabled={!!busy} onClick={()=>act('pub',{accion:'publicado',id:item.id,publicado:true,url},'Marcado como publicado.')}><Check size={14}/>{busy==='pub'?'Guardando…':'Ya está publicado'}</button></>}
  </div></div>}
  {msg&&<p className="ob-note ct-msg" role="status">{msg}</p>}
  {screen&&<div className="ob-group"><h4>En pantalla</h4><div className="ob-group-box"><p className="tr-text">{screen}</p></div></div>}
  {item.texto&&<div className="ob-group"><h4 className="ct-h4">Texto<button className="ct-ghost" onClick={copy}>{copied?<><Check size={12}/>Copiado</>:<><Copy size={12}/>Copiar</>}</button></h4><div className="ob-group-box"><p className="tr-text">{item.texto}</p></div></div>}
  {item.nota&&<div className="ob-group"><h4>Nota</h4><div className="ob-group-box"><p className="tr-text">{item.nota}</p></div></div>}
  <div className="ob-actions">
   {item.fuente==='plan'&&plan&&<a className="tr-link" href={'obsidian://open?path='+encodeURIComponent(plan)}>Ver el plan en Obsidian</a>}
   {item.fuente==='video'&&!item.fecha&&<button className="ct-ghost" disabled={!!busy} onClick={()=>act('ocultar',{accion:'ocultar',id:item.id},'Oculto.')}><EyeOff size={12}/>Ocultar</button>}
  </div>
  <p className="ob-note ct-source">{item.fuente==='maquina'?'Del calendario de la máquina de contenido.':item.fuente==='plan'?'Del plan de publicaciones del vault.':'Del sistema de contenidos (full-visual).'}</p>
 </article>;
}

function ProfileDetail({perfil,items,onBack,onSaved}:{perfil:Perfil;items:Item[];onBack:()=>void;onSaved:()=>void}){
 const [p,setP]=useState(perfil),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 const changed=(['usuario','nombre','bio','enlace'] as const).some(k=>p[k]!==perfil[k]);
 const save=async()=>{setBusy(true);setMsg('');try{await post({accion:'perfil',perfil:p});setMsg('Guardado. Recuerda cambiarlo también en '+(CANAL[p.red]?.name||p.red)+'.');onSaved();}catch(e){setMsg(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 // The grid shows what the account will look like: the next reels first, then what is already out.
 const grid=items.filter(i=>i.portadas.length||i.videos.length).sort((a,b)=>(b.fecha?Date.parse(b.fecha):0)-(a.fecha?Date.parse(a.fecha):0)).slice(0,9);
 const field=(k:'usuario'|'nombre'|'bio'|'enlace',label:string,max:number,area=false)=><label className="ct-field"><span>{label}<i>{p[k].length}/{max}</i></span>
  {area?<textarea value={p[k]} maxLength={max} rows={3} onChange={e=>setP({...p,[k]:e.target.value})}/>:<input value={p[k]} maxLength={max} onChange={e=>setP({...p,[k]:e.target.value})}/>}</label>;
 return <article className="ob-insp">
  <button className="ob-back" onClick={onBack}><ChevronLeft size={16}/>Perfiles</button>
  <p className="ob-insp-eyebrow">{CANAL[p.red]?.name} · vista previa</p>
  <div className="ct-profile">
   <div className="ct-profile-head"><span className="ct-avatar">{(p.nombre||'?').trim()[0]}</span><div><b>{p.usuario?'@'+p.usuario.replace(/^@/,''):'@usuario'}</b><span>{p.nombre}</span></div></div>
   <p className="ct-bio">{p.bio||<i>Sin bio todavía</i>}</p>
   {p.enlace&&<p className="ct-link">{p.enlace.replace(/^https?:\/\//,'')}</p>}
   {grid.length>0&&<div className="ct-grid">{grid.map(i=>{const c=i.portadas[0];return <div key={i.id} className="ct-tile" title={i.titulo}>{c?<img src={media(c)} alt=""/>:<video src={media(i.videos[0].path)+'#t=1'} muted preload="metadata"/>}{i.estado!=='publicado'&&<em>{i.fecha?new Date(i.fecha).toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.',''):'sin fecha'}</em>}</div>;})}</div>}
  </div>
  <div className="ob-group"><h4>Editar</h4><div className="ob-group-box ct-form">
   {field('nombre','Nombre',64)}{field('usuario','Usuario',40)}{field('bio','Bio',p.red==='x'?160:150,true)}{field('enlace','Enlace',300)}
   <div className="ct-when"><button className="ob-primary" disabled={!changed||busy} onClick={save}>{busy?'Guardando…':'Guardar'}</button></div>
  </div></div>
  {msg&&<p className="ob-note ct-msg" role="status">{msg}</p>}
  {perfil.nota&&<p className="ob-note ct-source">{perfil.nota} Aquí es una vista previa: en {CANAL[p.red]?.name} lo cambias tú.</p>}
 </article>;
}

// ---------- Hoy: the day of the Plan de contenido único ----------
// Per account: the Trial Reels of 10:30 and 17:30 (one video, 3 openings each), the good reel of 20:00 and the winner.
type Apertura={h:string;video:string;texto:string;vistas:number|null};
type Franja={name:string;brand:string;hora:string;titulo:string;estado:'listo'|'haciendose'|'en-cola'|'sin-video'|'subido';aperturas:Apertura[];subido:string|null};
type Cuenta={brand:string;marca:string;franjas:Franja[];bueno:Item|null;ganador:{name:string;h:string;titulo:string;vistas:number|null}|null};
type Dia={fecha:string;cuentas:Cuenta[]};
const ESTADO:Record<Franja['estado'],{label:string;tone:string}>={listo:{label:'Listo para subir',tone:'#ffb35c'},subido:{label:'Subido',tone:'#5fd38d'},haciendose:{label:'Haciéndose esta noche',tone:'#7cb6ff'},'en-cola':{label:'En cola',tone:'#a3a7b0'},'sin-video':{label:'Sin vídeo',tone:'#ff7a70'}};
const dayKey=(offset:number)=>isoDay(new Date(Date.now()+offset*86400000));
function best(c:Cuenta){let b:{f:Franja;a:Apertura}|null=null;for(const f of c.franjas)for(const a of f.aperturas)if(a.vistas!=null&&(!b||a.vistas>(b.a.vistas??-1)))b={f,a};return b;}

function DayView({arriba}:{arriba:ReactNode}){
 const [offset,setOffset]=useState(0),[data,setData]=useState<Dia|null>(null),[err,setErr]=useState(''),[sel,setSel]=useState<string|null>(null),[open,setOpen]=useState(false),[tick,setTick]=useState(0);
 const fecha=dayKey(offset);
 useEffect(()=>{let gone=false;setErr('');
  fetch('/api/contenido/dia?fecha='+fecha,{cache:'no-store'}).then(async r=>{const j:any=await r.json();if(gone)return;if(!r.ok)throw new Error(j.error);setData(j);}).catch(e=>{if(!gone)setErr(e instanceof Error?e.message:'No se ha podido leer el día.');});
  return()=>{gone=true;};},[fecha,tick]);
 const reload=()=>setTick(t=>t+1);
 const rows=(data?.cuentas||[]).flatMap(c=>[...c.franjas.map(f=>({id:f.name,c,f})),{id:'g-'+c.brand,c,f:null as Franja|null}]);
 useEffect(()=>{if(rows.length&&!rows.some(r=>r.id===sel)&&window.innerWidth>1180)setSel(rows[0].id);},[data]);// eslint-disable-line
 const cur=rows.find(r=>r.id===sel);
 const pick=(id:string)=>{setSel(id);setOpen(true);};
 const days:[number,string][]=[[-1,'Ayer'],[0,'Hoy'],[1,'Mañana']];
 const todo=(data?.cuentas||[]).reduce((n,c)=>n+c.franjas.filter(f=>f.estado==='listo').length,0);
 return <section className="j-workspace ob ct">
  <aside className="ob-side" aria-label="Contenido"><div className="ob-side-scroll">{arriba}
   <h3>Día</h3><div className="ob-side-group">{days.map(([o,l])=><button key={o} className={'ob-nav'+(o===offset?' on':'')} aria-current={o===offset?'true':undefined} onClick={()=>{setOffset(o);setSel(null);setOpen(false);}}><span className="ob-ico"><CalendarDays size={15}/></span><span>{l}</span></button>)}</div>
  </div></aside>
  <div className="ob-main">
   <header className="ob-list-head"><div className="ob-title"><h1>{days.find(d=>d[0]===offset)?.[1]}</h1><span>{dayName(fecha)} · 7 vídeos por cuenta{todo?` · ${todo} ${todo===1?'franja lista':'franjas listas'} para subir`:''}</span></div></header>
   <div className="ob-list" role="listbox" aria-label="Vídeos del día">
    {(data?.cuentas||[]).map(c=><section key={c.brand} className="ob-sec"><h2>{c.marca}<span>{c.franjas.reduce((n,f)=>n+f.aperturas.length,0)} vídeos</span></h2>
     {c.franjas.map(f=><button key={f.name} role="option" aria-selected={sel===f.name} className={'ob-row'+(sel===f.name?' sel':'')} onClick={()=>pick(f.name)}>
      <span className="tr-plat">TR</span>
      <span className="ob-row-text"><strong>{f.titulo}</strong><small>Trial Reels · {f.aperturas.length||3} aperturas · <span className="ct-state" style={{'--t':ESTADO[f.estado].tone} as any}>{ESTADO[f.estado].label}</span></small></span>
      <span className="ob-row-meta"><time>{f.hora}</time></span>
     </button>)}
     {c.bueno&&<div className="ob-row ct-static"><span className="tr-plat">IG</span><span className="ob-row-text"><strong>{c.bueno.titulo}</strong><small>Reel bueno · <span className="ct-state" style={{'--t':TONE[c.bueno.estado]} as any}>{c.bueno.detalle}</span></small></span><span className="ob-row-meta"><time>20:00</time></span></div>}
     <button role="option" aria-selected={sel==='g-'+c.brand} className={'ob-row'+(sel==='g-'+c.brand?' sel':'')} onClick={()=>pick('g-'+c.brand)}>
      <span className="ob-ico"><Trophy size={15}/></span>
      <span className="ob-row-text"><strong>{c.ganador?`Ganador: ${c.ganador.titulo}`:'Elegir el ganador'}</strong><small>{c.ganador?`Apertura ${c.ganador.h.slice(1)}${c.ganador.vistas!=null?` · ${c.ganador.vistas} visitas`:''} · reel bueno de mañana`:'Apunta las visitas de los Trial Reels y elige el reel bueno de mañana'}</small></span>
     </button>
    </section>)}
    {data&&!rows.length&&<div className="ob-blank"><p>No hay vídeos para este día todavía.</p></div>}
    {err&&<div className="ob-blank"><p>{err}</p></div>}
    {!data&&!err&&<div className="ob-blank"><p>Leyendo el día…</p></div>}
   </div>
  </div>
  <div className={'ob-inspector'+(open&&cur?' open':'')}>
   {cur?.f?<FranjaDetail key={fecha+cur.f.name} fecha={fecha} f={cur.f} marca={cur.c.marca} onBack={()=>setOpen(false)} onChange={reload}/>
   :cur?<WinnerDetail key={fecha+cur.c.brand} fecha={fecha} c={cur.c} onBack={()=>setOpen(false)} onChange={reload}/>
   :<div className="ob-blank"><p>Elige algo de la lista.</p></div>}
  </div>
 </section>;
}

function FranjaDetail({fecha,f,marca,onBack,onChange}:{fecha:string;f:Franja;marca:string;onBack:()=>void;onChange:()=>void}){
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[copied,setCopied]=useState('');
 const toggle=async()=>{setBusy(true);setMsg('');try{await post({accion:'subido',fecha,name:f.name,subido:!f.subido});onChange();}catch(e){setMsg(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const copy=async(a:Apertura)=>{try{await navigator.clipboard.writeText(a.texto);setCopied(a.h);setTimeout(()=>setCopied(''),1500);}catch{}};
 return <article className="ob-insp">
  <button className="ob-back" onClick={onBack}><ChevronLeft size={16}/>Hoy</button>
  <p className="ob-insp-eyebrow">{marca} · Trial Reels de las {f.hora}</p>
  <h2>{f.titulo}</h2>
  <div className="ob-pills"><span className="ob-pill status plain" style={{'--t':ESTADO[f.estado].tone} as any}>{ESTADO[f.estado].label}</span></div>
  {f.aperturas.length?<div className="ct-trio">{f.aperturas.map(a=><div key={a.h} className="ct-trio-item">
    <div className="ct-phone ct-phone-sm"><video src={media(a.video)} controls playsInline preload="metadata"/></div>
    <div className="ct-trio-foot"><b>Apertura {a.h.slice(1)}</b><button className="ct-ghost" onClick={()=>copy(a)}>{copied===a.h?<><Check size={12}/>Copiado</>:<><Copy size={12}/>Texto</>}</button></div>
   </div>)}</div>
  :<p className="ob-note ct-msg">{f.estado==='haciendose'?'Se está haciendo ahora. Aparece aquí en cuanto termine.':'Todavía no hay vídeo: está en la cola de esta noche.'}</p>}
  {f.aperturas.length>0&&<div className="ob-group"><h4>¿Subidos?</h4><div className="ob-group-box ct-when">
   <p className="ob-note">{f.subido?`Subidos los 3 como Trial Reels.`:'Súbelos como Trial Reels en Instagram (y a las demás redes) y márcalo aquí.'}</p>
   <button className={f.subido?'ct-ghost':'ob-primary'} disabled={busy} onClick={toggle}>{f.subido?'Marcar como no subidos':<><Check size={14}/>Ya los he subido</>}</button>
  </div></div>}
  {msg&&<p className="ob-note ct-msg" role="status">{msg}</p>}
  {f.aperturas[0]?.texto&&<div className="ob-group"><h4>Texto (apertura 1)</h4><div className="ob-group-box"><p className="tr-text">{f.aperturas[0].texto}</p></div></div>}
 </article>;
}

function WinnerDetail({fecha,c,onBack,onChange}:{fecha:string;c:Cuenta;onBack:()=>void;onChange:()=>void}){
 const [busy,setBusy]=useState(''),[msg,setMsg]=useState('');
 const save=async(clave:string,v:string)=>{try{await post({accion:'vistas',fecha,clave,vistas:v.trim()===''?null:Number(v)});onChange();}catch(e){setMsg(e instanceof Error?e.message:String(e));}};
 const b=best(c);
 const choose=async(f:Franja,a:Apertura)=>{setBusy(f.name+a.h);setMsg('');try{await post({accion:'ganador',fecha,brand:c.brand,name:f.name,h:a.h});setMsg('Elegido. Queda apuntado junto a los vídeos del día para que salga mañana a las 20:00.');onChange();}catch(e){setMsg(e instanceof Error?e.message:String(e));}finally{setBusy('');}};
 const openings=c.franjas.flatMap(f=>f.aperturas.map(a=>({f,a})));
 return <article className="ob-insp">
  <button className="ob-back" onClick={onBack}><ChevronLeft size={16}/>Hoy</button>
  <p className="ob-insp-eyebrow">{c.marca} · ganador del día</p>
  <h2>{c.ganador?c.ganador.titulo:b?`Propuesto: ${b.f.titulo}`:'Apunta las visitas'}</h2>
  <p className="ob-note ct-msg">Gana la apertura con más visitas a unas 24 horas; si empatan, la que tenga más compartidos y guardados. Será el reel bueno de mañana a las 20:00.</p>
  {openings.length?<div className="ob-group"><h4>Visitas de cada apertura</h4><div className="ob-group-box">
   {openings.map(({f,a})=>{const key=f.name+'-'+a.h,isBest=b?.f.name===f.name&&b?.a.h===a.h,isWin=c.ganador?.name===f.name&&c.ganador?.h===a.h;
    return <div key={key} className="ct-vrow">
     <span className="ct-vname"><b>{f.hora} · apertura {a.h.slice(1)}</b><small>{f.titulo}</small></span>
     <input id={'v-'+fecha+key} type="number" inputMode="numeric" min={0} defaultValue={a.vistas??''} placeholder="Visitas" aria-label={`Visitas de las ${f.hora}, apertura ${a.h.slice(1)}`} onBlur={e=>{if(String(a.vistas??'')!==e.target.value)save(key,e.target.value);}}/>
     {isWin?<span className="ob-pill status plain" style={{'--t':'#5fd38d'} as any}>Ganador</span>
      :<button className={isBest?'ob-primary':'ct-ghost'} disabled={!!busy} onClick={()=>choose(f,a)}>{busy===f.name+a.h?'Guardando…':isBest?'Elegir (más visitas)':'Elegir'}</button>}
    </div>;})}
  </div></div>:<p className="ob-note ct-msg">Este día no tiene Trial Reels todavía.</p>}
  {msg&&<p className="ob-note ct-msg" role="status">{msg}</p>}
 </article>;
}
