'use client';
// Tendencias: what works now on TikTok, Instagram, YouTube and X, from the content machine's database (read-only).
// Same split view as Entregas and Memoria: sources · list · inspector, with direct links to each piece and account.
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Flame,Users,FileText,Globe2,Layers,FolderClosed,ExternalLink,ChevronLeft,Search,X,Lightbulb} from 'lucide-react';
import {Markdown} from './memory';
import TrendsCarousel from './trends-carousel';
import './board.css';

type Pieza={id:number;brand:string;marca:string;platform:string;kind:string;url:string;author:string;perfil:string;author_followers:number;views:number;likes:number;comments:number;shares:number;
 score:number;format:string|null;faceless:boolean|null;thumb?:boolean;hook:string|null;title:string|null;caption:string|null;transcript:string|null;posted_at:string|null;niche:string;vistas_dia:number};
type Cuenta={autor:string;platform:string;marca:string;perfil:string;seguidores:number;piezas:number;mejor:number;mejor_url:string;mejor_hook:string;vistas_mediana:number};
type Informe={title:string;path:string;updated:number;kind:string};
type Data={disponible:boolean;motivo?:string;marcas:{id:string;nombre:string;n:number;ultimo:string}[];piezas:Pieza[];cuentas:Cuenta[];informes:Informe[]};

const PLAT:Record<string,{name:string;short:string}>={tiktok:{name:'TikTok',short:'TT'},instagram:{name:'Instagram',short:'IG'},youtube:{name:'YouTube',short:'YT'},x:{name:'X',short:'X'},douyin:{name:'Douyin',short:'抖'},xiaohongshu:{name:'Xiaohongshu',short:'红'}};
const BRAND_ICON:Record<string,any>={'':Layers,radar:Globe2};
const num=(n:number)=>n?new Intl.NumberFormat('es-ES',{notation:'compact',maximumFractionDigits:1}).format(n):'—';
const day=(s:string|null)=>s?new Date(s).toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.',''):'';
const headline=(p:Pieza)=>(p.hook||p.title||p.caption||'(sin texto)').replace(/\s+/g,' ').trim();

function Plat({p}:{p:string}){return <span className="tr-plat" aria-label={PLAT[p]?.name||p}>{PLAT[p]?.short||p}</span>;}

export function TrendsView({arriba}:{arriba?:ReactNode}={}){
 const [brand,setBrand]=useState(''),[view,setView]=useState<'piezas'|'cuentas'|'informes'>('piezas'),[platform,setPlatform]=useState(''),[query,setQuery]=useState('');
 const [data,setData]=useState<Data|null>(null),[err,setErr]=useState(''),[selected,setSelected]=useState<string|null>(null),[open,setOpen]=useState(false);
 const [note,setNote]=useState<{text:string;path:string}|null>(null);
 // Pieces as a list or as the 3D carousel; remembered on this Mac.
 const [mode,setMode]=useState<'lista'|'carrusel'>('carrusel');   // the carousel is the preview of the pieces (the owner, 15/10)
 useEffect(()=>{try{if(localStorage.getItem('tr-mode')==='lista')setMode('lista');}catch{}},[]);
 const chooseMode=(m:'lista'|'carrusel')=>{setMode(m);try{localStorage.setItem('tr-mode',m);}catch{}};
 const carousel=view==='piezas'&&mode==='carrusel'&&!!data?.piezas.length;
 useEffect(()=>{let gone=false;const t=setTimeout(()=>{
  const q=new URLSearchParams({brand,platform,q:query.trim(),days:'60'});
  fetch('/api/tendencias?'+q,{cache:'no-store'}).then(async r=>{const j:any=await r.json();if(gone)return;if(!r.ok)throw new Error(j.error);setData(j);setErr('');}).catch(e=>{if(!gone)setErr(e instanceof Error?e.message:'No se han podido leer las tendencias.');});
 },query?250:0);return()=>{gone=true;clearTimeout(t);};},[brand,platform,query]);
 const informes=useMemo(()=>(data?.informes||[]).filter(i=>!brand||(brand==='radar'?i.kind==='oportunidades'||i.title.startsWith('radar'):i.title.startsWith(brand))),[data,brand]);
 const rows:{id:string}[]=view==='piezas'?(data?.piezas||[]).map(p=>({id:'p'+p.id})):view==='cuentas'?(data?.cuentas||[]).map(c=>({id:'c'+c.platform+c.autor})):informes.map(i=>({id:'i'+i.path}));
 useEffect(()=>{if(rows.length&&!rows.some(r=>r.id===selected)&&window.innerWidth>1180)setSelected(rows[0].id);},[data,view,brand]);// eslint-disable-line
 const pieza=view==='piezas'?data?.piezas.find(p=>'p'+p.id===selected):undefined;
 const cuenta=view==='cuentas'?data?.cuentas.find(c=>'c'+c.platform+c.autor===selected):undefined;
 const informe=view==='informes'?informes.find(i=>'i'+i.path===selected):undefined;
 useEffect(()=>{setNote(null);if(!informe)return;let gone=false;
  fetch('/api/nota?path='+encodeURIComponent(informe.path),{cache:'no-store'}).then(r=>r.ok?r.json():null).then((j:any)=>{if(!gone&&j)setNote(j);});return()=>{gone=true;};},[informe?.path]);
 const brands=[{id:'',nombre:'Todo',n:(data?.marcas||[]).reduce((a,m)=>a+m.n,0)},...(data?.marcas||[]).sort((a,b)=>a.id==='radar'?1:b.id==='radar'?-1:a.nombre.localeCompare(b.nombre))];
 const title=view==='informes'?'Informes':view==='cuentas'?'Cuentas que funcionan':'Lo que funciona';
 const brandName=brands.find(b=>b.id===brand)?.nombre||'Todo';
 const last=(data?.marcas||[]).filter(m=>!brand||m.id===brand).map(m=>m.ultimo).sort().pop();
 const pick=(id:string)=>{setSelected(id);setOpen(true);};
 const nav=(id:string,label:string,Icon:any,count?:number,on?:boolean,onClick?:()=>void)=><button key={id} className={'ob-nav'+(on?' on':'')} aria-current={on?'true':undefined} onClick={onClick}><span className="ob-ico"><Icon size={15}/></span><span>{label}</span>{count?<b>{count}</b>:null}</button>;
 return <section className={'j-workspace ob tr'+(carousel?' tr-wide':'')}>
  <aside className="ob-side" aria-label="Tendencias">
   <div className="ob-side-scroll">
    {arriba}
    <h3>Fuentes</h3>
    <div className="ob-side-group">{brands.map(b=>nav('b'+b.id,b.nombre,BRAND_ICON[b.id]||FolderClosed,b.n,brand===b.id,()=>{setBrand(b.id);setSelected(null);setOpen(false);}))}</div>
    <h3>Ver</h3>
    <div className="ob-side-group">
     {nav('v1','Lo que funciona',Flame,undefined,view==='piezas',()=>{setView('piezas');setSelected(null);setOpen(false);})}
     {nav('v2','Cuentas',Users,undefined,view==='cuentas',()=>{setView('cuentas');setSelected(null);setOpen(false);})}
     {nav('v3','Informes',FileText,informes.length,view==='informes',()=>{setView('informes');setSelected(null);setOpen(false);})}
    </div>
   </div>
  </aside>
  <div className="ob-main">
   <header className="ob-list-head">
    <div className="ob-title"><h1>{title}</h1><span>{brandName}{view!=='informes'?' · últimos 60 días':''}{last?` · datos del ${day(last.replace(' ','T')+'Z')}`:''}</span></div>
    {view!=='informes'&&<div className="ob-tools">
     {view==='piezas'&&<div className="tr-seg" role="group" aria-label="Vista">{([['lista','Lista'],['carrusel','Carrusel']] as const).map(([m,l])=><button key={m} className={mode===m?'on':''} aria-pressed={mode===m} onClick={()=>chooseMode(m)}>{l}</button>)}</div>}
     <div className="tr-seg" role="group" aria-label="Plataforma">{['',...Object.keys(PLAT)].map(p=><button key={p||'all'} className={platform===p?'on':''} aria-pressed={platform===p} onClick={()=>{setPlatform(p);setSelected(null);}}>{p?PLAT[p].name:'Todas'}</button>)}</div>
     <label className="ob-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar en tendencias"/>{query&&<button onClick={()=>setQuery('')} aria-label="Borrar búsqueda"><X size={12}/></button>}</label>
    </div>}
   </header>
   {carousel&&data?<TrendsCarousel piezas={data.piezas} selectedId={pieza?.id??null} onCenter={id=>setSelected('p'+id)} onOpen={id=>pick('p'+id)}/>:
   <div className="ob-list" role="listbox" aria-label={title}>
    {view==='piezas'&&data?.piezas.map(p=><button key={p.id} role="option" aria-selected={'p'+p.id===selected} className={'ob-row'+('p'+p.id===selected?' sel':'')} onClick={()=>pick('p'+p.id)}>
     <Plat p={p.platform}/>
     <span className="ob-row-text"><strong>{headline(p)}</strong><small>@{String(p.author||'').replace(/^@/,'')}{p.format&&p.format!=='otro'?' · '+p.format:''}{!brand?' · '+p.marca:''}</small></span>
     <span className="ob-row-meta tr-meta"><span>{num(p.vistas_dia)}<i>/día</i></span></span>
    </button>)}
    {view==='cuentas'&&data?.cuentas.map(c=><button key={c.platform+c.autor} role="option" aria-selected={'c'+c.platform+c.autor===selected} className={'ob-row'+('c'+c.platform+c.autor===selected?' sel':'')} onClick={()=>pick('c'+c.platform+c.autor)}>
     <Plat p={c.platform}/>
     <span className="ob-row-text"><strong>@{c.autor.replace(/^@/,'')}</strong><small>{c.piezas} {c.piezas===1?'pieza':'piezas'} · mediana {num(c.vistas_mediana)} vistas{!brand?' · '+c.marca:''}</small></span>
     <span className="ob-row-meta tr-meta"><span>{c.seguidores?num(c.seguidores):''}{c.seguidores?<i> seg.</i>:null}</span></span>
    </button>)}
    {view==='informes'&&informes.map(i=><button key={i.path} role="option" aria-selected={'i'+i.path===selected} className={'ob-row'+('i'+i.path===selected?' sel':'')} onClick={()=>pick('i'+i.path)}>
     <span className="mm-icon">{i.kind==='oportunidades'?<Lightbulb size={16}/>:<FileText size={16}/>}</span>
     <span className="ob-row-text"><strong>{i.title}</strong><small>{i.kind==='oportunidades'?'Ideas de fuera para el mercado hispano':'Informe de datos'}</small></span>
     <span className="ob-row-meta"><time>{day(new Date(i.updated).toISOString())}</time></span>
    </button>)}
    {!err&&data&&!rows.length&&<div className="ob-blank"><p>{!data.disponible?data.motivo:view==='informes'?'Todavía no hay informes. Salen cada mañana a las 6:15.':'Nada con estos filtros.'}</p></div>}
    {err&&<div className="ob-blank"><p>{err}</p></div>}
    {!data&&!err&&<div className="ob-blank"><p>Leyendo tendencias…</p></div>}
   </div>}
  </div>
  <div className={'ob-inspector'+(open&&(pieza||cuenta||informe)?' open':'')}>
   {pieza?<article className="ob-insp">
    <button className="ob-back" onClick={()=>setOpen(false)}><ChevronLeft size={16}/>{title}</button>
    <p className="ob-insp-eyebrow">{PLAT[pieza.platform]?.name} · {pieza.marca}{pieza.niche==='adyacente'?' · nicho adyacente':''} · {day(pieza.posted_at)}</p>
    <h2>{headline(pieza)}</h2>
    <div className="ob-actions"><a className="ob-primary" href={pieza.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Abrir en {PLAT[pieza.platform]?.name}</a>{pieza.perfil&&<a className="tr-link" href={pieza.perfil} target="_blank" rel="noreferrer">@{String(pieza.author).replace(/^@/,'')}</a>}</div>
    <div className="tr-stats">{[['Vistas al día',num(pieza.vistas_dia)],['Vistas',num(pieza.views)],['Me gusta',num(pieza.likes)],['Comentarios',num(pieza.comments)]].map(([k,v])=><div key={k}><b>{v}</b><span>{k}</span></div>)}</div>
    <div className="ob-group"><h4>Por qué funciona</h4><div className="ob-group-box">
     <div className="ob-line"><span>Formato</span><div>{pieza.format||'Sin clasificar'}{pieza.faceless!=null?(pieza.faceless?' · sin cara':' · con cara'):''}</div></div>
     <div className="ob-line"><span>Puntuación</span><div>{pieza.score.toFixed(2)} <span className="ob-note">frente a lo normal de su cuenta y su plataforma (0 a 1)</span></div></div>
     {pieza.author_followers?<div className="ob-line"><span>Seguidores</span><div>{num(pieza.author_followers)}</div></div>:null}
    </div></div>
    {pieza.caption&&<div className="ob-group"><h4>Texto</h4><div className="ob-group-box"><p className="tr-text">{pieza.caption}</p></div></div>}
    {pieza.transcript&&<div className="ob-group"><h4>Lo que dice</h4><div className="ob-group-box"><p className="tr-text">{pieza.transcript}</p></div></div>}
   </article>
   :cuenta?<article className="ob-insp">
    <button className="ob-back" onClick={()=>setOpen(false)}><ChevronLeft size={16}/>{title}</button>
    <p className="ob-insp-eyebrow">{PLAT[cuenta.platform]?.name} · {cuenta.marca}</p>
    <h2>@{cuenta.autor.replace(/^@/,'')}</h2>
    <div className="ob-actions">{cuenta.perfil&&<a className="ob-primary" href={cuenta.perfil} target="_blank" rel="noreferrer"><ExternalLink size={14}/>Ver la cuenta</a>}{cuenta.mejor_url&&<a className="tr-link" href={cuenta.mejor_url} target="_blank" rel="noreferrer">Su mejor pieza</a>}</div>
    <div className="tr-stats">{[['Piezas',String(cuenta.piezas)],['Mediana de vistas',num(cuenta.vistas_mediana)],['Seguidores',num(cuenta.seguidores)],['Mejor puntuación',cuenta.mejor.toFixed(2)]].map(([k,v])=><div key={k}><b>{v}</b><span>{k}</span></div>)}</div>
    {cuenta.mejor_hook&&<div className="ob-group"><h4>Su mejor gancho</h4><div className="ob-group-box"><p className="tr-text">{cuenta.mejor_hook}</p></div></div>}
   </article>
   :informe?<article className="ob-insp mm-read">
    <button className="ob-back" onClick={()=>setOpen(false)}><ChevronLeft size={16}/>{title}</button>
    <p className="ob-insp-eyebrow">{informe.kind==='oportunidades'?'Oportunidades':'Informe de datos'}</p>
    <h2>{informe.title}</h2>
    <div className="ob-actions">{note&&<a className="ob-primary" href={'obsidian://open?path='+encodeURIComponent(note.path)}><ExternalLink size={14}/>Abrir en Obsidian</a>}</div>
    {note?<Markdown text={note.text}/>:<p className="ob-note">Leyendo…</p>}
   </article>
   :<div className="ob-blank"><p>Elige algo de la lista.</p></div>}
  </div>
 </section>;
}
