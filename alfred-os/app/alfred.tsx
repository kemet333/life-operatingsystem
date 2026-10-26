'use client';
import {Fragment,useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {ArrowLeft,ArrowUpRight,ChevronLeft,ChevronRight,Plus,Minus,X,Mic,MicOff,Volume2,VolumeX,ArrowUp,Command,MessageCircle,Search,Layers3,Activity,Compass,Check,ExternalLink,Focus,Send,Hexagon,Code2,PenTool,ShieldCheck,BookOpen,Feather,Clapperboard} from 'lucide-react';
import {MemoryView} from './memory';
import {ContentView} from './content';
import {OperationsBoard,OWNERS} from './board';
import FocusConsole from './focus-console';
import {DeptTalk,DeptWork,LiveCapsule,useEquipo} from './equipo-panel';
import {usePerfil,llamar} from './perfil';
import {DeptJobs,DeptRequests} from './dept-jobs';
import ProjectsView from './projects-tree';
import {voiceTurn,voiceControl,voiceAnswer,voiceStatus,consoleVerb,isYes,wantsDetails,spokenUsage,VoicePlayer,voiceLog,type VoiceStatus} from './voice-brain';
import './voice.css';
import './focus.css';
import './mac.css';
import './spatial.css';
import './shell.css';
import './design.css';
import './coherence.css';
import './setup.css';
import {SetupWizard,leerConfiguracion} from './setup';
import Orb,{type OrbMode} from './orb';
import {constellation,getDepartments,type MapNode} from '../lib/constellation';
import {divisions,projects,roles,statusNames,setPortfolio,portfolioVersion,type OfficeState,type Entry} from '../lib/alfred-data';
import type {ChatAction,ChatMessage} from '../lib/alfred-chat';
import {REQUEST_STEPS,requestStep,requestResultLabel} from '../lib/request-path';
import {REVISE_FEEDBACK_MAX,REQUEST_BODY_MAX,ENTRY_TITLE_MAX,ENTRY_BODY_MAX} from '../lib/office-limits';
type State=OfficeState&{messages:ChatMessage[];focusSession?:any;focusHistory?:any[];knowledge?:any};
const initialCamera={x:800,y:380};
const departmentIcons:Record<string,any>={alfred:Hexagon,radar:Search,product:Code2,studio:PenTool,business:ArrowUpRight,control:ShieldCheck};
// Lighten a #rrggbb colour toward white (0..1), for the bright core of a node.
// A branch drawn as a filled shape that thins from its base (w1) to its tip (w2) along a quadratic curve, like the
// generative tree reference: thick near the trunk, hair-thin at the leaves.
function taperQ(x1:number,y1:number,cx:number,cy:number,x2:number,y2:number,w1:number,w2:number){
 const N=14,left:string[]=[],right:string[]=[];
 for(let i=0;i<=N;i++){const t=i/N,u=1-t;
  const x=u*u*x1+2*u*t*cx+t*t*x2,y=u*u*y1+2*u*t*cy+t*t*y2,dx=2*u*(cx-x1)+2*t*(x2-cx),dy=2*u*(cy-y1)+2*t*(y2-cy),len=Math.hypot(dx,dy)||1;
  const w=(w1+(w2-w1)*Math.pow(t,.8))/2,nx=-dy/len*w,ny=dx/len*w;
  left.push(`${(x+nx).toFixed(1)} ${(y+ny).toFixed(1)}`);right.unshift(`${(x-nx).toFixed(1)} ${(y-ny).toFixed(1)}`);}
 return `M${left.join(' L')} L${right.join(' L')} Z`;
}
// The conversation as a timeline (the owner's chat reference): what Alfred did, how long each step took, which model.
type TurnMeta={model?:string;deep?:boolean;steps:{text:string;at:number}[];start:number;end?:number};
const modelName=(m?:string)=>m?/opus/.test(m)?'Opus 5.5':/sonnet/.test(m)?'Sonnet 5.5':'':'';
const secs=(ms:number)=>{const s=Math.max(1,Math.round(ms/1000));return s<60?`${s} s`:`${Math.floor(s/60)} min ${s%60} s`;};
function Trace({meta,live}:{meta:TurnMeta;live?:boolean}){
 const end=meta.end||Date.now();
 return <ol className={'j-trace-steps'+(live?' live':'')}>{meta.steps.map((st,i)=>{const next=meta.steps[i+1]?.at||end,now=live&&i===meta.steps.length-1;return <li key={i} className={now?'now':''}><span>{st.text}</span><time>{secs(next-st.at)}</time></li>;})}</ol>;
}
const tint=(hex:string,amount:number)=>{const n=parseInt(hex.slice(1),16),c=[n>>16&255,n>>8&255,n&255].map(v=>Math.round(v+(255-v)*amount));return `rgb(${c.join(',')})`;};
function textBlocks(text:string){return text.split('\n').map((line,i)=><Fragment key={i}>{i>0&&<br/>}{line.split(/(\*\*[^*]+\*\*)/g).map((part,j)=>part.startsWith('**')?<strong key={j}>{part.slice(2,-2)}</strong>:part)}</Fragment>);}
export default function Alfred(){
 const [compact,setCompact]=useState(false),[nativeHost,setNativeHost]=useState(false);
 const views=[{id:'now',name:'Alfred',icon:Focus},{id:'map',name:'Equipo',icon:Compass},{id:'projects',name:'Proyectos',icon:Layers3},{id:'activity',name:'Entregas',icon:Activity},{id:'memory',name:'Memoria',icon:BookOpen},{id:'trends',name:'Contenido',icon:Clapperboard}];
 const [setup,setSetup]=useState(false);
 useEffect(()=>{leerConfiguracion().then(c=>{if(c&&!c.listo)setSetup(true);});},[]);
 const [office,setOffice]=useState<State|null>(null),[error,setError]=useState(''),[view,setView]=useState('now'),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[department,setDepartment]=useState<string|null>(null),[camera,setCamera]=useState(initialCamera),[zoom,setZoom]=useState(1),[pan,setPan]=useState({x:0,y:0}),[dragging,setDragging]=useState(false),[selected,setSelected]=useState<any>(null),[hover,setHover]=useState<MapNode|null>(null),[chatOpen,setChatOpen]=useState(false),[input,setInput]=useState(''),[sending,setSending]=useState(false),[notice,setNotice]=useState(''),[voiceEnabled,setVoiceEnabled]=useState(false),[voiceSupported,setVoiceSupported]=useState(false),[voiceMode,setVoiceMode]=useState<OrbMode>('idle'),[level,setLevel]=useState(0),[request,setRequest]=useState<{title:string;body:string;project:string;role:string;entryId?:string}|null>(null),[saving,setSaving]=useState(false),[draftReady,setDraftReady]=useState(false),[capture,setCapture]=useState(false),[ideaText,setIdeaText]=useState(''),[optimistic,setOptimistic]=useState<ChatMessage|null>(null);
 const [revise,setRevise]=useState<string|null>(null),[reviseError,setReviseError]=useState('');
 // The engine appends a dated header (~60 chars) to the body; 80 leaves room so 'revise' never rejects what the form allows.
 const UNSENT_REVISE='Tienes cambios sin enviar. Envíalos o pulsa Cancelar para descartarlos.';
 function closeDetail(){if(revise?.trim()){setReviseError(UNSENT_REVISE);return;}setSelected(null);}
 const reviseFull=revise!==null&&selected?.kind==='task'&&String(selected.data?.body||'').length+revise.length+80>REQUEST_BODY_MAX;
 const departments=useMemo(()=>getDepartments(compact,department),[compact,department]);
 const [brain,setBrain]=useState<VoiceStatus|null>(null),[permission,setPermission]=useState<{id:string;what:string;detail:string}|null>(null),[live,setLive]=useState<{id:string;text:string}|null>(null),[thinking,setThinking]=useState(false),[steps,setSteps]=useState<string[]>([]),[turns,setTurns]=useState<Record<string,TurnMeta>>({}),[,tickTrace]=useState(0),[dictation,setDictation]=useState(false);
 const sayQueue=useRef<string[]>([]),speakingNow=useRef(false),flushRef=useRef<()=>void>(()=>{}),talkRef=useRef<(t:string)=>void>(()=>{}),startRef=useRef<()=>void>(()=>{}),cancelRef=useRef<()=>void>(()=>{}),turnAbort=useRef<AbortController|null>(null),player=useRef<VoicePlayer|null>(null),ttsRef=useRef(false);
 const starsRef=useRef<SVGGElement>(null);
 const speechID=useRef<string|null>(null),svg=useRef<SVGSVGElement>(null),command=useRef<HTMLInputElement>(null),chatBottom=useRef<HTMLDivElement>(null),drag=useRef<any>(null),recognition=useRef<any>(null),sendRef=useRef<(t:string)=>void>(()=>{}),voiceRef=useRef(false),spoken=useRef(new Set<string>()),loaded=useRef(false),turn=useRef<{text:string;id:string}|null>(null);
 const nodes=useMemo(()=>constellation(office,compact,department),[office,compact,department]);
 const perfil=usePerfil(),who=llamar(perfil);
 const marca=perfil.nombre?perfil.nombre.split(' ')[0]:'Life';   // «the owner Operating System» on its owner's Mac, from the profile
 useEffect(()=>{document.title=`${marca} Operating System`;},[marca]);   // the window title (taskbar, Window menu) says it too
 const teamNodes=useMemo(()=>nodes.filter(n=>n.kind!=='project'),[nodes]);
 const parents=useMemo(()=>new Set(teamNodes.map(n=>n.parent)),[teamNodes]);
 const snap=office?.snapshot,fresh=!!snap&&Date.now()-new Date(snap.observedAt).getTime()<90000;
 const activeId=snap?.bridge?.activeRequest,active=(office?.entries||[]).find(e=>e.id===activeId&&['dispatching','linked'].includes(e.status));
 const mode:OrbMode=voiceMode!=='idle'?voiceMode:thinking||active&&fresh?'thinking':'idle';
 const focus=projects.find(p=>p.id===office?.settings.focus)||projects[0];
 const requests=(office?.entries||[]).filter(e=>e.kind==='request'),ideas=(office?.entries||[]).filter(e=>e.kind==='idea'&&!['parked','cancelled'].includes(e.status)),waiting=(office?.entries||[]).filter(e=>e.kind==='conversation'&&['queued','dispatching','linked'].includes(e.status));
 const ready=requests.filter(e=>e.status==='review'),currentDepartment=departments.find(d=>d.id===department);
 const equipo=useEquipo(),board:any[]=(equipo as any)?.tablero||[];
 const busyDepts=[...new Set(board.filter(i=>i.columna==='curso'&&departments.some(d=>d.id===i.responsable)).map(i=>i.responsable))];
 const teamHeadline=!equipo?'Tu equipo, conectado.':equipo.pausado?'El equipo está en pausa.':busyDepts.length===1?`${OWNERS[busyDepts[0]]?.name||'Un departamento'} está trabajando.`:busyDepts.length?`${busyDepts.length} departamentos trabajando.`:'Nadie trabajando ahora.';
 const doneWeek=board.filter(i=>i.fuente==='equipo'&&i.columna==='hecho').length,blockedNow=board.filter(i=>i.fuente==='equipo'&&i.columna==='bloqueado').length;
 const teamFacts=equipo?`${doneWeek} ${doneWeek===1?'tarea hecha':'tareas hechas'} esta semana · ${blockedNow} ${blockedNow===1?'bloqueada':'bloqueadas'} · un departamento por rama`:'Una oficina transversal para todos tus proyectos.';
 const waitingForYou=(((equipo as any)?.tablero||[]) as any[]).filter(i=>i.columna==='para-ti').length+ready.length+((equipo as any)?.salud?.checks||[]).filter((c:any)=>c.estado==='fallo').length;
 async function load(){try{const r=await fetch('/api/office',{cache:'no-store'});const j:any=await r.json();if(!r.ok)throw new Error(j.error);setOffice(j);setError('');return j as State;}catch(e){setError(e instanceof Error?e.message:'No se puede leer la oficina.');return null;}}
 useEffect(()=>{const mq=window.matchMedia('(max-width:520px)');const change=()=>{setCompact(mq.matches);setDepartment(null);setCamera(initialCamera);setZoom(1);setPan({x:0,y:0});};change();mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
 // Live portfolio from Obsidian (Mac app only; the web copy keeps the built-in list).
 const [,setPortfolioTick]=useState(0);
 useEffect(()=>{let alive=true;const pull=async()=>{try{const r=await fetch('/api/cartera',{cache:'no-store'});if(!r.ok)return;const j:any=await r.json();if(alive&&setPortfolio(j.proyectos))setPortfolioTick(portfolioVersion());}catch{}};pull();const t=setInterval(pull,60000);return()=>{alive=false;clearInterval(t);};},[view]);
 useEffect(()=>{load();const t=setInterval(load,4000);return()=>clearInterval(t);},[]);
 // While Alfred works, the live step's duration counts up once a second.
 useEffect(()=>{if(!thinking)return;const t=setInterval(()=>tickTrace(n=>n+1),1000);return()=>clearInterval(t);},[thinking]);
 useEffect(()=>{const sync=(e?:Event)=>{const q=new URLSearchParams(window.location.search),requested=(e as CustomEvent)?.detail?.view||q.get('view');setNativeHost(q.get('native')==='1');if(['now','map','projects','activity','memory','trends'].includes(requested||'')){setView(requested!);setSelected(null);}};sync();window.addEventListener('popstate',sync);window.addEventListener('alfred:native-view',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('alfred:native-view',sync);};},[]);
 useEffect(()=>{if(!nativeHost)return;const url=new URL(window.location.href);if(url.searchParams.get('view')!==view){url.searchParams.set('view',view);window.history.replaceState(window.history.state,'',url);}},[view,nativeHost]);
 useEffect(()=>{if(!draftReady)return;try{localStorage.setItem('alfred-chat-draft',input);}catch{}},[input,draftReady]);
 useEffect(()=>{if(!draftReady)return;try{localStorage.setItem('alfred-idea-draft',ideaText);}catch{}},[ideaText,draftReady]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),5500);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{voiceRef.current=voiceEnabled;},[voiceEnabled]);
 useEffect(()=>{setRevise(null);setReviseError('');},[selected]);
 useEffect(()=>{if(chatOpen)command.current?.focus();},[chatOpen]);
 useEffect(()=>{try{setInput(localStorage.getItem('alfred-chat-draft')||'');setIdeaText(localStorage.getItem('alfred-idea-draft')||'');}catch{}setDraftReady(true);setVoiceSupported(!!((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));const native=new URLSearchParams(window.location.search).get('native')==='1',saved=localStorage.getItem(native?'alfred-native-voice':'alfred-voice');setVoiceEnabled(native?saved!=='off':saved==='on');return()=>{recognition.current?.abort();stopSpeaking();};},[]);
 useEffect(()=>{
  const el=svg.current;if(!el)return;
  const wheel=(e:WheelEvent)=>{e.preventDefault();setZoom(z=>Math.min(2.8,Math.max(.7,z-e.deltaY*.0012)));};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);
 },[view]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setChatOpen(true);command.current?.focus();}
  if((e.metaKey||e.ctrlKey)&&!e.shiftKey&&!e.altKey&&/^[1-6]$/.test(e.key)){e.preventDefault();setView(['now','map','projects','activity','memory','trends'][Number(e.key)-1]);setSelected(null);setChatOpen(false);}if(e.key==='Escape'){if(revise!==null){if(revise.trim()){setReviseError(UNSENT_REVISE);return;}setRevise(null);setReviseError('');return;}setSelected(null);setRequest(null);setCapture(false);setChatOpen(false);if(department)resetMap();recognition.current?.stop();cancelRef.current();sayQueue.current=[];speakingNow.current=false;stopSpeaking();setVoiceMode('idle');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[department,revise]);
 useEffect(()=>{
  if(!selected&&!request&&!capture)return;
  const previous=document.activeElement as HTMLElement,dialog=document.querySelector<HTMLElement>('[role="dialog"]');
  const items=()=>Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea')||[]);
  (request||capture?dialog?.querySelector<HTMLElement>('input,textarea'):items()[0])?.focus();
  const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const list=items(),first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
  document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus();};
 },[Boolean(selected),Boolean(request),capture]);
 useEffect(()=>{chatBottom.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest'});},[office?.messages?.length,chatOpen,waiting.length]);
 useEffect(()=>{
  const messages=office?.messages||[];
  if(!loaded.current&&office){messages.forEach(m=>spoken.current.add(m.id+':'+m.author));loaded.current=true;return;}
  for(const m of messages){const id=m.id+':'+m.author;if(spoken.current.has(id))continue;spoken.current.add(id);if(m.author==='assistant'&&voiceRef.current)speak(m.text,m.id+':assistant');}
 },[office?.messages]);
 useEffect(()=>{const update=(event:Event)=>{const data=(event as CustomEvent).detail;if(!data||(data.id!==speechID.current&&!(data.id==='ritual'&&data.state==='speaking')))return;if(data.id==='ritual'&&data.state==='speaking')speechID.current='ritual';if(data.state==='speaking'){setVoiceMode('speaking');setLevel(.45);}else if(data.state==='idle'||data.state==='unavailable'){speechID.current=null;speakingNow.current=false;setVoiceMode('idle');setLevel(0);if(data.state==='idle')flushRef.current();else sayQueue.current=[];if(data.state==='unavailable')setNotice(data.reason==='ritual-active'?'El ritual está sonando. Puedes escuchar la respuesta cuando termine.':'Selecciona una voz disponible en los ajustes de la app. Tu respuesta sigue aquí.');}};window.addEventListener('alfred:native-speech',update);return()=>window.removeEventListener('alfred:native-speech',update);},[]);
 useEffect(()=>{let gone=false;voiceStatus().then(s=>{if(gone||!s)return;ttsRef.current=!!s.tts;ttsReady.current=!!s.tts;if(!s.tts)voiceLog('sin voz de ElevenLabs al abrir: clave '+((s as any).clave||'desconocida'));setBrain(s);void voiceControl('warm');});return()=>{gone=true;};},[]);
 // The two-snap ritual greets with Alfred's ElevenLabs voice (cached after the first time); false lets the Mac speak it.
 const ttsReady=useRef(false);
 // If the neural voice was missing (macOS still asking for Documents, no network), look again when the owner comes back.
 useEffect(()=>{const again=()=>{if(ttsReady.current)return;voiceStatus().then(s=>{if(s?.tts){ttsReady.current=true;setBrain(s);}});};
  window.addEventListener('focus',again);const timer=window.setInterval(again,30_000);return()=>{window.removeEventListener('focus',again);clearInterval(timer);};},[]);
 useEffect(()=>{(window as any).alfredRitual=(text:unknown)=>{if(typeof text!=='string'||!text.trim()||!ttsReady.current||!player.current)return false;
  ttsRef.current=true;stopSpeaking();player.current.unlock();player.current.enqueue(text.trim().slice(0,400),true);return true;};
  return()=>{delete (window as any).alfredRitual;};},[]);
 // The neural voice tells the Mac when it speaks, so ritual music ducks and the clap detector rests.
 useEffect(()=>{player.current=new VoicePlayer({state:s=>{(window as any).webkit?.messageHandlers?.nativeVoiceActivity?.postMessage({active:s==='speaking'});setVoiceMode(m=>s==='speaking'?'speaking':m==='speaking'?'idle':m);},level:v=>setLevel(v),fail:(text,why)=>{ttsRef.current=false;voiceLog('paso a la voz del Mac: '+why);setNotice('La voz de ElevenLabs no responde ('+why+'). Sigo con la voz del Mac.');sayQueue.current.push(text);flushRef.current();}});return()=>player.current?.stop();},[]);
 useEffect(()=>{const update=(event:Event)=>{const d=(event as CustomEvent).detail;if(!d)return;
  if(d.state==='listening'){setDictation(true);setVoiceMode('listening');setLevel(.3);}
  else if(d.state==='partial'){setInput(d.text||'');}
  else if(d.state==='final'){setDictation(false);setVoiceMode('idle');setLevel(0);setInput('');if((d.text||'').trim())talkRef.current(d.text);}
  else{setDictation(false);setVoiceMode(m=>m==='listening'?'idle':m);setLevel(0);if(d.state==='unavailable')setNotice(d.reason==='speech-denied'?'Permite el reconocimiento de voz en Ajustes del Sistema → Privacidad y seguridad.':d.reason==='mic-denied'?'Permite el micrófono en Ajustes del Sistema → Privacidad y seguridad.':'El dictado no está disponible ahora mismo. Puedes escribir.');}};
  window.addEventListener('alfred:native-dictation',update);return()=>window.removeEventListener('alfred:native-dictation',update);},[]);
 // While the owner talks, the orb follows his real microphone loudness (sent by the native dictation).
 useEffect(()=>{const mic=(event:Event)=>{const v=Number((event as CustomEvent).detail?.level);if(Number.isFinite(v))setLevel(Math.min(1,v));};window.addEventListener('alfred:native-mic',mic);return()=>window.removeEventListener('alfred:native-mic',mic);},[]);
 useEffect(()=>{const mic=()=>(window as any).webkit?.messageHandlers?.nativeDictation;let held=false;
  const down=(e:KeyboardEvent)=>{if(e.code!=='AltRight'||e.repeat||held||!mic())return;held=true;e.preventDefault();startRef.current();};
  const up=(e:KeyboardEvent)=>{if(e.code!=='AltRight'||!held)return;held=false;e.preventDefault();mic()?.postMessage({action:'stop'});};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);};},[]);
 function stopSpeaking(){player.current?.stop();const bridge=(window as any).webkit?.messageHandlers?.nativeSpeech;if(bridge&&speechID.current)bridge.postMessage({action:'stop',id:speechID.current});speechID.current=null;window.speechSynthesis?.cancel();setVoiceMode('idle');setLevel(0);}
 function speak(text:string,id=crypto.randomUUID() as string,system=false){
  const native=new URLSearchParams(window.location.search).get('native')==='1',clean=text.replace(/[*#`]/g,'').slice(0,8000);
  if(!system&&ttsRef.current&&player.current){stopSpeaking();player.current.unlock();player.current.enqueue(clean);return;}
  if(native){const bridge=(window as any).webkit?.messageHandlers?.nativeSpeech;if(!bridge){setNotice('Actualiza la app para activar la voz de Alfred.');return;}stopSpeaking();speechID.current=id;bridge.postMessage({action:'speak',text:clean,id});return;}
  if(!window.speechSynthesis){setNotice('Este navegador no dispone de lectura de voz.');return;}
  stopSpeaking();const u=new SpeechSynthesisUtterance(clean);u.lang='es-ES';u.rate=.98;const voices=window.speechSynthesis.getVoices();u.voice=voices.find(v=>v.lang==='es-ES'&&/jorge/i.test(v.name))||voices.find(v=>v.lang.startsWith('es')&&/jorge|juan|carlos/i.test(v.name))||null;
  if(!u.voice){setNotice('No hay una voz masculina de español disponible en este navegador. Usa la voz de la app del Mac.');return;}
  u.onstart=()=>setVoiceMode('speaking');u.onboundary=()=>{setLevel(.6);setTimeout(()=>setLevel(.2),180);};u.onend=()=>{setVoiceMode('idle');setLevel(0);speakingNow.current=false;flushRef.current();};u.onerror=()=>{setVoiceMode('idle');setNotice('La lectura de voz no se ha podido iniciar. La respuesta sigue en el chat.');};window.speechSynthesis.speak(u);
 }
 function listen(){
  if(nativeHost){const mic=(window as any).webkit?.messageHandlers?.nativeDictation;if(!mic){setChatOpen(true);setNotice('Actualiza la app para hablar con Alfred por voz. Mientras, puedes escribir.');return;}if(dictation){mic.postMessage({action:'stop'});return;}startDictation();return;}
  if(voiceMode==='listening'){recognition.current?.stop();return;}
  const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  if(!Recognition){setChatOpen(true);command.current?.focus();setNotice('Dictado no disponible aquí. Puedes escribir a Alfred.');return;}
  window.speechSynthesis?.cancel();setChatOpen(true);const r=new Recognition();recognition.current=r;r.lang='es-ES';r.continuous=false;r.interimResults=true;
  r.onstart=()=>setVoiceMode('listening');r.onresult=(event:any)=>{let words='';for(let i=event.resultIndex;i<event.results.length;i++)words+=event.results[i][0].transcript;setInput(words);setLevel(Math.min(1,words.length/50));if(event.results[event.results.length-1].isFinal){r.stop();command.current?.focus();}};
  r.onend=()=>{setVoiceMode(m=>m==='listening'?'idle':m);setLevel(0);};r.onerror=(e:any)=>{setVoiceMode('idle');setNotice(e.error==='not-allowed'?'Micrófono no autorizado. Puedes escribir.':'El dictado no está disponible en este navegador o conexión. Puedes escribir.');};try{r.start();}catch{setNotice('No se ha podido abrir el micrófono.');}
 }
 function toggleVoice(){const enabled=!voiceEnabled;setVoiceEnabled(enabled);voiceRef.current=enabled;localStorage.setItem(nativeHost?'alfred-native-voice':'alfred-voice',enabled?'on':'off');if(!enabled)stopSpeaking();}
 function resetMap(){setDepartment(null);setCamera(initialCamera);setZoom(1);setPan({x:0,y:0});setSelected(null);}
 function enterDepartment(id:string){setView('map');setDepartment(id);setCamera({x:650,y:380});setZoom(compact?1.05:1.12);setPan({x:0,y:0});setSelected(null);}
 function stepDepartment(direction:number){if(!department)return;const index=departments.findIndex(d=>d.id===department);const next=departments[(index+direction+departments.length)%departments.length];if(next)enterDepartment(next.id);}
 const touchStart=useRef<number|null>(null);
 function applyAction(a?:ChatAction){if(!a)return;if(a.type==='division'){setView('projects');setFilter(a.id||'all');}if(a.type==='project'){setView('projects');setSelected({kind:'project',data:projects.find(p=>p.id===a.id)});}if(a.type==='activity')setView('activity');if(a.type==='request')setRequest({title:a.title||'',body:a.body||'',project:a.project||focus.id,role:'radar'});}
 async function send(text=input){
  if(brain){void talk(text);return;}
  if(!text.trim()||sending)return;setChatOpen(true);setSending(true);setError('');
  if(turn.current?.text!==text)turn.current={text,id:crypto.randomUUID()};
  setOptimistic({id:turn.current!.id,author:'user',text,at:Date.now(),source:'local'} as ChatMessage);
  try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:turn.current!.id,text})});const j:any=await r.json();if(!r.ok)throw new Error(j.error);setInput(current=>current===text?'':current);turn.current=null;await load();setOptimistic(null);applyAction(j.action);}
  catch(e){setNotice(e instanceof Error?e.message:'No se ha podido enviar. Tu texto se conserva.');setInput(current=>current||text);}
  finally{setSending(false);setOptimistic(null);}
 }
 sendRef.current=t=>void send(t);
 function silence(){sayQueue.current=[];speakingNow.current=false;stopSpeaking();}
 function queueSpeech(text:string){if(!voiceRef.current||!text)return;if(ttsRef.current&&player.current){player.current.enqueue(text);return;}sayQueue.current.push(text);if(!speakingNow.current)flushSpeech();}
 // Sentences that arrive while Alfred is speaking are joined into the next utterance: no gaps, no cut-offs.
 function flushSpeech(){if(!sayQueue.current.length)return;const text=sayQueue.current.splice(0).join(' ');speakingNow.current=true;speak(text,'voz-'+crypto.randomUUID(),true);}
 flushRef.current=flushSpeech;
 function applyDirection(direction:string){const [kind,value]=direction.split(':'),sections:Record<string,string>={alfred:'now',equipo:'map',proyectos:'projects',entregas:'activity',memoria:'memory',tendencias:'trends',contenido:'trends'};
  if(kind==='vista'&&sections[value]){setView(sections[value]);setSelected(null);}
  if(kind==='area'&&divisions.some(d=>d.id===value)){setView('projects');setFilter(value);setSelected(null);}
  if(kind==='proyecto'){const p=projects.find(x=>x.id===value);if(p){setView('projects');setSelected({kind:'project',data:p});}}}
 function cancelTurn(){const current=turnAbort.current;if(!current)return;turnAbort.current=null;current.abort();setThinking(false);setLive(null);setOptimistic(null);setPermission(null);setSteps([]);}
 cancelRef.current=cancelTurn;
 function startDictation(){const mic=(window as any).webkit?.messageHandlers?.nativeDictation;if(!mic)return;silence();cancelTurn();player.current?.unlock();mic.postMessage({action:'start'});}
 startRef.current=startDictation;
 async function answerPermission(allow:boolean,reason?:string){const p=permission;if(!p)return;setPermission(null);await voiceAnswer(p.id,allow,reason);}
 async function talk(text:string,dictated=false){
  const said=text.trim();if(!said)return;
  // Typed turns, or a muted Alfred, need the reply on screen; a spoken turn is heard instead.
  if(!dictated||!voiceRef.current)setChatOpen(true);
  // A synthesis hiccup only downgrades the rest of one reply; every new turn tries the neural voice again.
  ttsRef.current=ttsReady.current;player.current?.unlock();
  if(permission){setInput('');if(wantsDetails(said)){queueSpeech(permission.detail.slice(0,280));return;}const yes=isYes(said);await answerPermission(yes,yes?undefined:said);return;}
  const verb=consoleVerb(said);
  if(verb){setInput('');silence();
   if(verb==='usage'){queueSpeech(spokenUsage(brain?.usage));return;}
   const next=await voiceControl(verb);if(next)setBrain(next);
   queueSpeech(verb==='deep'?'Modo profundo. Todo con Opus, y pienso a fondo.':verb==='fast'?'Modo rápido otra vez. Sonnet para lo corriente y Opus solo cuando haga falta.':'Conversación nueva. Empezamos de cero.');return;}
  silence();cancelTurn();
  const id=crypto.randomUUID(),ctrl=new AbortController();turnAbort.current=ctrl;
  spoken.current.add(id+':assistant');spoken.current.add(id+':user');
  setInput(current=>current===text?'':current);setOptimistic({id,author:'user',text:said,at:Date.now(),source:'voz'} as ChatMessage);setLive({id,text:''});setThinking(true);setSteps([]);setTurns(t=>({...t,[id]:{steps:[],start:Date.now()}}));
  try{
   await voiceTurn(id,said,ctrl.signal,e=>{
    if(e.t==='say'){e.directions.forEach(applyDirection);if(e.text){setLive(l=>l?.id===id?{id,text:(l.text+' '+e.text).trim()}:l);queueSpeech(e.text);}}
    else if(e.t==='step'){setSteps(s=>s[s.length-1]===e.text?s:[...s,e.text].slice(-6));setTurns(t=>{const m=t[id];if(!m||m.steps[m.steps.length-1]?.text===e.text)return t;return {...t,[id]:{...m,steps:[...m.steps,{text:e.text,at:Date.now()}].slice(-12)}};});}
    else if(e.t==='model'){setTurns(t=>t[id]?{...t,[id]:{...t[id],model:e.model,deep:e.deep}}:t);setBrain(b=>b?{...b,model:e.model,deep:e.deep}:b);}
    else if(e.t==='permission'){setPermission({id:e.id,what:e.what,detail:e.detail});queueSpeech('Quiero '+e.what+'. ¿Te parece bien?');}
    else if(e.t==='permission-closed')setPermission(p=>p?.id===e.id?null:p);
    else if(e.t==='usage')setBrain(b=>b?{...b,usage:e.usage}:b);
    else if(e.t==='error')setNotice(e.message);
   });
   await load();
  }catch(e){if(!ctrl.signal.aborted){setNotice(e instanceof Error?e.message:'No he podido hablar con Alfred.');setInput(current=>current||said);}}
  finally{setTurns(t=>t[id]?{...t,[id]:{...t[id],end:Date.now()}}:t);if(turnAbort.current===ctrl){turnAbort.current=null;setThinking(false);setLive(null);setOptimistic(null);setSteps([]);}}
 }
 talkRef.current=t=>void talk(t,true);
 async function act(payload:any,opts?:{quiet?:boolean}){setSaving(true);try{const r=await fetch('/api/office',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j:any=await r.json();if(!r.ok)throw new Error(j.error);await load();return j;}catch(e){if(!opts?.quiet)setNotice(e instanceof Error?e.message:'No se ha guardado.');throw e;}finally{setSaving(false);}}
 async function chooseFocus(p:{id:string;next:string}){try{await act({action:'settings',focus:p.id,text:p.next});setSelected(null);setView('now');setNotice(office?.focusSession&&office.focusSession.status!=='completed'?'Foco actualizado. Tu paso en curso se conserva hasta terminarlo.':'Foco actualizado.');}catch{}}
 function pointerDown(e:React.PointerEvent<SVGSVGElement>){if((e.target as Element).closest('[role=button]'))return;drag.current={x:e.clientX,y:e.clientY,pan};e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);}
 function pointerMove(e:React.PointerEvent<SVGSVGElement>){
  // Depth: the far starfield drifts a little against the pointer.
  if(starsRef.current&&!drag.current){const b=e.currentTarget.getBoundingClientRect();starsRef.current.style.transform=`translate(${((e.clientX-b.left)/b.width-.5)*-26}px,${((e.clientY-b.top)/b.height-.5)*-16}px)`;}
  if(!drag.current)return;const box=e.currentTarget.getBoundingClientRect(),scale=Math.max((compact?900:1600)/box.width,760/box.height);setPan({x:drag.current.pan.x+(e.clientX-drag.current.x)*scale,y:drag.current.pan.y+(e.clientY-drag.current.y)*scale});}
 function pointerUp(){drag.current=null;setDragging(false);}
 const allTasks=(snap?.boards||[]).flatMap(b=>b.tasks.map(t=>({...t,board:b.name}))),openTasks=allTasks.filter(t=>!['done','archived'].includes(t.status));
 const pathNodes=new Set<string>();let pathNode=hover;while(pathNode){pathNodes.add(pathNode.id);pathNode=nodes.find(n=>n.id===pathNode?.parent)||null;}
 const point=(id:string)=>nodes.find(n=>n.id===id)||departments.find(d=>d.id===id)!;
 // Each branch is a gentle curve (alternating sides, so chains read organic, not zigzag) that thins with depth.
 const branches=(department?teamNodes.filter(n=>n.role===department):teamNodes).map((n,i)=>{
  const from=point(n.parent),d=departments.find(d=>d.id===n.role)!;
  const depth=n.kind==='function'?Math.max(0,(n.id.split('-group-')[1]||'').split('-').length-1):1;
  const dx=n.x-from.x,dy=n.y-from.y,len=Math.hypot(dx,dy)||1,bend=len*(depth===0?.07:.15)*(i%2?1:-1);
  const cx=(from.x+n.x)/2-dy/len*bend,cy=(from.y+n.y)/2+dx/len*bend;
  const width=[2.3,1.65,1.2,.85][Math.min(3,depth)];
  return {n,from,color:d.color,depth,width,path:`M${from.x} ${from.y} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${n.x} ${n.y}`,shape:taperQ(from.x,from.y,cx,cy,n.x,n.y,width*2.1,width*.5)};
 });
 return <div className={'jarvis'+(nativeHost?' native-host':'')+' view-'+view+(office?.settings.energy==='low'?' calm':'')+' '+(chatOpen?'chat-is-open':'')}>
  <a className="j-skip" href="#alfred-command">Ir a la conversación</a>
  <header className="s-toolbar">
   <button className="s-wordmark" onClick={()=>setView('now')} aria-label={`${marca} Operating System · inicio`}>{marca} <span>Operating System</span></button>
   <nav className="s-navigation" aria-label="Tu espacio">{views.map((v,i)=><button key={v.id} title={`${v.name} · ⌘${i+1}`} aria-current={view===v.id?'page':undefined} onClick={()=>{setView(v.id);setSelected(null);}}><v.icon size={15}/><span>{v.name}</span>{v.id==='activity'&&waitingForYou>0&&<b className="s-badge" aria-label={waitingForYou+(waitingForYou===1?' decisión te espera':' decisiones te esperan')}>{waitingForYou}</b>}</button>)}</nav>
   <div className="s-tools">{view!=='now'&&<LiveCapsule onOpen={()=>{setView('activity');setSelected(null);}}/>}<button className={voiceEnabled?'selected':''} aria-label={voiceEnabled?'Desactivar voz de Alfred':'Activar voz de Alfred'} aria-pressed={voiceEnabled} title={voiceEnabled?'Voz de Alfred activada':'Activar voz de Alfred'} onClick={toggleVoice}>{voiceEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</button><button className={'s-calm '+(office?.settings.energy==='low'?'selected':'')} aria-label={office?.settings.energy==='low'?'Desactivar modo calma':'Activar modo calma'} aria-pressed={office?.settings.energy==='low'} title={office?.settings.energy==='low'?'Modo calma activo: el orb queda quieto y no sigue al ratón. Pulsa para desactivarlo':'Menos movimiento'} onClick={()=>act({action:'settings',energy:office?.settings.energy==='low'?'normal':'low'}).catch(()=>{})}><Feather size={16}/>{office?.settings.energy==='low'&&<span>Modo calma</span>}</button><button aria-label="Guardar una idea" title="Guardar una idea" onClick={()=>setCapture(true)}><Plus size={19}/></button></div>
  </header>
  {error&&<div className="j-error" role="alert">{error}<button onClick={load}>Reintentar</button></div>}
  <section className={'j-stage '+(dragging?'dragging ':'')+(view==='map'?'map-team':'')} aria-label={views.find(v=>v.id===view)?.name} inert={chatOpen}
   onTouchStart={e=>{if(view!=='map'||!department)return;touchStart.current=e.touches[0]?.clientX??null;}}
   onTouchEnd={e=>{if(view!=='map'||!department||touchStart.current===null)return;const dx=e.changedTouches[0]?.clientX-touchStart.current;touchStart.current=null;if(Math.abs(dx)>45)stepDepartment(dx<0?1:-1);}}
   onPointerDown={e=>{if(view!=='map'||!department)return;if(e.pointerType==='touch'||e.pointerType==='mouse')touchStart.current=e.clientX;}}
   onPointerUp={e=>{if(view!=='map'||!department||touchStart.current===null)return;const dx=e.clientX-touchStart.current;touchStart.current=null;if(Math.abs(dx)>65)stepDepartment(dx<0?1:-1);}}
   onPointerCancel={()=>{touchStart.current=null;}}>
   <div className="j-grid"/>
   {view==='now'&&<FocusConsole office={office} act={act} mode={mode} level={level} chat={()=>{setChatOpen(true);command.current?.focus();}} onProject={()=>{setView('projects');}} onCapture={()=>setCapture(true)} onReview={()=>setView('activity')}/>}
   {view==='map'&&<>
    <div className="j-map-heading">{department?<><button className="j-back" onClick={resetMap}><ArrowLeft size={14}/>Todo el equipo</button><h1>{currentDepartment?.label}</h1><p>{currentDepartment?.job} · {OWNERS[currentDepartment?.id||'']?.role||''}</p></>:<><span className="j-eyebrow">EQUIPO</span><h1>{teamHeadline}</h1><p className="j-map-heading-sub">{teamFacts}</p></>}</div>
    {!department&&<button className="f-quiet j-calming-map" aria-label="Reducir estímulos del mapa" aria-pressed={office?.settings.energy==='low'} onClick={()=>act({action:'settings',energy:office?.settings.energy==='low'?'normal':'low'}).catch(()=>{})}><Feather size={13}/><span>{office?.settings.energy==='low'?'Modo calma':'Menos estímulos'}</span></button>}
    <svg ref={svg} className="j-constellation" viewBox={compact?'350 0 900 760':'0 0 1600 760'} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="Constelación navegable del equipo">
     <defs><radialGradient id="j-node-glow"><stop offset="0" stopColor="white" stopOpacity=".9"/><stop offset="1" stopColor="white" stopOpacity=".08"/></radialGradient>
      <filter id="map-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
      <filter id="map-flow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1"/></filter>
      {departments.map(d=><radialGradient key={'halo-'+d.id} id={'halo-'+d.id}><stop offset="0" stopColor={d.color} stopOpacity=".55"/><stop offset=".42" stopColor={d.color} stopOpacity=".16"/><stop offset="1" stopColor={d.color} stopOpacity="0"/></radialGradient>)}
      {departments.map(d=><linearGradient key={'core-'+d.id} id={'core-'+d.id} gradientUnits="userSpaceOnUse" x1={d.x} y1={d.y} x2={800} y2={380}><stop offset="0" stopColor={d.color} stopOpacity=".7"/><stop offset="1" stopColor={d.color} stopOpacity="0"/></linearGradient>)}
      {branches.map(b=><linearGradient key={'g-'+b.n.id} id={'g-'+b.n.id} gradientUnits="userSpaceOnUse" x1={b.from.x} y1={b.from.y} x2={b.n.x} y2={b.n.y}><stop offset="0" stopColor={b.color} stopOpacity={.95-b.depth*.12}/><stop offset="1" stopColor={b.color} stopOpacity={.55-b.depth*.1}/></linearGradient>)}
     </defs>
     <g className={'j-world '+(dragging?'moving':'')} style={{transform:`translate(${800+pan.x}px,${380+pan.y}px) scale(${zoom}) translate(${-camera.x}px,${-camera.y}px)`}}>
      <g ref={starsRef} className="j-stars">{Array.from({length:75},(_,i)=><circle key={i} className="j-star" cx={(i*347.7)%1600} cy={(i*193.31)%760} r={i%4===0?1.6:.7} opacity={.08+(i%5)*.025}/>)}</g>
      {!department&&departments.map(d=><path key={d.id} className="j-center-link" d={`M800 380 Q${800+(d.x-800)*.62} ${380+(d.y-380)*.15} ${d.x} ${d.y}`} stroke={`url(#core-${d.id})`}/>)}
      {/* Branches as axons: a soft glow underneath, a curved stroke that thins and fades toward the tip, and light flowing outward. */}
      <g className="j-branch-glow" filter="url(#map-soft)">{branches.map(b=><path key={'glow-'+b.n.id} d={b.path} stroke={b.color} style={{strokeWidth:b.width*3.4}}/>)}</g>
      {branches.map(b=><path key={'edge-'+b.n.id} className={'j-branch taper '+(pathNodes.has(b.n.id)?'on-path':'')} style={{fill:`url(#g-${b.n.id})`}} d={b.shape}/>)}
      <g className="j-flow-layer" filter="url(#map-flow)">{branches.map((b,i)=><path key={'flow-'+b.n.id} className="j-flow" pathLength={100} d={b.path} style={{animationDelay:`${-((i*.61)%5).toFixed(2)}s`,animationDuration:`${4.2+(i%4)*.7}s`}}/>)}</g>
      {(department?teamNodes.filter(n=>n.role===department):teamNodes).map(n=>{const d=departments.find(d=>d.id===n.role)!;return <g key={n.id} role="button" tabIndex={0} aria-label={`Abrir ${n.name}`} className={'j-leaf '+(n.kind==='task'?' job':'')+(n.kind==='function'?' function':'')+(n.kind==='task'&&['review','accepted'].includes(n.data?.status)?' completed':'')} onClick={()=>setSelected(n)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(n);}}} onPointerEnter={()=>setHover(n)} onPointerLeave={()=>setHover(null)}>
       <circle cx={n.x} cy={n.y} r={n.kind==='function'?15:22} className="j-node-hit"/>
       <circle cx={n.x} cy={n.y} r={n.kind==='function'?11:16} fill={`url(#halo-${d.id})`} className="j-node-halo"/>
       <circle cx={n.x} cy={n.y} r={n.kind==='function'?2.3+(n.id.length%3)*.35:3.6} fill={tint(d.color,.55)} className={'j-node-core'+(n.kind==='task'&&!['review','accepted'].includes(n.data?.status)?' open':'')}/>
       {n.kind!=='function'&&<circle cx={n.x} cy={n.y} r={15} fill="none" stroke={d.color} opacity=".28"/>}
       {parents.has(n.id)&&<circle cx={n.x} cy={n.y} r={4.6} className="j-junction" stroke={tint(d.color,.6)}/>}
       {department&&!parents.has(n.id)&&(()=>{const out=n.x>=(departments.find(x=>x.id===n.role)?.x??800);return <text className="j-leaf-label" x={n.x+(out?11:-11)} y={n.y+3} textAnchor={out?'start':'end'}>{n.name.length>26?n.name.slice(0,25)+'…':n.name}</text>;})()}
      </g>;})}
      {(department?departments.filter(d=>d.id===department):departments).map(d=><g key={d.id} role="button" tabIndex={0} aria-label={`Explorar ${d.label}`} className={'j-department '+(department===d.id?'selected-department ':'')+(active?.role===d.id&&fresh?' active-job':'')+(busyDepts.includes(d.id)?' working':'')} onClick={()=>enterDepartment(d.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();enterDepartment(d.id);}}}>
       <circle className="j-node-hit" cx={d.x} cy={d.y} r={department===d.id?58:72}/><circle className="j-dept-aura" cx={d.x} cy={d.y} r={department===d.id?70:86} fill={`url(#halo-${d.id})`}/><circle className="j-dept-outer" cx={d.x} cy={d.y} r={department===d.id?33:41} stroke={d.color}/>{(()=>{const n=board.filter(i=>i.columna==='curso'&&i.responsable===d.id).length;if(!n||department===d.id)return null;return <g className="j-dept-count"><circle cx={d.x+30} cy={d.y-30} r={10} fill={d.color}/><text x={d.x+30} y={d.y-26.5} textAnchor="middle">{n}</text></g>;})()}<circle className="j-dept-ring" cx={d.x} cy={d.y} r={department===d.id?26:33} stroke={d.color}/>{(()=>{const Icon=departmentIcons[d.id],size=department===d.id?20:26;return <Icon x={d.x-size/2} y={d.y-size/2} size={size} color={d.color} strokeWidth={1.5}/>;})()}
       <text className="j-dept-label" x={d.x} y={department===d.id?d.y+58:d.y+(d.id==='studio'?-45:Math.sin(d.angle)>.2?-64:60)}>{d.label}</text><text className="j-dept-sub" x={d.x} y={department===d.id?d.y+78:d.y+(d.id==='studio'?-22:Math.sin(d.angle)>.2?-42:84)}>{d.job.toLowerCase()}</text>
      </g>)}
     </g>
    </svg>
    <div aria-hidden={Boolean(department)} className={'j-core '+(department?'away':'')}><button onClick={()=>{setChatOpen(true);command.current?.focus();}} tabIndex={department?-1:0} aria-label="Abrir conversación con Alfred" className="j-orb-button"><Orb mode={mode} level={level} calm={office?.settings.energy==='low'}/><span className="j-core-word">ALFRED</span></button><div className="j-core-status"><i className={mode}/>{({idle:'Aquí, contigo.',listening:'Te escucho.',thinking:'Preparando tu respuesta.',speaking:'Hablando contigo.'})[mode]}</div></div>
    {currentDepartment&&<aside className="j-dept-panel" aria-label={'Departamento '+currentDepartment.label}><div className="j-dept-panel-top"><span className="j-eyebrow">DEPARTAMENTO / {currentDepartment.job.toUpperCase()}</span><div className="j-dept-nav"><button className="j-icon" onClick={()=>stepDepartment(-1)} aria-label="Rama anterior"><ChevronLeft size={16}/></button><span>{departments.findIndex(d=>d.id===currentDepartment.id)+1} / {departments.length}</span><button className="j-icon" onClick={()=>stepDepartment(1)} aria-label="Rama siguiente"><ChevronRight size={16}/></button></div></div><h2>{currentDepartment.name}</h2><p>{currentDepartment.description}</p><div className="j-dept-provider"><i/>{equipo?(equipo.pausado?'Equipo en pausa':'Equipo de agentes activo')+' · Claude':'Equipo de agentes'}</div><button className="j-primary" onClick={()=>setRequest({project:focus.id,role:currentDepartment.id,title:'',body:''})}><Plus size={14}/>Preparar un encargo</button><DeptWork dept={currentDepartment.id}/><p className="j-dept-swipe-hint">Desliza para cambiar de rama</p><DeptJobs entries={requests} role={currentDepartment.id}/><h3>ENCARGOS A ALFRED</h3><DeptRequests entries={requests} role={currentDepartment.id} onOpen={e=>setSelected({kind:'task',data:e})}/><DeptTalk dept={currentDepartment.id}/></aside>}
    {hover&&!dragging&&<div className="j-node-tooltip j-node-card"><strong>{hover.name}</strong><dl>
     <dt>TIPO</dt><dd>{hover.kind==='project'?'Proyecto':hover.kind==='task'?'Encargo':'Función'}</dd>
     <dt>RAMA</dt><dd>{(()=>{const l=departments.find(x=>x.id===hover.role)?.label||hover.role;return l.charAt(0)+l.slice(1).toLowerCase();})()}</dd>
     {hover.kind==='task'&&<><dt>ESTADO</dt><dd>{statusNames[hover.data?.status]||hover.data?.status||'—'}</dd></>}
     {hover.kind==='function'&&parents.has(hover.id)&&<><dt>RAMAS</dt><dd>{teamNodes.filter(x=>x.parent===hover.id).length}</dd></>}
    </dl></div>}
    <div className="j-map-controls"><button className="j-icon" onClick={()=>setZoom(z=>Math.min(2.8,z+.2))} aria-label="Acercar mapa"><Plus size={16}/></button><span>{Math.round(zoom*100)}%</span><button className="j-icon" onClick={()=>setZoom(z=>Math.max(.7,z-.2))} aria-label="Alejar mapa"><Minus size={16}/></button><button className="j-icon" onClick={resetMap} aria-label="Centrar mapa"><Focus size={16}/></button></div>
    <div className="j-department-mobile">{departments.map(d=><button key={d.id} onClick={()=>enterDepartment(d.id)} className={department===d.id?'selected':''}>{d.label}</button>)}</div>
   </>}
   {view==='projects'&&<ProjectsView filter={filter} setFilter={setFilter} search={search} setSearch={setSearch} focusId={focus.id} saving={saving} selected={selected?.kind==='project'?selected.data:null} onSelect={p=>setSelected(p?{kind:'project',data:p}:null)} onChooseFocus={chooseFocus} onRequest={p=>setRequest({project:p.id,role:'radar',title:'',body:''})} onAsk={(p,t)=>void send(`Sobre ${p.name}: ${t}`)}/>}
   {view==='activity'&&<OperationsBoard office={office} onSelect={setSelected} onRequest={()=>setRequest({title:'',body:'',project:focus.id,role:'radar'})} onCapture={()=>setCapture(true)}/>}
   {view==='memory'&&<MemoryView/>}
   {view==='trends'&&<ContentView/>}

  </section>
  <aside className="j-focus-note"><span>FOCO ACTUAL</span><button onClick={()=>setSelected({kind:'project',data:focus})}>{focus.name}<ArrowUpRight size={12}/></button></aside>
  {permission&&<div className="v-permission" role="alertdialog" aria-label="Alfred pide permiso"><span><i/>ALFRED PIDE PERMISO</span><p>Quiere {permission.what}.</p>{permission.detail&&<details><summary>Ver detalles</summary><code>{permission.detail}</code></details>}<div className="v-permission-actions"><button className="v-yes" onClick={()=>answerPermission(true)}>Sí, adelante</button><button className="v-no" onClick={()=>answerPermission(false)}>No</button></div><small>También puedes decir «sí», «no» o «detalles».</small></div>}
  <div className="j-command-area"><div className="j-quick-commands"><button onClick={()=>send('Qué tengo pendiente')}>Qué tengo pendiente</button><button onClick={()=>send('Qué hago ahora')}>Qué hago ahora</button><button onClick={()=>setCapture(true)}>Guardar una idea</button></div><form id="alfred-command" className={'j-command-bar '+(voiceMode==='listening'?'listening':'')} onSubmit={e=>{e.preventDefault();send();}}><button type="button" className="j-command-open" onClick={()=>setChatOpen(!chatOpen)} aria-label={chatOpen?'Cerrar conversación':'Abrir conversación'}><MessageCircle size={19}/></button><input ref={command} aria-label="Hablar con Alfred" value={input} onChange={e=>setInput(e.target.value)} placeholder={voiceMode==='listening'?'Te escucho…':view==='now'?(who?`Cuéntame, ${who}…`:'Cuéntame…'):'Pregunta a Alfred…'} maxLength={4000}/><span className="j-shortcut"><Command size={11}/> K</span><button type="button" className={'j-mic '+(voiceMode==='listening'?'on':'')} onClick={listen} aria-label={voiceMode==='listening'?'Detener micrófono':'Activar micrófono'} disabled={nativeHost&&!brain} title={nativeHost?(brain?'Pulsa o mantén ⌥ derecha para hablar con Alfred':'Dictado disponible al abrir en el navegador'):voiceSupported?'Dictado del navegador, al pulsar':'Dictado no disponible en este navegador'}>{voiceSupported?<Mic size={18}/>:<MicOff size={18}/>}</button><button className="j-send" disabled={!input.trim()||sending} aria-label="Enviar a Alfred"><ArrowUp size={19}/></button></form><p className="j-dock-caption" aria-live="polite">{brain&&voiceMode==='listening'?'Te escucho. Suelta para enviar.':brain&&thinking&&voiceMode==='idle'?(steps.length?steps[steps.length-1]+'…':brain.deep?'Alfred piensa a fondo…':'Alfred está pensando…'):brain&&voiceMode==='idle'&&!waiting.length?'Mantén ⌥ derecha para hablar'+(brain.deep?' · modo profundo':''):voiceMode==='listening'?'Te escucho · revisa el texto antes de enviar':voiceMode==='speaking'?'Alfred está hablando.':waiting.length?(active&&fresh?'Alfred está preparando una respuesta.':'Tu mensaje espera al equipo.'):voiceEnabled?'Lectura de voz activada':fresh&&snap?.bridge?.analysisEnabled?'Equipo conectado':'Conexión con el equipo pendiente'}</p></div>
  {chatOpen&&<aside className="j-chat" role="region" aria-label="Conversación con Alfred"><div className="j-chat-header"><div><i/><strong>Alfred</strong><span>{mode==='thinking'?'Preparando respuesta':mode==='speaking'?'Hablando contigo':'Tu conversación'}</span></div>{brain?.model&&<span className="j-model-pill" title="El modelo lo elige Alfred en cada turno: Sonnet para lo corriente, Opus para pensar a fondo">{modelName(brain.model)}{brain.deep?' · profundo':''}</span>}<button className="j-icon" onClick={()=>setChatOpen(false)} aria-label="Cerrar conversación"><X size={17}/></button></div><div className="j-chat-messages">{!office?.messages?.length&&<div className="j-chat-welcome"><span>{who?`Qué pasa, ${who}.`:'Hola.'}</span><p>Cuéntame qué tienes en la cabeza. Podemos ordenar, decidir y preparar el siguiente paso.</p></div>}{[...(office?.messages||[]),...(optimistic&&!office?.messages?.some(m=>m.id===optimistic.id&&m.author==='user')?[optimistic]:[])].map(m=><article key={m.id+m.author} className={'j-message '+m.author}><div className="j-message-meta">{m.author==='user'?'TÚ':'ALFRED'}{m.source==='codex'&&<span>· Codex</span>}{m.source==='claude'&&<span>· Claude</span>}{m.source==='voz'&&<span>· voz</span>}<time>{new Date(m.at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</time></div>{m.author==='assistant'&&turns[m.id]?.steps.length?<details className="j-trace done"><summary>{turns[m.id].steps.length} {turns[m.id].steps.length===1?'paso':'pasos'} · {secs((turns[m.id].end||Date.now())-turns[m.id].start)}{turns[m.id].model&&<> · {modelName(turns[m.id].model)}</>}</summary><Trace meta={turns[m.id]}/></details>:null}<p>{textBlocks(m.text)}</p>{m.author==='assistant'&&<button className="u-read-reply" onClick={()=>speak(m.text,m.id+':assistant')} aria-label="Escuchar respuesta"><Volume2 size={12}/>Escuchar</button>}{m.author==='user'&&office?.entries.some(e=>e.id==='chat-'+m.id&&e.status==='cancelled')&&<span className="j-cancel-label">Cancelado antes de empezar</span>}{m.actions?.map((a,i)=><button key={i} className="j-proposal" onClick={()=>applyAction(a)}><Plus size={14}/>{a.title}</button>)}{m.runId&&<details className="j-message-evidence"><summary>Ver evidencia</summary><span>{m.runId}</span></details>}</article>)}{live&&turns[live.id]?.steps.length?<div className="j-trace" aria-label="Lo que está haciendo Alfred"><Trace meta={turns[live.id]} live={!live.text}/></div>:null}{live?.text&&<article className="j-message assistant live"><div className="j-message-meta">ALFRED<span>· Claude</span></div><p>{live.text}</p></article>}{waiting.length>0&&<div className="j-chat-pending"><span className={active&&fresh?'j-thinking-mark':'j-pending-mark'}/><p>{active&&fresh?'Preparando tu respuesta con el contexto de tu oficina.':fresh&&snap?.bridge?.analysisEnabled?'Tu mensaje está en la cola del equipo.':'Mensaje guardado. Espera a una sesión del equipo conectada.'}</p></div>}{waiting.filter(e=>e.status==='queued').map(e=><button key={e.id} className="j-cancel-queued" disabled={saving} onClick={()=>act({action:'update',id:e.id,status:'cancelled'}).catch(()=>{})}>Cancelar mensaje en espera</button>)}<div ref={chatBottom}/></div><div className="j-chat-foot"><span>Conversación guardada</span><button onClick={voiceMode==='speaking'?stopSpeaking:toggleVoice}>{voiceEnabled?<Volume2 size={13}/>:<VolumeX size={13}/>} {voiceMode==='speaking'?'Detener voz':voiceEnabled?'Voz activada':'Leer en voz'}</button></div></aside>}
  {selected&&!(view==='projects'&&selected.kind==='project')&&<div className="j-detail-backdrop" onClick={closeDetail}><aside className="j-detail" role="dialog" aria-modal="true" aria-label="Detalle del nodo" onClick={e=>e.stopPropagation()}><div className="j-detail-top"><span className="j-eyebrow">{selected.kind==='project'?'PROYECTO':selected.kind==='function'?'FUNCIÓN DEL EQUIPO':'ENCARGO Y EVIDENCIA'}</span><button className="j-icon" onClick={closeDetail} aria-label="Cerrar detalle"><X size={18}/></button></div><h2>{selected.data?.name||selected.data?.title||selected.name}</h2>{selected.kind==='personal'&&<><p className="j-detail-sub">Marcado como terminado por ti</p><p>{selected.data.title}</p><label>TU RESULTADO</label><p className="j-prewrap">{selected.data.note}</p></>}{selected.kind==='project'&&<><div className="j-detail-sub">{selected.data.line} · {selected.data.stage}</div><label>EL SIGUIENTE PASO</label><p>{selected.data.next}</p><label>LO QUE SABEMOS</label><p>{selected.data.evidence}</p>{selected.data.repo&&<a className="j-text-link" href={selected.data.repo} target="_blank" rel="noreferrer">Ver repositorio <ExternalLink size={14}/></a>}<button className="j-primary" disabled={saving} onClick={()=>chooseFocus(selected.data)}>Elegir como foco</button><button className="j-secondary" onClick={()=>{setRequest({project:selected.data.id,role:selected.role||'radar',title:'',body:''});setSelected(null);}}>Preparar una entrega</button></>}{selected.kind==='function'&&<><div className="j-detail-sub">{roles.find(r=>r.id===selected.role)?.name}</div><p>{selected.description}</p><p className="j-mut">Esta función comparte el ejecutor de su departamento.</p><button className="j-primary" onClick={()=>{setRequest({project:focus.id,role:selected.role,title:'',body:''});setSelected(null);}}>Preparar un encargo</button></>}{['task','canonical'].includes(selected.kind)&&<><div className="j-detail-sub">{statusNames[selected.data.status]||selected.data.status}</div><p className="j-prewrap">{selected.data.body||selected.description}</p>{selected.kind==='task'&&selected.data.kind==='request'&&selected.data.status!=='cancelled'&&<div className="d-path">{REQUEST_STEPS.map((label,i)=>{const p=requestStep(selected.data.status);return <span key={label} className={p.stuck?(i<p.at?'reached':i===p.at?'stuck':''):i<=p.at?'reached':''}><i/>{label}</span>;})}</div>}{selected.data.result&&<><label>{selected.kind==='task'&&selected.data.kind==='request'?requestResultLabel(selected.data.status).toUpperCase():'RESULTADO'}</label><p className="j-prewrap">{textBlocks(selected.data.result)}</p></>}{selected.data.external_id&&<p className="j-evidence-path">{selected.data.external_id}</p>}{selected.kind==='task'&&selected.data.status==='review'&&(revise===null||selected.data.kind!=='request'?<><button className="j-primary" disabled={saving} onClick={async()=>{try{await act({action:'update',id:selected.data.id,status:'accepted'});setSelected(null);setNotice('Entrega aceptada.');}catch{}}}><Check size={15}/>Aceptar entrega</button>{selected.data.kind==='request'&&<button className="j-secondary" disabled={saving} onClick={()=>{setRevise('');setReviseError('');}}>Pedir cambios</button>}</>:<form className="j-revise" onSubmit={async e=>{e.preventDefault();setReviseError('');try{await act({action:'revise',id:selected.data.id,feedback:revise},{quiet:true});setSelected(null);setNotice('Cambios enviados al equipo. Vuelve a la cola.');}catch(err){setReviseError(err instanceof Error?err.message:'No se ha guardado.');}}}><label>Qué hay que cambiar<textarea autoFocus value={revise} onChange={e=>{setRevise(e.target.value);setReviseError('');}} required maxLength={REVISE_FEEDBACK_MAX}/></label><small className="j-revise-count" aria-live="polite">{reviseFull?'Este encargo está cerca de su límite: acéptalo o crea uno nuevo':`Quedan ${REVISE_FEEDBACK_MAX-revise.length} caracteres`}</small>{reviseError&&<p className="j-revise-error" role="alert">{reviseError}</p>}<button className="j-primary" disabled={saving||!revise.trim()||reviseFull}><Send size={15}/>{saving?'Enviando…':'Enviar cambios'}</button><button type="button" className="j-text-link" onClick={()=>{setRevise(null);setReviseError('');}}>Cancelar</button></form>)}{selected.kind==='task'&&selected.data.kind==='idea'&&<button className="j-primary" onClick={()=>{setRequest({entryId:selected.data.id,project:selected.data.project,role:'radar',title:selected.data.title,body:selected.data.body});setSelected(null);setSelected(null);}}>Preparar como entrega</button>}{selected.kind==='task'&&selected.data.status==='queued'&&<button className="j-secondary" disabled={saving} onClick={async()=>{try{await act({action:'update',id:selected.data.id,status:'cancelled'});setSelected(null);setNotice('Encargo cancelado antes de empezar.');}catch{}}}>Cancelar encargo en espera</button>}{selected.kind==='task'&&selected.data.kind==='request'&&selected.data.status==='blocked'&&<><button className="j-primary" disabled={saving} onClick={async()=>{try{await act({action:'update',id:selected.data.id,status:'queued'});setSelected(null);setNotice('Encargo de nuevo en cola. El equipo lo retomará.');}catch{}}}>Reintentar encargo</button><button className="j-secondary" disabled={saving} onClick={async()=>{try{await act({action:'update',id:selected.data.id,status:'cancelled'});setSelected(null);setNotice('Encargo cancelado.');}catch{}}}>Cancelar encargo</button></>}{selected.kind==='canonical'&&<p className="j-mut">Estado conservado en Hermes. Esta vista muestra la última lectura.</p>}</>}</aside></div>}
  {request&&<div className="j-modal-backdrop" onClick={()=>setRequest(null)}><section className="j-request-modal" role="dialog" aria-modal="true" aria-label="Preparar entrega" onClick={e=>e.stopPropagation()}><div className="j-detail-top"><span className="j-eyebrow">UNA ENTREGA CONCRETA</span><button className="j-icon" onClick={()=>setRequest(null)} aria-label="Cerrar encargo"><X size={18}/></button></div><h2>Qué necesitas del equipo.</h2><form onSubmit={async e=>{e.preventDefault();try{await act(request.entryId?{action:'prepare',id:request.entryId,...request}:{action:'create',kind:'request',...request});setRequest(null);setNotice('Encargo enviado al equipo.');}catch{}}}><label>Resultado esperado<input autoFocus value={request.title} onChange={e=>setRequest({...request,title:e.target.value})} required maxLength={ENTRY_TITLE_MAX}/></label><div className="j-form-row"><label>Proyecto<select value={request.project} onChange={e=>setRequest({...request,project:e.target.value})}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Responsable<select value={request.role} onChange={e=>setRequest({...request,role:e.target.value})}>{roles.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label></div><label>Contexto y criterio de entrega<textarea value={request.body} onChange={e=>setRequest({...request,body:e.target.value})} required maxLength={ENTRY_BODY_MAX}/></label><p className="j-mut">Esta vía prepara análisis. La construcción de productos conserva sus autorizaciones y revisiones.</p><button className="j-primary" disabled={saving}><Send size={15}/>{saving?'Guardando…':'Enviar encargo'}</button></form></section></div>}
  {capture&&<div className="j-modal-backdrop" onClick={()=>setCapture(false)}><section className="j-request-modal j-capture-modal" role="dialog" aria-modal="true" aria-label="Guardar idea" onClick={e=>e.stopPropagation()}><div className="j-detail-top"><span className="j-eyebrow">DALE UN LUGAR. SIGUE CON LO TUYO.</span><button className="j-icon" aria-label="Cerrar captura" onClick={()=>setCapture(false)}><X size={18}/></button></div><h2>Para después.</h2><form onSubmit={async e=>{e.preventDefault();try{await act({action:'create',kind:'idea',title:ideaText.trim().slice(0,ENTRY_TITLE_MAX),body:ideaText,project:focus.id,role:'alfred'});setCapture(false);setIdeaText('');setNotice('Idea guardada. Puedes seguir con tu paso.');}catch{}}}><label>Lo que tienes en la cabeza<textarea aria-label="Tu idea" autoFocus value={ideaText} onChange={e=>setIdeaText(e.target.value)} required maxLength={ENTRY_BODY_MAX} placeholder="No hace falta ordenarlo todavía."/></label><p className="j-mut">Se guarda en Ideas. Tu foco y tu paso siguen donde estaban.</p><button className="j-primary" disabled={saving||!ideaText.trim()}>Guardar y volver <Check size={15}/></button></form></section></div>}
  {notice&&<div className="j-toast" role="status">{notice}<button className="j-icon" onClick={()=>setNotice('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}
  {setup&&<SetupWizard onDone={()=>setSetup(false)}/>}
 </div>;
}
