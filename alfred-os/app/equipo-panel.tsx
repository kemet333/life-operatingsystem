'use client';
import {useEffect,useState} from 'react';
import {Check,Pause,Play,RefreshCw} from 'lucide-react';
import {since} from '../lib/entry-time';
import {useNow} from '../lib/use-now';
import './equipo.css';

type Task={titulo:string;porque?:string;lanzamiento?:{que:string;a_quien:string;metrica:string;umbral:string};importante?:string;retenida?:string;archivos?:string[];depende_de?:number[]};
type Card={id:string;titulo:string;motivo?:string;resultado?:string};
type Lesson={id:string;para:string;texto:string;refuerzos?:number};
type Metrics={tareas:number;integradas:number;a_la_primera:number;bloqueadas:number;fusionadas_por_ti:number;decisiones_tuyas?:number;minutos_hasta_decision?:number|null};
export type Step={id:string;titulo:string;estado:'hecha'|'trabajando'|'en cola'|'bloqueada';hora?:string};
export type Project={nombre:string;rama:string;tareas?:Step[];por_fusionar?:number;lanzamientos_7d?:{avisados:number;lanzados:number;horas_hasta_lanzar:number|null;sin_medir:{tarea:string;titulo:string}[];por_lanzar?:{tarea:string;titulo:string}[];recordados:number;medidos_tras_recordar:number};experimentos?:{fecha:string;hora?:string;texto:string;titulo?:string;tarea?:string}[];aprendizaje?:{lecciones:Lesson[];metricas:Metrics};lote:{estado:string;tareas?:Task[];motivo?:string;ronda?:number};trabajando:Card[];pendientes:Card[];hechas:Card[];bloqueadas:Card[]};
type Msg={id:string;de:string;para:string[];tipo:string;proyecto:string;texto:string;hora:string;responde_a?:string;origen?:string};
export type Mesa={reunion?:{hora:string;resumen:string;acuerdos:{proyecto:string;titulo:string}[]}|null;mensajes:Msg[];departamentos:Record<string,string>};
export type Hermes={tableros:{slug:string;nombre:string;estados:Record<string,number>;revision:string[];bloqueadas:string[];en_curso:string[]}[];programadas:{nombre:string;cada:string;activa:boolean;ultima?:string;estado?:string}[];reloj?:string|null};
export type SaludCheck={id:string;nombre:string;estado:'ok'|'aviso'|'fallo';detalle:string;accion?:string};
export type Salud={hora:string;resumen:'ok'|'aviso'|'fallo';checks:SaludCheck[]};
export type Status={fecha:string;pausado:boolean;proyectos:Record<string,Project>;mesa?:Mesa;hermes?:Hermes;salud?:Salud|null};
type Telegram={estado:'sin-token'|'sin-vincular'|'vinculado'|'error';bot?:string;codigo?:string;nombre?:string;desde?:string;error?:string};

// The agent team (equipo/ engine) seen from the app. One glance: the overall state, what waits for the owner,
// one card per project with its tasks in order; the meeting and the connections stay folded below.
// Only on the Mac app: the web copy has no /api/equipo and this renders nothing.
const ICON:Record<Step['estado'],string>={'hecha':'✓','trabajando':'▶','en cola':'○','bloqueada':'✕'};
const plural=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;
function tally(steps:Step[]){const n=(e:string)=>steps.filter(t=>t.estado===e).length;return [n('hecha')&&plural(n('hecha'),'hecha','hechas'),n('trabajando')&&`${n('trabajando')} trabajando`,n('en cola')&&`${n('en cola')} en cola`,n('bloqueada')&&plural(n('bloqueada'),'bloqueada','bloqueadas')].filter(Boolean).join(' · ');}

function BatchTask({task,off,onToggle,now}:{task:Task;off:boolean;onToggle:()=>void;now:number}){
 const retainedAt=task.retenida?Date.parse(task.retenida):NaN;
 const waiting=task.importante&&Number.isFinite(retainedAt)?since(retainedAt,now):'';
 return <li className={off?'off':''}>
  <button role="checkbox" aria-checked={!off} onClick={onToggle}><i>{off?'':<Check size={12}/>}</i></button>
  <span><strong>{task.titulo}</strong>{task.porque&&<small>{task.porque}</small>}{task.lanzamiento&&<dl className="eq-launch"><div><dt>Qué se lanza</dt><dd>{task.lanzamiento.que}</dd></div><div><dt>A quién</dt><dd>{task.lanzamiento.a_quien}</dd></div><div><dt>Cómo se mide</dt><dd>{task.lanzamiento.metrica}</dd></div><div><dt>Umbral</dt><dd>{task.lanzamiento.umbral}</dd></div></dl>}{task.importante&&<em className="eq-decide">Necesita tu decisión: {task.importante}{waiting&&<small>{waiting==='ahora mismo'?'Te espera desde hace un momento':`Te espera desde ${waiting}`}</small>}</em>}{task.depende_de?.length?<em>Después de la tarea {task.depende_de.map(d=>d+1).join(' y ')}</em>:null}</span>
 </li>;
}

export function EquipoPanel(){
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[skip,setSkip]=useState<Record<string,boolean>>({});
 const now=useNow();
 async function load(){try{const r=await fetch('/api/equipo',{cache:'no-store'});if(r.ok)setStatus(await r.json() as Status);}catch{}}
 useEffect(()=>{load();const t=setInterval(load,15000);return()=>clearInterval(t);},[]);
 async function act(payload:Record<string,unknown>,done:string){
  setBusy(true);setNotice('');
  try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j:any=await r.json();if(!r.ok)throw new Error(j.error);setStatus(j as Status);setNotice(done);}
  catch(e){setNotice(e instanceof Error?e.message:'No se ha podido.');}
  finally{setBusy(false);}
 }
 if(!status)return null;
 const entries=Object.entries(status.proyectos);
 const pending=entries.filter(([,p])=>p.lote.estado==='pendiente'&&p.lote.tareas?.length);
 async function approveAll(){
  setBusy(true);setNotice('');
  try{
   for(const [id,p] of pending){
    const only=(p.lote.tareas||[]).map((_,i)=>i).filter(i=>!skip[id+':'+i]);
    if(!only.length)continue;
    const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',project:id,only})});
    const j:any=await r.json();if(!r.ok)throw new Error(j.error);setStatus(j as Status);
   }
   setNotice('Lote aprobado. El equipo empieza por la primera tarea de cada proyecto.');
  }catch(e){setNotice(e instanceof Error?e.message:'No se ha podido aprobar.');}
  finally{setBusy(false);}
 }
 const chosen=pending.reduce((n,[id,p])=>n+(p.lote.tareas||[]).filter((_,i)=>!skip[id+':'+i]).length,0);
 const all=entries.flatMap(([,p])=>p.tareas||[]),count=(e:string)=>all.filter(t=>t.estado===e).length;
 const title=status.pausado?'El equipo está en pausa.':pending.length?'Tu lote de hoy está listo.':count('trabajando')?`Trabajando en ${plural(count('trabajando'),'tarea','tareas')}.`:count('en cola')?'Hay tareas en cola: empiezan en unos minutos.':count('hecha')?'Lote de hoy terminado.':'Sin trabajo aprobado ahora.';
 const toMerge=entries.filter(([,p])=>(p.por_fusionar||0)>0);
 const mesa=status.mesa,asked=mesa?mesa.mensajes.filter(m=>m.para.includes('owner')&&m.de!=='owner'&&!mesa.mensajes.some(r=>r.de==='owner'&&r.responde_a===m.id)).length:0;
 return <section className="eq" aria-label="Equipo de agentes">
  <header className="eq-head">
   <div><span className="j-eyebrow">EQUIPO DE AGENTES</span><h2>{title}</h2>{all.length>0&&<p className="eq-sub">{tally(all)}</p>}</div>
   <button className="eq-ghost" disabled={busy} onClick={()=>act({action:status.pausado?'resume':'pause'},status.pausado?'Equipo reanudado.':'Equipo en pausa. Lo que esté en marcha termina.')}>{status.pausado?<Play size={14}/>:<Pause size={14}/>}{status.pausado?'Reanudar':'Pausar'}</button>
  </header>

  {(pending.length>0||toMerge.length>0||asked>0)&&<div className="eq-you">
   <h3>PARA TI</h3>
   {pending.length>0&&<div className="eq-batch">
    {pending.map(([id,p])=><div key={id} className="eq-batch-project">
     <h4>{p.nombre}</h4>
     <ol>{(p.lote.tareas||[]).map((t,i)=>{const off=!!skip[id+':'+i];return <BatchTask key={i} task={t} off={off} now={now} onToggle={()=>setSkip(s=>({...s,[id+':'+i]:!off}))}/>;})}</ol>
    </div>)}
    <button className="eq-approve" disabled={busy||!chosen} onClick={approveAll}><Check size={16}/>{chosen?`Aprobar ${chosen} tarea${chosen>1?'s':''}`:'Elige al menos una tarea'}</button>
    <p className="eq-fine">Cada tarea la construye un agente en una copia aislada, se prueba y la revisa otro agente. A main solo pasa cuando tú lo fusionas.</p>
   </div>}
   {toMerge.length>0&&<div className="eq-todo"><b>Revisar y fusionar</b><ul>{toMerge.map(([id,p])=><li key={id}>{p.nombre}<small>{plural(p.por_fusionar||0,'cambio','cambios')} en <code>{p.rama}</code></small></li>)}</ul></div>}
   {asked>0&&<p className="eq-todo"><b>El equipo te pregunta</b><span>{plural(asked,'mensaje espera','mensajes esperan')} tu respuesta en la mesa, más abajo.</span></p>}
  </div>}

  <div className="eq-grid">{entries.map(([id,p])=>{
   const steps=p.tareas||[],busyNow=steps.some(t=>t.estado==='trabajando'),decisionMinutes=p.aprendizaje?.metricas.minutos_hasta_decision;
   return <article key={id} className={'eq-card'+(busyNow?' busy':'')}>
    <header><i className="eq-dot"/><h3>{p.nombre}</h3></header>
    <p className="eq-card-sub">{steps.length?tally(steps):p.lote.estado==='error'?'El plan falló: '+(p.lote.motivo||''):'Sin tareas para hoy'}</p>
    {p.lote.estado==='sin propuestas'&&p.lote.motivo&&<p className="eq-fine">{(p.lote.ronda?`Ronda ${p.lote.ronda}: `:'')+'nada nuevo, '+p.lote.motivo}</p>}
    {steps.length>0&&<ol className="eq-steps">{steps.map(t=><li key={t.id} className={'eq-step '+t.estado.replace(' ','-')}>
     <i aria-hidden="true">{ICON[t.estado]}</i><span>{t.titulo}</span><small>{t.estado==='hecha'?t.hora:t.estado}</small>
    </li>)}</ol>}
    {p.bloqueadas.map(b=><p key={b.id} className="eq-blocked"><strong>{b.titulo}</strong><small>{b.motivo||'Bloqueada, sin motivo registrado.'}</small></p>)}
    <details className="eq-more"><summary>Rama y aprendizaje</summary>
     <p className="eq-fine">Rama <code>{p.rama}</code>{p.por_fusionar?` · ${plural(p.por_fusionar,'cambio','cambios')} sin fusionar`:''}{p.aprendizaje?.metricas.tareas?` · 7 días: ${p.aprendizaje.metricas.integradas}/${p.aprendizaje.metricas.tareas} integradas, ${p.aprendizaje.metricas.a_la_primera} a la primera`:''}{typeof decisionMinutes==='number'&&Number.isFinite(decisionMinutes)&&(p.aprendizaje?.metricas.decisiones_tuyas||0)>0?` · decides en ~${decisionMinutes>=60?(decisionMinutes/60).toFixed(1).replace('.',',')+' h':Math.round(decisionMinutes)+' min'} (mediana de ${p.aprendizaje?.metricas.decisiones_tuyas})`:''}</p>
     {p.aprendizaje?.lecciones.length?<ul className="eq-lessons-list">{p.aprendizaje.lecciones.map(l=><li key={l.id}><b>{l.para}</b>{l.texto}</li>)}</ul>:<p className="eq-fine">Todavía sin lecciones.</p>}
     {p.lote.estado==='sin lote'&&<button className="eq-ghost" disabled={busy} onClick={()=>act({action:'plan',project:id},'Planificando. El lote aparecerá aquí en unos minutos.')}><RefreshCw size={13}/>Planificar ahora</button>}
    </details>
   </article>;})}</div>

  {mesa&&<details className="eq-section" id="eq-mesa" open={asked>0}><summary><b>Mesa del equipo</b><span>{asked?plural(asked,'pregunta para ti','preguntas para ti'):mesa.reunion?'Reunión de las '+mesa.reunion.hora:'Sin reunión hoy'}</span></summary><MesaView mesa={mesa} onSent={setStatus}/></details>}
  <TelegramLink/>
  {status.hermes&&<HermesView hermes={status.hermes}/>}
  {notice&&<p className="eq-notice" role="status">{notice}</p>}
 </section>;
}

const who=(m:Mesa,id:string)=>id==='owner'?'Tú':id==='todos'?'Todos':m.departamentos[id]||id;

// The team's shared conversation: today's meeting summary, what waits for the owner, the thread and a box to write to anyone.
export function MesaView({mesa,onSent}:{mesa:Mesa;onSent:(s:Status)=>void}){
 const [para,setPara]=useState('alfred'),[texto,setTexto]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const msgs=mesa.mensajes,answered=new Set(msgs.filter(m=>m.de==='owner'||m.responde_a).map(m=>m.responde_a));
 const forYou=msgs.filter(m=>m.para.includes('owner')&&m.de!=='owner').slice(-4).reverse();
 const waiting=msgs.filter(m=>m.de==='owner'&&!msgs.some(r=>r.responde_a===m.id));
 async function send(){
  if(!texto.trim())return;setBusy(true);setErr('');
  try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mensaje',para,texto})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);onSent(j as Status);setTexto('');}
  catch(e){setErr(e instanceof Error?e.message:'No se ha enviado.');}finally{setBusy(false);}
 }
 return <div className="eq-mesa">
  {mesa.reunion?.resumen&&<p className="eq-mesa-summary">{mesa.reunion.resumen}</p>}
  {mesa.reunion?.acuerdos?.length?<p className="eq-fine">Acuerdos que pasan al plan: {mesa.reunion.acuerdos.map(a=>a.titulo).join(' · ')}</p>:null}
  {forYou.length>0&&<div className="eq-foryou"><h3>Te escriben</h3>{forYou.map(m=><p key={m.id}><b>{who(mesa,m.de)}</b><span>{m.texto}</span></p>)}</div>}
  {msgs.length>0&&<details className="eq-thread"><summary>Ver la conversación ({msgs.length} mensajes)</summary><ol>{msgs.map(m=><li key={m.id} className={m.de==='owner'?'mine':''}>
   <small>{m.hora} · <b>{who(mesa,m.de)}</b> → {m.para.map(p=>who(mesa,p)).join(', ')} · {m.tipo}{m.proyecto!=='general'?' · '+m.proyecto:''}{m.responde_a?' · re '+m.responde_a:''}</small><span>{m.texto}</span></li>)}</ol></details>}
  <form className="eq-compose" onSubmit={e=>{e.preventDefault();send();}}>
   <select value={para} onChange={e=>setPara(e.target.value)} aria-label="Departamento">{Object.entries(mesa.departamentos).map(([id,name])=><option key={id} value={id}>{name}</option>)}<option value="todos">Todos</option></select>
   <input value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Escribe al equipo…" maxLength={1200} aria-label="Mensaje al equipo"/>
   <button disabled={busy||!texto.trim()}>Enviar</button>
  </form>
  {waiting.length>0&&<p className="eq-fine">Te responderán en unos minutos.</p>}{err&&<p className="eq-notice">{err}</p>}
 </div>;
}

// In the Equipo view: the latest conversation of one department (from or to it). Mac app only.
let cache:{at:number;mesa?:Mesa}|null=null;
export function DeptTalk({dept}:{dept:string}){
 const [mesa,setMesa]=useState<Mesa|null>(cache?.mesa||null);
 useEffect(()=>{let gone=false;if(cache&&Date.now()-cache.at<15000)return;fetch('/api/equipo',{cache:'no-store'}).then(r=>r.ok?r.json():null).then((j:any)=>{if(gone||!j?.mesa)return;cache={at:Date.now(),mesa:j.mesa};setMesa(j.mesa);}).catch(()=>{});return()=>{gone=true;};},[dept]);
 const mine=(mesa?.mensajes||[]).filter(m=>m.de===dept||m.para.includes(dept)).slice(-4).reverse();
 if(!mesa||!mine.length)return null;
 return <div className="eq-dept-talk"><h3>CONVERSACIÓN DE HOY</h3>{mine.map(m=><p key={m.id}><small>{m.hora} · {who(mesa,m.de)} → {m.para.map(p=>who(mesa,p)).join(', ')}</small><span>{m.texto}</span></p>)}</div>;
}

const STATES:Record<string,[string,string]>={running:['en curso','en curso'],review:['en revisión','en revisión'],blocked:['bloqueada','bloqueadas'],ready:['lista','listas'],todo:['por hacer','por hacer'],triage:['sin clasificar','sin clasificar'],done:['hecha','hechas']};
const when=(iso?:string|null)=>iso?new Date(iso).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';

// Hermes' own boards and scheduled jobs, read-only: the owner sees the whole operation from here.
// System health (equipo.py salud, every 5 min): problems first, each with one line of what to do. Stale if the team's
// run has not checked for 20 minutes, which itself means the 5-minute service has stopped.
export function SaludView({salud}:{salud?:Salud|null}){
 if(!salud)return <p className="ob-blank">Todavía no hay ninguna comprobación. La primera llega en el siguiente ciclo del equipo (5 minutos como mucho).</p>;
 const stale=Date.now()-new Date(salud.hora).getTime()>20*60000;
 const problems=salud.checks.filter(c=>c.estado!=='ok').length;
 return <div className="sa">
  <p className="sa-head">{stale?`La última comprobación es del ${when(salud.hora)}: el servicio del equipo parece parado.`:problems?`${problems} ${problems===1?'cosa necesita':'cosas necesitan'} atención · comprobado ${when(salud.hora)}`:`Todo en orden · comprobado ${when(salud.hora)}`}</p>
  <ul>{salud.checks.map(c=><li key={c.id} className={'sa-'+c.estado}><i aria-hidden/><div><b>{c.nombre}</b><span>{c.detalle}</span>{c.estado!=='ok'&&c.accion&&<small>Qué hacer: {c.accion}</small>}</div></li>)}</ul>
  <p className="sa-foot">Si algo se rompe te aviso en el Mac y por Telegram, una vez, y otra cuando se arregla.</p>
 </div>;
}

export function HermesView({hermes}:{hermes:Hermes}){
 if(!hermes.tableros.length&&!hermes.programadas.length)return null;
 const stopped=hermes.reloj&&Date.now()-new Date(hermes.reloj).getTime()>3600000&&hermes.programadas.some(j=>j.activa);
 const boards=hermes.tableros.length;
 return <details className="eq-section eq-hermes"><summary><b>Hermes</b><span>{stopped?'Tareas programadas paradas':`${boards} tablero${boards===1?'':'s'} · solo lectura`}</span></summary>
  {stopped&&<p className="eq-hermes-warn">Sus tareas programadas están paradas desde el {when(hermes.reloj)}.</p>}
  <ul>{hermes.tableros.map(b=>{const order=['running','review','blocked','ready','todo','triage','done'].filter(k=>b.estados[k]);return <li key={b.slug}>
   <strong>{b.nombre}</strong><span>{order.map(k=>`${b.estados[k]} ${STATES[k][b.estados[k]===1?0:1]}`).join(' · ')}</span>
   {(b.revision.length>0||b.bloqueadas.length>0)&&<small>{b.revision.length?'En revisión: '+b.revision.join('; '):''}{b.revision.length&&b.bloqueadas.length?' — ':''}{b.bloqueadas.length?'Bloqueadas: '+b.bloqueadas.join('; '):''}</small>}
  </li>;})}</ul>
  {hermes.programadas.length>0&&<details className="eq-lessons"><summary>Tareas programadas ({hermes.programadas.length})</summary><ul>{hermes.programadas.map(j=><li key={j.nombre}><b>{j.cada}</b>{j.nombre}{j.ultima?` · última ${when(j.ultima)}`:''}{j.estado==='error'?' · con error':''}</li>)}</ul></details>}
 </details>;
}

// Alfred por Telegram: link this Mac's Alfred to the owner's chat with a one-time code shown only here.
export function TelegramLink(){
 const [t,setT]=useState<Telegram|null>(null),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/telegram',{cache:'no-store'});if(r.ok)setT(await r.json() as Telegram);}catch{}}
 useEffect(()=>{load();const id=setInterval(load,8000);return()=>clearInterval(id);},[]);
 async function act(action:string){setBusy(true);try{const r=await fetch('/api/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});if(r.ok)setT(await r.json() as Telegram);}finally{setBusy(false);}}
 if(!t)return null;
 const line=t.estado==='vinculado'?'Vinculado'+(t.bot?' · @'+t.bot:''):t.estado==='sin-vincular'?'Falta vincular tu chat':t.estado==='error'?'No responde':'Falta el token del bot';
 return <details className="eq-section eq-telegram" open={t.estado==='sin-vincular'}><summary><b>Telegram</b><span>{line}</span></summary>
  {t.estado==='vinculado'?<p><span>Alfred te contesta en Telegram{t.bot?<> como <b>@{t.bot}</b></>:null}. Vinculado con {t.nombre} el {when(t.desde)}.</span><button className="eq-ghost" disabled={busy} onClick={()=>act('desvincular')}>Desvincular</button></p>
  :t.estado==='sin-vincular'?<p><span>{t.codigo?<>Envía <b className="eq-code">{t.codigo}</b> a <b>@{t.bot}</b> en Telegram para vincular tu chat.</>:t.error}</span><button className="eq-ghost" disabled={busy} onClick={()=>act('codigo')}>Nuevo código</button></p>
  :t.estado==='error'?<p><span>Telegram no responde: {t.error}</span></p>
  :<TelegramToken/>}
 </details>;
}

// The bot token goes straight to the system's secret store (Keychain, Credential Manager); the page never shows it again.
function TelegramToken(){
 const [token,setToken]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMsg('');
  try{const r=await fetch('/api/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'token',token})});const j:any=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(j.error||'No se ha podido guardar.');setToken('');setMsg('Guardado. Telegram se conecta en menos de un minuto.');}
  catch(x){setMsg((x as Error).message);}finally{setBusy(false);}}
 return <form className="eq-token" onSubmit={save}>
  <span>Crea un bot con <b>@BotFather</b> en Telegram y pega aquí su token. Se guarda en el llavero del sistema.</span>
  <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} placeholder="123456789:AA…"/>
  <button className="eq-ghost" disabled={busy||!token.trim()}>Guardar token</button>
  {msg&&<small>{msg}</small>}
 </form>;
}

// Today's proposed batch for one project: the owner unticks what he doesn't want and approves the rest.
export function BatchApproval({id,project,onDone}:{id:string;project:Project;onDone:(s:Status)=>void}){
 const [skip,setSkip]=useState<Record<number,boolean>>({}),[busy,setBusy]=useState(false),[err,setErr]=useState('');
 const now=useNow();
 const list=project.lote.tareas||[],chosen=list.filter((_,i)=>!skip[i]).length;
 async function approve(){
  setBusy(true);setErr('');
  try{const r=await fetch('/api/equipo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',project:id,only:list.map((_,i)=>i).filter(i=>!skip[i])})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);onDone(j as Status);}
  catch(e){setErr(e instanceof Error?e.message:'No se ha podido aprobar.');}finally{setBusy(false);}
 }
 return <div className="eq-batch">
  <ol>{list.map((t,i)=>{const off=!!skip[i];return <BatchTask key={i} task={t} off={off} now={now} onToggle={()=>setSkip(s=>({...s,[i]:!off}))}/>;})}</ol>
  <button className="eq-approve" disabled={busy||!chosen} onClick={approve}><Check size={16}/>{chosen?`Aprobar ${chosen} tarea${chosen>1?'s':''}`:'Elige al menos una tarea'}</button>
  <p className="eq-fine">Cada tarea la construye un agente en una copia aislada, se prueba y la revisa otro agente. A la rama principal solo pasa cuando tú lo fusionas.</p>
  {err&&<p className="eq-notice">{err}</p>}
 </div>;
}

// One shared, lightly cached read of the team's status for any screen that needs it (badge, headers, panels).
let shared:{at:number;data:Status|null}={at:0,data:null};
const listeners=new Set<(s:Status)=>void>();
let pulling=false;
// A screen that just changed something gets the fresh status back from the server: share it so every panel updates at once.
export function shareEquipo(s:Status){shared={at:Date.now(),data:s};listeners.forEach(f=>f(s));}
export function useEquipo(){
 const [s,setS]=useState<Status|null>(shared.data);
 useEffect(()=>{
  listeners.add(setS);
  const pull=async()=>{if(shared.data&&Date.now()-shared.at<8000){setS(shared.data);return;}
   if(pulling)return;pulling=true; // one request at a time: a slow status must not pile up processes on the Mac
   try{const r=await fetch('/api/equipo',{cache:'no-store'});if(r.ok){shared={at:Date.now(),data:await r.json() as Status};listeners.forEach(f=>f(shared.data!));}}catch{}finally{pulling=false;}};
  pull();const t=setInterval(pull,10000);return()=>{listeners.delete(setS);clearInterval(t);};
 },[]);
 return s;
}

// In a department's panel (Equipo): what it is doing right now and the last thing it delivered, from the team board.
export function DeptWork({dept}:{dept:string}){
 const s=useEquipo(),items:any[]=(s as any)?.tablero||[];
 if(!s)return null;
 const now=items.filter(i=>i.columna==='curso'&&i.responsable===dept);
 const done=items.filter(i=>i.fuente==='equipo'&&i.columna==='hecho'&&(dept==='control'?i.revision?.decision:i.responsable===dept)).sort((a,b)=>(b.hora||'').localeCompare(a.hora||''));
 const when=(iso:string)=>{const d=new Date(iso);return Number.isFinite(d.getTime())?d.toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';};
 if(!now.length&&!done.length)return null;
 return <div className="eq-dept-work">
  <p><small>AHORA</small><span>{now.length?now.map(i=>i.titulo).join(' · '):'Sin tareas en curso.'}</span></p>
  {done[0]&&<p><small>{dept==='control'?'ÚLTIMA REVISIÓN':'ÚLTIMA ENTREGA'}</small><span>{done[0].titulo}</span><em>{when(done[0].hora)} · {done.length} esta semana</em></p>}
 </div>;
}

// Live activity capsule (outside the Alfred screen): only while the team is really working on something, from the
// board's in-progress items and their phase file. Nothing running, nothing shown: never an invented "working".
const PHASE:Record<string,string>={construyendo:'Construyendo',probando:'Probando',revisando:'Revisando'};
export function LiveCapsule({onOpen}:{onOpen:()=>void}){
 const s=useEquipo(),[,tick]=useState(0);
 useEffect(()=>{const t=setInterval(()=>tick(n=>n+1),30000);return()=>clearInterval(t);},[]);
 const now=((s as any)?.tablero||[]).filter((i:any)=>i.columna==='curso'&&i.fuente!=='hermes'&&PHASE[i.fase]);
 if(!s||s.pausado||!now.length)return null;
 const first=now[0],name=s.proyectos?.[first.proyecto]?.nombre||first.proyecto,since=Date.parse(first.hora||'');
 const mins=Number.isFinite(since)?Math.max(0,Math.round((Date.now()-since)/60000)):null;
 const time=mins===null?'':mins<60?`${mins} min`:`${Math.floor(mins/60)} h ${mins%60} min`;
 return <button className="s-live" onClick={onOpen} title={first.titulo} aria-label={`El equipo está ${PHASE[first.fase].toLowerCase()} en ${name}: ${first.titulo}. Abrir Entregas`}>
  <i aria-hidden="true"/><span>{PHASE[first.fase]}<small> · {name}{time&&<em> · {time}</em>}</small></span>{now.length>1&&<b>+{now.length-1}</b>}
 </button>;
}
