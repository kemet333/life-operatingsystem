'use client';
// Memoria: a window onto what Alfred and the team know. the owner's Obsidian notes are the single source of truth
// (his profile and one note per project); what the team learned (lessons and agreements) sits beside them.
// Read here, edit in Obsidian. Same split view as Entregas: sources · list · reading pane, browsed like the Finder
// (Recientes by day, the vault's folders as folders).
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {User,FolderClosed,Folder,GraduationCap,Handshake,ExternalLink,FileText,ChevronLeft,ChevronRight,Search,X,Clock3} from 'lucide-react';
import {divisions,projects} from '../lib/alfred-data';
import {useEquipo} from './equipo-panel';
import './board.css';

type Doc={id:string;title:string;sub:string;path?:string;body?:ReactNode;updated?:string};
type Source={id:string;name:string;icon:any;docs:Doc[]};
const PROFILE='USER.md';

// A small, safe Markdown reader (no HTML injection): headings, paragraphs, lists, quotes, bold, italics, code, links.
function inline(text:string):ReactNode[]{
 const out:ReactNode[]=[];const re=/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\[[^\]]+\]\]|\*[^*\s][^*]*\*)/g;let last=0,m:RegExpExecArray|null,k=0;
 while((m=re.exec(text))){if(m.index>last)out.push(text.slice(last,m.index));const t=m[0];
  if(t.startsWith('**'))out.push(<strong key={k++}>{t.slice(2,-2)}</strong>);
  else if(t.startsWith('`'))out.push(<code key={k++}>{t.slice(1,-1)}</code>);
  else if(t.startsWith('[['))out.push(<span key={k++} className="mm-wiki">{t.slice(2,-2).split('|').pop()}</span>);
  else if(t.startsWith('[')){const [,label,href]=t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;out.push(/^https?:\/\//.test(href)?<a key={k++} href={href} target="_blank" rel="noreferrer">{label}</a>:<span key={k++}>{label}</span>);}
  else out.push(<em key={k++}>{t.slice(1,-1)}</em>);
  last=m.index+t.length;}
 if(last<text.length)out.push(text.slice(last));return out;
}
export function Markdown({text}:{text:string}){
 const body=text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/,'').replace(/<!--[\s\S]*?-->/g,'');
 const blocks:ReactNode[]=[];let list:{ordered:boolean;items:string[]}|null=null,para:string[]=[],k=0;
 const flush=()=>{if(para.length){blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);para=[];}if(list){const L=list.ordered?'ol':'ul';blocks.push(<L key={k++}>{list.items.map((t,i)=><li key={i}>{inline(t)}</li>)}</L>);list=null;}};
 for(const raw of body.split(/\r?\n/)){const line=raw.trimEnd();
  const h=line.match(/^(#{1,4})\s+(.*)$/),li=line.match(/^\s*[-*]\s+(?:\[[ x]\]\s+)?(.*)$/),ol=line.match(/^\s*\d+[.)]\s+(.*)$/),q=line.match(/^>\s?(.*)$/);
  if(!line.trim()){flush();continue;}
  if(h){flush();const H=(['h2','h3','h4','h4'] as const)[h[1].length-1];blocks.push(<H key={k++}>{inline(h[2])}</H>);continue;}
  if(li||ol){if(para.length){blocks.push(<p key={k++}>{inline(para.join(' '))}</p>);para=[];}const ordered=!!ol;if(!list||list.ordered!==ordered){if(list)flush();list={ordered,items:[]};}list.items.push((li?.[1]??ol?.[1])||'');continue;}
  if(q){flush();blocks.push(<blockquote key={k++}>{inline(q[1])}</blockquote>);continue;}
  if(/^\|/.test(line)){flush();blocks.push(<p key={k++} className="mm-table">{line.split('|').filter(Boolean).map(c=>c.trim()).filter(c=>!/^-+$/.test(c)).join(' · ')}</p>);continue;}
  if(list)flush();para.push(line.trim());}
 flush();return <div className="mm-doc">{blocks}</div>;
}

type Entry={name:string;path:string;updated?:number;count?:number;folder?:string};

// Finder-style day groups: Hoy · Ayer · Últimos 7 días · Este mes · Antes.
function dayGroup(t:number){
 const d=new Date(t),today=new Date();today.setHours(0,0,0,0);const day=new Date(d);day.setHours(0,0,0,0);
 const diff=Math.round((today.getTime()-day.getTime())/86_400_000);
 return diff<=0?'Hoy':diff===1?'Ayer':diff<7?'Últimos 7 días':diff<31?'Este mes':'Antes';
}
const GROUPS=['Hoy','Ayer','Últimos 7 días','Este mes','Antes'];
const shortDate=(t:number)=>{const d=new Date(t);return dayGroup(t)==='Hoy'||dayGroup(t)==='Ayer'?d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','');};
const pretty=(name:string)=>name.replace(/^\d{2}-/,'');

export function MemoryView(){
 const equipo=useEquipo(),[source,setSource]=useState('recientes'),[selected,setSelected]=useState<string|null>(null),[open,setOpen]=useState(false),[query,setQuery]=useState('');
 const [note,setNote]=useState<{text:string;path:string;updated:number;vault:string}|null>(null),[err,setErr]=useState('');
 const [roots,setRoots]=useState<Entry[]>([]),[recent,setRecent]=useState<Entry[]|null>(null),[dir,setDir]=useState(''),[listing,setListing]=useState<{path:string;dirs:Entry[];notes:Entry[]}|null>(null);
 // The vault's top folders and recent notes (local app only; the web copy has no vault).
 useEffect(()=>{fetch('/api/vault?dir=',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((j:any)=>{if(j)setRoots(j.dirs);}).catch(()=>{});},[]);
 useEffect(()=>{if(source!=='recientes')return;fetch('/api/vault/recientes',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((j:any)=>setRecent(j?.notas||[])).catch(()=>setRecent([]));},[source]);
 useEffect(()=>{setListing(null);if(!source.startsWith('dir:'))return;let gone=false;
  fetch('/api/vault?dir='+encodeURIComponent(dir),{cache:'no-store'}).then(r=>r.ok?r.json():null).then((j:any)=>{if(!gone)setListing(j);}).catch(()=>{});return()=>{gone=true;};},[source,dir]);
 const sources:Source[]=useMemo(()=>{
  const lessons=Object.entries(equipo?.proyectos||{}).flatMap(([pid,p])=>(p.aprendizaje?.lecciones||[]).map(l=>({id:'l-'+pid+'-'+l.id,title:l.texto,sub:`${p.nombre} · para ${l.para}`})));
  const agreements=(equipo?.mesa?.reunion?.acuerdos||[]).map((a,i)=>({id:'a-'+i,title:a.titulo,sub:`Acuerdo de la mesa · ${equipo?.proyectos[a.proyecto]?.nombre||a.proyecto}`}));
  const asDoc=(n:Entry,sub:string)=>({id:'n:'+n.path,title:n.name,sub,path:n.path,at:n.updated});
  return [
   {id:'recientes',name:'Recientes',icon:Clock3,docs:(recent||[]).map(n=>asDoc(n,n.folder?pretty(n.folder.split('/').pop()||''):'Vault'))},
   {id:'tu',name:'Tu perfil',icon:User,docs:[{id:'perfil',title:'Tu perfil',sub:'Lo que Alfred sabe de ti',path:PROFILE}]},
   ...divisions.map(d=>({id:'area-'+d.id,name:d.name,icon:FolderClosed,docs:projects.filter(p=>p.division===d.id).map(p=>({id:'p-'+p.id,title:p.name,sub:[p.line,p.stage].filter(Boolean).join(' · '),path:p.note,updated:p.updated}))})),
   ...roots.map(r=>({id:'dir:'+r.path,name:pretty(r.name),icon:Folder,docs:source==='dir:'+r.path?(listing?.notes||[]).map(n=>asDoc(n,'')):[],count:r.count})),
   {id:'lecciones',name:'Lecciones del equipo',icon:GraduationCap,docs:lessons},
   {id:'acuerdos',name:'Acuerdos de la mesa',icon:Handshake,docs:agreements},
  ] as (Source&{count?:number})[];
 },[equipo,recent,roots,listing,source]);
 const current=sources.find(s=>s.id===source)||sources[0];
 const q=query.trim().toLowerCase(),docs=current.docs.filter(d=>!q||(d.title+' '+d.sub).toLowerCase().includes(q));
 const doc=docs.find(d=>d.id===selected)||null;
 useEffect(()=>{if(!doc&&docs.length&&window.innerWidth>1000)setSelected(docs[0].id);},[source,query,sources]);// eslint-disable-line
 useEffect(()=>{
  setNote(null);setErr('');if(!doc?.path)return;let gone=false;
  fetch('/api/nota?path='+encodeURIComponent(doc.path),{cache:'no-store'}).then(async r=>{const j:any=await r.json();if(gone)return;if(!r.ok)throw new Error(j.error);setNote(j);}).catch(e=>{if(!gone)setErr(e instanceof Error?e.message:'No se ha podido leer la nota.');});
  return()=>{gone=true;};
 },[doc?.path]);
 const choose=(id:string)=>{setSource(id);setSelected(null);setOpen(false);setQuery('');if(id.startsWith('dir:'))setDir(id.slice(4));};
 const learned=source==='lecciones'||source==='acuerdos',isDir=source.startsWith('dir:'),dated=source==='recientes'||isDir;
 const crumbs=isDir?dir.split('/').map((name,i,all)=>({name:pretty(name),path:all.slice(0,i+1).join('/')})):[];
 const subdirs=isDir&&!q?(listing?.dirs||[]):[];
 const groups=dated?GROUPS.map(g=>[g,docs.filter(d=>(d as any).at&&dayGroup((d as any).at)===g)] as const).filter(([,v])=>v.length):[['',docs] as const];
 const nav=(s:Source&{count?:number})=>{const Icon=s.icon;const n=s.id.startsWith('dir:')?s.count:s.id==='recientes'||s.id==='tu'?undefined:s.docs.length;return <button key={s.id} className={'ob-nav'+(s.id===source?' on':'')} aria-current={s.id===source?'true':undefined} onClick={()=>choose(s.id)}><span className="ob-ico"><Icon size={15}/></span><span>{s.name}</span>{n?<b>{n}</b>:null}</button>;};
 const row=(d:Doc&{at?:number})=><button key={d.id} role="option" aria-selected={d.id===selected} className={'ob-row'+(d.id===selected?' sel':'')} onClick={()=>{setSelected(d.id);setOpen(true);}}>
   <span className="mm-icon"><FileText size={16}/></span>
   <span className="ob-row-text"><strong>{d.title}</strong>{d.sub&&<small>{d.sub}</small>}</span>
   <span className="ob-row-meta">{d.at?<time>{shortDate(d.at)}</time>:d.updated&&<time>{new Date(d.updated+'T12:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','')}</time>}</span>
  </button>;
 return <section className="j-workspace ob mm">
  <aside className="ob-side" aria-label="Memoria">
   <div className="ob-side-scroll">
    <h3>Favoritos</h3>
    <div className="ob-side-group">{sources.filter(s=>s.id==='recientes'||s.id==='tu').map(nav)}</div>
    <h3>Proyectos</h3>
    <div className="ob-side-group">{sources.filter(s=>s.id.startsWith('area-')).map(nav)}</div>
    {roots.length>0&&<><h3>Carpetas del vault</h3>
    <div className="ob-side-group">{sources.filter(s=>s.id.startsWith('dir:')).map(nav)}</div></>}
    <h3>Lo que Alfred ha aprendido</h3>
    <div className="ob-side-group">{sources.filter(s=>['lecciones','acuerdos'].includes(s.id)).map(nav)}</div>
   </div>
  </aside>
  <div className="ob-main">
   <header className="ob-list-head">
    <div className="ob-title">{isDir&&crumbs.length>1?<nav className="mm-crumbs" aria-label="Ruta">{crumbs.map((c,i)=><span key={c.path}>{i>0&&<ChevronRight size={13}/>}{i<crumbs.length-1?<button onClick={()=>{setDir(c.path);setSelected(null);}}>{c.name}</button>:<h1>{c.name}</h1>}</span>)}</nav>:<h1>{current.name}</h1>}
     <span>{learned?'Lo extrae el equipo de su trabajo real':source==='recientes'?'Lo último que has tocado en Obsidian':'Desde tus notas de Obsidian'}</span></div>
    <div className="ob-tools"><label className="ob-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar en memoria"/>{query&&<button onClick={()=>setQuery('')} aria-label="Borrar búsqueda"><X size={12}/></button>}</label></div>
   </header>
   <div className="ob-list" role="listbox" aria-label={current.name}>
    {subdirs.length>0&&<div className="mm-folders">{subdirs.map(f=><button key={f.path} className="mm-folder" onClick={()=>{setDir(f.path);setSelected(null);}}><span className="mm-folder-icon" aria-hidden="true"/><strong>{pretty(f.name)}</strong><small>{f.count} {f.count===1?'elemento':'elementos'}</small></button>)}</div>}
    {groups.map(([name,rows])=>rows.length?<section key={name||'all'} className="ob-sec">{name&&<h2>{name}<span>{rows.length}</span></h2>}{rows.map(row)}</section>:null)}
    {!docs.length&&!subdirs.length&&<div className="ob-blank"><p>{learned?'Todavía no hay nada aprendido aquí. Se llena con la retro diaria del equipo.':source==='recientes'&&recent===null?'Leyendo tus notas…':isDir&&!listing?'Abriendo la carpeta…':'No hay notas aquí.'}</p></div>}
   </div>
  </div>
  <div className={'ob-inspector'+(open&&doc?' open':'')}>
   {doc?<article className="ob-insp mm-read">
    <button className="ob-back" onClick={()=>setOpen(false)}><ChevronLeft size={16}/>{current.name}</button>
    <p className="ob-insp-eyebrow">{current.name}</p>
    <h2>{doc.title}</h2>
    {doc.path?<>
     <div className="ob-actions">{note&&<a className="ob-primary" href={'obsidian://open?path='+encodeURIComponent(note.path)}><ExternalLink size={14}/>Editar en Obsidian</a>}{note&&<span className="ob-note">Modificada el {new Date(note.updated).toLocaleDateString('es-ES',{day:'numeric',month:'short',year:'numeric'})}</span>}</div>
     {note?<Markdown text={note.text}/>:err?<p className="ob-note">{err}</p>:<p className="ob-note">Leyendo la nota…</p>}
    </>:<div className="mm-doc"><p>{doc.title}</p><p className="ob-note">{doc.sub}</p></div>}
   </article>:<div className="ob-blank"><p>Elige una nota para leerla.</p></div>}
  </div>
 </section>;
}
