'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,Pause,Play,Feather,PenLine,ArrowUpRight,ChevronDown,MessageCircle,Plus,ArrowLeft} from 'lucide-react';
import Orb,{type OrbMode} from './orb';
import {firstSteps,type FocusSession} from '../lib/focus';
import {projects,divisions} from '../lib/alfred-data';
import {useEquipo} from './equipo-panel';
import {usePerfil,llamar} from './perfil';
export default function FocusConsole({office,act,mode,level,chat,onProject,onCapture,onReview,embedded=false,onBack}:{office:any;act:(v:any)=>Promise<any>;mode:OrbMode;level:number;chat:()=>void;onProject:()=>void;onCapture:()=>void;onReview:()=>void;embedded?:boolean;onBack?:()=>void}){
 const who=llamar(usePerfil());
 const project=projects.find(p=>p.id===office?.settings.focus)||projects.find(p=>p.id==='tf')!;
 const session:FocusSession|null=office?.focusSession||null,step=firstSteps[project.id],low=office?.settings.energy==='low';
 const [expanded,setExpanded]=useState(embedded);
 const equipo=useEquipo();
 const expandButton=useRef<HTMLButtonElement>(null),stepHeading=useRef<HTMLHeadingElement>(null);
 const [editing,setEditing]=useState(false),[note,setNote]=useState(''),[title,setTitle]=useState(''),[criterion,setCriterion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[now,setNow]=useState(0);
 const draftRef=useRef<{id:string;text:string;baseRevision:number;dirty:boolean}|null>(null);
 const noteField=useRef<HTMLTextAreaElement>(null);
 const currentProject=projects.find(p=>p.id===session?.project)||project;
 const status=session?.status||'ready',completed=status==='completed',active=status==='active',paused=status==='paused';
 const originalTitle=session?.title||(low?step[2]:step[0]);
 const promiseStep=currentProject.id==='tf'&&[firstSteps.tf[0],'Define a quién vas a ayudar.'].includes(originalTitle);
 const shownTitle=promiseStep?firstSteps.tf[0]:originalTitle;
 const shownCriterion=session?.doneWhen&&session.doneWhen!=='Una frase: «Ayudamos a ___ a elegir ___ sin ___».'?session.doneWhen:promiseStep?firstSteps.tf[1]:(low?'Una frase escrita. Con eso basta para este paso.':step[1]);
 const example='Ayudamos a traders a elegir una empresa de fondeo sin miedo a equivocarse.';
 useEffect(()=>{
  if(!session)return;
  let current=draftRef.current;
  if(current?.id!==session.id){
   let saved:any=null;try{saved=JSON.parse(localStorage.getItem('alfred-step-draft:'+session.id)||'null');}catch{}
   current={id:session.id,text:typeof saved?.text==='string'?saved.text:session.note,baseRevision:typeof saved?.baseRevision==='number'?saved.baseRevision:session.revision,dirty:typeof saved?.text==='string'&&saved.text!==session.note};
  }
  if(!current.dirty||current.text===session.note)current={id:session.id,text:session.note,baseRevision:session.revision,dirty:false};
  draftRef.current=current;setNote(current.text);
 },[session?.id,session?.revision]);

 useEffect(()=>{setNow(Date.now());if(!active)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[active]);
 const elapsed=(session?.elapsed||0)+(active&&session?.startedAt?Math.max(0,now-session.startedAt):0),duration=(session?.minutes|| (low?5:10))*60000,remaining=Math.max(0,duration-elapsed),percent=Math.min(100,elapsed/duration*100);
 async function change(command:string,extra:any={}){
  setBusy(true);setError('');
  try{const result=await act({action:'focus',command,id:session?.id,revision:draftRef.current?.dirty?draftRef.current.baseRevision:session?.revision,note,...extra});const next=result.session as FocusSession;draftRef.current={id:next.id,text:next.note,baseRevision:next.revision,dirty:false};setNote(next.note);try{localStorage.removeItem('alfred-step-draft:'+next.id);}catch{}setEditing(false);}
  catch(e){setError(e instanceof Error?e.message:'No se pudo guardar.');}finally{setBusy(false);}
 }
 function writeDraft(text:string){setNote(text);if(!session)return;const draft={id:session.id,text,baseRevision:draftRef.current?.baseRevision??session.revision,dirty:true};draftRef.current=draft;try{localStorage.setItem('alfred-step-draft:'+session.id,JSON.stringify(draft));}catch{}}
 function smaller(){if(!session){create(true);return;}const presets=firstSteps[currentProject.id];if(![presets[0],presets[2],...(currentProject.id==='tf'?['Define a quién vas a ayudar.']:[])].includes(session.title)){setTitle(session.title);setCriterion(session.doneWhen);setEditing(true);return;}change('edit',{title:presets[2],doneWhen:'Una frase escrita. Con eso basta para este paso.',minutes:5});}

 const create=(small=false,start=false)=>change('create',{id:crypto.randomUUID(),previousId:session?.id,revision:session?.revision,project:project.id,title:small?step[2]:(low?step[2]:step[0]),doneWhen:small||low?'Una frase escrita. Con eso basta para este paso.':step[1],minutes:small||low?5:10,start});
 const ready=(office?.entries||[]).filter((e:any)=>e.kind==='request'&&e.status==='review');
 // The next thing that truly waits for the owner (team board first, then results to review). A step already in progress keeps priority.
 const rankOf:Record<string,number>={lote:0,mesa:1,fusion:2,encargo:3,hermes:4};
 const waiting=((((equipo as any)?.tablero)||[]) as any[]).filter(i=>i.columna==='para-ti').sort((a,b)=>(rankOf[a.fuente]??9)-(rankOf[b.fuente]??9));
 const total=waiting.length+ready.length,top=waiting[0];
 const decision=active||!total?null:top?{where:top.fuente==='mesa'?'Pregunta del equipo':(equipo?.proyectos?.[top.proyecto]?.nombre||projects.find(p=>p.id===top.proyecto)?.name||'General'),
   title:top.fuente==='mesa'?String(top.titulo):top.titulo}:{where:projects.find(p=>p.id===ready[0].project)?.name||'Entrega',title:'Revisar: '+ready[0].title};
 return <section className={'f-console '+(active?'is-active':'')+(low?' is-quiet':'')+(expanded?' is-expanded':' is-resting')} aria-label="Alfred y tu siguiente paso">
  <div className="f-horizon"><div className="f-welcome"><span>Alfred</span><h2>{mode==='listening'?`Te escucho${who?', '+who:''}.`:mode==='thinking'?`Un momento${who?', '+who:''}.`:who?`Qué pasa, ${who}.`:'Hola.'}</h2></div></div>
  {decision?<button className="s-step-invite is-decision" onClick={onReview} aria-label={'Te espera: '+decision.title+'. Abrir Entregas'}><span><small>Te espera · {decision.where}{total>1?` · y ${total-1} más`:''}</small><strong>{decision.title}</strong></span><span className="s-step-arrow"><ArrowRight size={17}/></span></button>:
  <button className="s-step-invite" ref={expandButton} aria-expanded={expanded} aria-controls="current-step" onClick={()=>{setExpanded(true);requestAnimationFrame(()=>stepHeading.current?.focus({preventScroll:true}));}}><span><small>{active?'En curso':paused?'Retomar':completed?'Tu último avance':'Podemos seguir con'} · {currentProject.name}</small><strong>{completed?(promiseStep&&session?.note.trim()?'Tu frase para el comparador':session?.title):shownTitle}</strong></span><span className="s-step-arrow"><ArrowRight size={17}/></span></button>}
  <div className="f-main"><div className="f-focus" id="current-step" hidden={!expanded}>
   <button className="s-back" onClick={()=>{if(onBack){onBack();return;}setExpanded(false);requestAnimationFrame(()=>expandButton.current?.focus());}}><ArrowLeft size={14}/>Volver a Alfred</button>
   <div className="f-project-context"><span>Estás trabajando en</span><button className="f-project" onClick={onProject} aria-label={'Ver proyectos. Proyecto del paso: '+currentProject.name}><i style={{background:divisions.find(d=>d.id===currentProject.division)?.color}}/>{currentProject.name}<ArrowUpRight size={13}/></button></div>
   <div className="f-step-label">{completed?'Paso terminado':paused?'Retoma por aquí':active?'Solo esto, ahora':'Tu siguiente paso'}</div>
   <h1 ref={stepHeading} tabIndex={-1}>{completed?(promiseStep&&session?.note.trim()?'Frase guardada.':'Esto ya está.'):shownTitle}</h1>
   <p className="f-criterion">{completed?session?.note||session?.title:shownCriterion}</p>
   {promiseStep&&!completed&&!editing&&!note.trim()&&<div className="f-example"><span>Tu punto de partida</span><p>«{example}»</p>{active||paused?<button className="f-text" disabled={busy} onClick={()=>{writeDraft(example);noteField.current?.focus();}}>Usar esta frase como borrador <ArrowRight size={12}/></button>:<small>Al empezar podrás usarla o escribir tu versión.</small>}</div>}
   {paused&&session?.note&&!promiseStep&&<div className="f-resume"><span>Te quedaste en…</span><p>{session.note}</p></div>}
   {editing?<form className="f-edit" onSubmit={e=>{e.preventDefault();session?change('edit',{title,doneWhen:criterion}):change('create',{id:crypto.randomUUID(),project:project.id,title,doneWhen:criterion,minutes:low?5:10});}}><label>Paso concreto<input disabled={busy} value={title} onChange={e=>setTitle(e.target.value)} required maxLength={240}/></label><label>Terminado cuando…<input disabled={busy} value={criterion} onChange={e=>setCriterion(e.target.value)} required maxLength={400}/></label><button className="f-primary" disabled={busy}>Guardar paso <Check size={16}/></button><button type="button" className="f-text" onClick={()=>setEditing(false)}>Volver</button></form>:<>
    {(active||paused)&&<label className="f-note"><span>{promiseStep?'Tu frase':active?'Tu borrador · se guarda al pausar o terminar':'Punto para continuar'}</span><textarea ref={noteField} disabled={busy} aria-label={promiseStep?'Tu frase':'Borrador de tu paso'} placeholder={promiseStep?'Escribe tu versión aquí…':'Una frase, una decisión, lo que llevas…'} value={note} onChange={e=>writeDraft(e.target.value)} maxLength={2000}/></label>}
    <div className="f-actions">{completed?<button className="f-primary" disabled={busy} onClick={()=>create()}><ArrowRight size={16}/>Preparar otro paso</button>:active?<><button className="f-primary" disabled={busy||(promiseStep&&!note.trim())} onClick={()=>change('complete',{note})}><Check size={17}/>{promiseStep?'Guardar frase y terminar':'He terminado'}</button><button className="f-pause" disabled={busy} onClick={()=>change('pause',{note})}><Pause size={16}/>Pausar</button></>:<button className="f-primary" disabled={busy||!office} onClick={()=>session?change('start',{note}):create(false,true)}><Play size={15} fill="currentColor"/>{paused?'Continuar':promiseStep?'Escribir mi frase':session?'Empezar · '+session.minutes+' min':'Empezar · '+(low?5:10)+' min'}<ArrowRight size={16}/></button>}{promiseStep&&!active&&!completed&&<span className="f-time-hint">Unos {session?.minutes||10} min</span>}</div>
    {!active&&!completed&&<div className="f-secondary"><button className="f-text" disabled={busy} onClick={smaller}>Hazlo más pequeño</button><button className="f-text" onClick={()=>{setTitle(shownTitle);setCriterion(shownCriterion);setEditing(true);}}><PenLine size={12}/>Ajustar</button></div>}
   </>}
   {session&&draftRef.current?.dirty&&draftRef.current.baseRevision!==session.revision&&<div className="f-conflict"><p>Hay una versión más reciente. Tu borrador sigue aquí.</p><button disabled={busy} onClick={()=>change('note',{revision:session.revision})}>Guardar mi borrador</button><button disabled={busy} onClick={()=>{draftRef.current={id:session.id,text:session.note,baseRevision:session.revision,dirty:false};setNote(session.note);setError('');try{localStorage.removeItem('alfred-step-draft:'+session.id);}catch{}}}>Usar versión guardada</button></div>}
   {error&&<p role="alert" className="f-error">{error}</p>}
  </div>
  <div className="f-presence"><div className="f-orb-halo" aria-hidden="true"/><button className="f-orb" onClick={chat} aria-label="Hablar con Alfred"><Orb mode={mode} level={level} calm={low} subdued={active}/></button><div className="f-presence-label"><span>Alfred</span><p>{mode==='thinking'?'Preparando tu respuesta.':mode==='listening'?'Te escucho.':mode==='speaking'?'Hablando contigo.':active?'Tú en esto. Yo aquí.':'Aquí, contigo.'}</p></div></div>
  </div>
  <div className="f-utilities" hidden={!expanded}><button onClick={onCapture}><Plus size={16}/><span>Guardar una idea</span><ArrowUpRight size={14}/></button><button onClick={chat}><MessageCircle size={16}/><span>Hablar con Alfred</span><kbd>⌘ K</kbd></button></div>
  <div className="f-bottom" hidden={!expanded}><div className="f-session-status"><span className={'f-status-glyph '+status}>{completed?<Check size={14}/>:active?<span className="f-live-dot"/>:paused?<Pause size={13}/>:<span>01</span>}</span><div><strong>{completed?'Guardado como avance personal':active?'Tu espacio de atención':paused?'El contexto está guardado':'Todo lo demás puede esperar'}</strong><p>{completed?'Lo has marcado como terminado.':active?'Puedes parar en cualquier momento.':paused?'Continúa cuando vuelvas.':'Una decisión pequeña es suficiente para empezar.'}</p></div></div>{(active||paused)&&<div className="f-timer" aria-label="Tiempo orientativo"><span>{Math.floor(remaining/60000).toString().padStart(2,'0')}:{Math.floor(remaining%60000/1000).toString().padStart(2,'0')}</span><div><i style={{width:percent+'%'}}/></div><small>{remaining===0?'Puedes cerrar o seguir.':'Tiempo orientativo'}</small></div>}{!active&&ready.length>0&&<button className="f-review" onClick={onReview}><i/>{ready.length} entrega{ready.length===1?'':'s'} para revisar <ArrowRight size={14}/></button>}</div>
 </section>;
}

