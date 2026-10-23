'use client';
// First-run setup of a brand-new copy, one step at a time (name → Claude → notes → agent team), and the same settings
// later as a panel in Entregas. Talks to /api/configurar (local-workspace/configurar.ts); nothing here is personal.
import {useEffect,useState} from 'react';
import {Check,FolderOpen,LogIn,Plus,Trash2} from 'lucide-react';

type Estado={perfil:{nombre:string;apodo:string};claude:{instalado:boolean;version:string;sesion:boolean};notas:{ruta:string;existe:boolean};
 equipo:{instalado:boolean;python:string;propio:boolean;proyectos:{id:string;nombre:string;repo:string;base:string}[];servicio:Record<string,boolean>|null};listo:boolean};

// The desktop app (Electron) offers the system's folder picker; elsewhere the path is typed.
const escritorio=()=>(typeof window!=='undefined'?(window as any).alfredEscritorio:null) as {elegirCarpeta:(t:string)=>Promise<string>}|null;
function Carpeta({value,onChange,placeholder,titulo}:{value:string;onChange:(v:string)=>void;placeholder:string;titulo:string}){
 const e=escritorio();
 return <div className="st-pick"><input value={value} onChange={x=>onChange(x.target.value)} placeholder={placeholder} spellCheck={false}/>
  {e&&<button type="button" className="st-secondary" onClick={async()=>{const r=await e.elegirCarpeta(titulo);if(r)onChange(r);}}>Elegir…</button>}</div>;
}

async function call(accion:string,extra:Record<string,unknown>={}){
 const r=await fetch('/api/configurar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accion,...extra})});
 const j:any=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(j.error||'No se ha podido guardar.');
 return j as {ok:true;aviso?:string;estado?:Estado};
}
export async function leerConfiguracion(fresco=false){
 try{const r=await fetch('/api/configurar'+(fresco?'?fresco=1':''),{cache:'no-store'});return r.ok?await r.json() as Estado:null;}catch{return null;}
}

function useConfig(){
 const [e,setE]=useState<Estado|null>(null);
 useEffect(()=>{leerConfiguracion().then(setE);},[]);
 return [e,setE] as const;
}

function Perfil({e,onSaved,foco=false}:{e:Estado;onSaved:(e:Estado)=>void;foco?:boolean}){
 const [nombre,setNombre]=useState(e.perfil.nombre),[apodo,setApodo]=useState(e.perfil.apodo),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function save(ev:React.FormEvent){ev.preventDefault();setBusy(true);setErr('');try{const r=await call('perfil',{nombre,apodo});if(r.estado)onSaved(r.estado);}catch(x){setErr((x as Error).message);}finally{setBusy(false);}}
 return <form className="st-form" onSubmit={save}>
  <label><span>Tu nombre</span><input autoFocus={foco} value={nombre} onChange={x=>setNombre(x.target.value)} maxLength={60} placeholder="Ana"/></label>
  <label><span>Cómo quieres que te llame Alfred <i>opcional</i></span><input value={apodo} onChange={x=>setApodo(x.target.value)} maxLength={40}/></label>
  <button className="st-primary" disabled={busy||!nombre.trim()}><Check size={15}/>Guardar</button>
  {err&&<p className="st-err">{err}</p>}
 </form>;
}

function Claude({e,onChange}:{e:Estado;onChange:(e:Estado)=>void}){
 const [waiting,setWaiting]=useState(false),[err,setErr]=useState('');
 useEffect(()=>{if(!waiting||e.claude.sesion)return;const id=setInterval(async()=>{const n=await leerConfiguracion(true);if(n){onChange(n);if(n.claude.sesion)setWaiting(false);}},3000);return()=>clearInterval(id);},[waiting,e.claude.sesion]);
 async function login(){setErr('');try{await call('sesion');setWaiting(true);}catch(x){setErr((x as Error).message);}}
 if(e.claude.sesion)return <p className="st-ok"><Check size={15}/>Sesión de Claude iniciada{e.claude.version?` · Claude Code ${e.claude.version}`:''}.</p>;
 if(!e.claude.instalado)return <p className="st-err">No encuentro Claude Code en esta copia de la app.</p>;
 return <div className="st-form">
  <p>Alfred piensa con Claude. Necesitas una cuenta de Claude (Pro o Max) y abrir sesión una vez.</p>
  <button className="st-primary" disabled={waiting} onClick={login}><LogIn size={15}/>{waiting?'Esperando a que aceptes en el navegador…':'Iniciar sesión en Claude'}</button>
  {err&&<p className="st-err">{err}</p>}
 </div>;
}

function Notas({e,onSaved}:{e:Estado;onSaved:(e:Estado,cambia:boolean)=>void}){
 const [ruta,setRuta]=useState(e.notas.ruta),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 async function save(ev:React.FormEvent){ev.preventDefault();setBusy(true);setErr('');try{const r=await call('notas',{ruta});if(r.estado)onSaved(r.estado,true);}catch(x){setErr((x as Error).message);}finally{setBusy(false);}}
 return <form className="st-form" onSubmit={save}>
  <p>Alfred puede leer una carpeta de notas en Markdown (una bóveda de Obsidian sirve). Solo lee: las notas se editan donde siempre.</p>
  <label><span><FolderOpen size={13}/> Carpeta</span><Carpeta value={ruta} onChange={setRuta} placeholder="~/Documentos/Notas" titulo="Tu carpeta de notas"/></label>
  <button className="st-primary" disabled={busy||ruta.trim()===e.notas.ruta}><Check size={15}/>Usar esta carpeta</button>
  {e.notas.ruta&&<p className="st-fine">Ahora: {e.notas.ruta}{e.notas.existe?'':' (no se encuentra)'}</p>}
  {err&&<p className="st-err">{err}</p>}
 </form>;
}

function Equipo({e,onChange}:{e:Estado;onChange:(e:Estado)=>void}){
 const [nombre,setNombre]=useState(''),[repo,setRepo]=useState(''),[objetivo,setObjetivo]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[seguro,setSeguro]=useState(false);
 const q=e.equipo,activo=!!q.servicio&&Object.values(q.servicio).every(Boolean);
 async function act(accion:string,extra:Record<string,unknown>,after?:()=>void){setBusy(true);setMsg('');try{const r=await call(accion,extra);if(r.estado)onChange(r.estado);if(r.aviso)setMsg(r.aviso);after?.();}catch(x){setMsg((x as Error).message);}finally{setBusy(false);}}
 if(!q.instalado)return <p className="st-fine">El equipo de agentes no viene en esta copia.</p>;
 if(!q.python)return <p className="st-fine">El equipo necesita Python 3. Instálalo (python.org) y vuelve a abrir esta pantalla.</p>;
 return <div className="st-form">
  <p>Un equipo de agentes trabaja en tus proyectos de código: propone un plan cada mañana, construye en copias aisladas, prueba y revisa. Nada llega a tu rama principal sin que lo apruebes.</p>
  {q.proyectos.length>0&&<ul className="st-list">{q.proyectos.map(p=><li key={p.id}><div><b>{p.nombre}</b><small>{p.repo} · {p.base}</small></div>
   {!q.propio&&<button className="st-ghost" disabled={busy} onClick={()=>act('quitar-proyecto',{id:p.id})} aria-label={`Quitar ${p.nombre}`}><Trash2 size={14}/></button>}</li>)}</ul>}
  {q.propio?<p className="st-fine">Los proyectos de este equipo se configuran en su repositorio.</p>:<form className="st-sub" onSubmit={ev=>{ev.preventDefault();act('proyecto',{nombre,repo,objetivo},()=>{setNombre('');setRepo('');setObjetivo('');});}}>
   <label><span>Nombre del proyecto</span><input value={nombre} onChange={x=>setNombre(x.target.value)} maxLength={60}/></label>
   <label><span>Carpeta del repositorio (git)</span><Carpeta value={repo} onChange={setRepo} placeholder="~/proyectos/mi-app" titulo="La carpeta del proyecto"/></label>
   <label><span>Objetivo <i>opcional</i></span><input value={objetivo} onChange={x=>setObjetivo(x.target.value)} maxLength={600} placeholder="Qué quieres conseguir con él"/></label>
   <button className="st-secondary" disabled={busy||!nombre.trim()||!repo.trim()}><Plus size={15}/>Añadir proyecto</button>
  </form>}
  {q.proyectos.length>0&&(activo?<button className="st-secondary" disabled={busy} onClick={()=>{if(!seguro){setSeguro(true);return;}setSeguro(false);act('servicio',{activo:false});}}>{seguro?'¿Seguro? Pulsa otra vez para apagarlo':'Apagar el equipo en este ordenador'}</button>
   :<button className="st-primary" disabled={busy} onClick={()=>act('servicio',{activo:true})}>Activar el equipo: plan a las 7:30 y trabajo cada 5 minutos</button>)}
  {msg&&<p className="st-fine">{msg}</p>}
 </div>;
}

const PASOS=[{id:'perfil',titulo:'¿Cómo te llamas?'},{id:'claude',titulo:'Conecta a Alfred con Claude'},{id:'notas',titulo:'Tus notas'},{id:'equipo',titulo:'Tu equipo de agentes'}] as const;

/** A brand-new copy: one step at a time; the optional ones can be skipped. */
export function SetupWizard({onDone}:{onDone:()=>void}){
 const [e,setE]=useConfig(),[paso,setPaso]=useState(0),[reiniciar,setReiniciar]=useState(false);
 if(!e)return null;
 const id=PASOS[paso].id,last=paso===PASOS.length-1;
 const puedeSeguir=id==='perfil'?!!e.perfil.nombre:id==='claude'?e.claude.sesion:true;
 async function next(){
  if(!last){setPaso(paso+1);return;}
  if(reiniciar){try{await call('reiniciar');}catch{}return;}   // the app reloads when the local server is back
  onDone();
 }
 return <div className="st-overlay" role="dialog" aria-modal="true" aria-labelledby="st-title">
  <div className="st-card">
   <p className="st-step">Paso {paso+1} de {PASOS.length}</p>
   <h1 id="st-title">{PASOS[paso].titulo}</h1>
   {id==='perfil'&&<Perfil foco e={e} onSaved={n=>{setE(n);setPaso(1);}}/>}
   {id==='claude'&&<Claude e={e} onChange={setE}/>}
   {id==='notas'&&<Notas e={e} onSaved={(n,c)=>{setE(n);setReiniciar(c);setPaso(paso+1);}}/>}
   {id==='equipo'&&<Equipo e={e} onChange={setE}/>}
   {id!=='perfil'&&<footer className="st-nav">
    {paso>0?<button className="st-ghost" onClick={()=>setPaso(paso-1)}>Atrás</button>:<span/>}
    <button className={puedeSeguir?'st-secondary':'st-ghost'} disabled={!puedeSeguir} onClick={next}>{last?'Terminar':id==='notas'&&!e.notas.ruta?'Ahora no':'Seguir'}</button>
   </footer>}
  </div>
 </div>;
}

/** The same settings, later, as a panel (Entregas → Configuración). */
export function SetupPanel(){
 const [e,setE]=useConfig(),[reiniciar,setReiniciar]=useState(false);
 if(!e)return <p className="ob-blank">La configuración solo existe en la app de escritorio.</p>;
 return <div className="st-panel">
  <section><h2>Tú</h2><Perfil e={e} onSaved={setE}/></section>
  <section><h2>Claude</h2><Claude e={e} onChange={setE}/></section>
  <section><h2>Notas</h2><Notas e={e} onSaved={(n,c)=>{setE(n);setReiniciar(c);}}/>
   {reiniciar&&<button className="st-primary" onClick={()=>call('reiniciar').catch(()=>{})}>Aplicar: reiniciar Alfred</button>}</section>
  <section><h2>Equipo de agentes</h2><Equipo e={e} onChange={setE}/></section>
 </div>;
}
