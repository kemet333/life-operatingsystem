// Alfred por Telegram: the same brain as the voice (voice.ts), the same permission rule and one linked chat.
// The bot token lives in the Keychain (service "alfred-telegram"); the link is made with a one-time code that
// only the Mac app shows, so nobody else who finds the bot can talk to Alfred.
import * as profile from './profile';
import {ruta,texto,soporte} from './config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {randomInt,randomUUID} from 'node:crypto';
import * as voice from './voice';
import * as hoy from './hoy';
import * as repaso from './repaso';
import * as cal from './calendario';
import {BOTON_LANZADO,BOTON_MEDIDO,boton,lanzadoBoton,medidoBoton,preguntaMedido,experimentoDeRespuesta,PREGUNTA_MEDIDO_INICIO,experimentoArgs,decisionDeTexto,experimentosPendientes,mensajesFaltaDecidir,decisionesDelEquipo,decidirBotones,decidirBoton,preguntaBotones,preguntaBoton,preguntasPendientes,pedirRespuesta,respuestaA,textoGrupo,botonesGrupo,grupoBoton,etiquetaAccion,ordenesGrupo,BOTON_NO_LANZO,BOTON_DECIDIR,noLanzoBoton,preguntaFreno,experimentoDeFreno,PREGUNTA_FRENO_INICIO,decisionExperimentoBoton,PROJECT,BOTON_FUSIONAR,fusionarBoton,mensajesFusion,fusionPendienteDeGrupo} from './equipo-acciones';
import * as secretos from './secretos';

type Deps={dataDir:string;equipo:(args:string[],timeout?:number)=>Promise<string>;remember:(id:string,author:'user'|'assistant',text:string)=>Promise<void>};
type Link={chatId:number;userId:number;name:string;since:string};
export type TelegramStatus={estado:'sin-token'|'sin-vincular'|'vinculado'|'error';bot?:string;codigo?:string;nombre?:string;desde?:string;error?:string};

// Tests point the module at a fake Telegram (telegram-checks.mjs); the real app always talks to api.telegram.org.
const TEST=process.env.LIFE_OS_TELEGRAM_TEST_API&&process.env.LIFE_OS_TELEGRAM_TEST_TOKEN?{api:process.env.LIFE_OS_TELEGRAM_TEST_API,token:process.env.LIFE_OS_TELEGRAM_TEST_TOKEN}:null;
const API=TEST?.api||'https://api.telegram.org/bot';
// Telegram is read at a glance: one or two short lines, unless he asks for detail. Today's to-do rides along as context.
const prefix=()=>'['+profile.load().name+' te escribe por Telegram desde el móvil: no está delante del Mac y te lee en texto, no te oye. Responde en una o dos líneas cortas (menos de 200 caracteres), sin saludo ni despedida, que se lean en un segundo: lo esencial y qué hacer. Alárgate solo si te pide detalle. Nada de listas largas ni markdown. Las indicaciones <<vista…>> no sirven aquí. Si te manda un enlace, léelo (WebFetch) y dile en una línea qué es y si merece la pena. '+hoy.context(today())+' '+repaso.context(repaso.load(deps.dataDir),new Date())+']\n';
const today=()=>hoy.load(deps.dataDir,hoy.isoDay(new Date()));
const HELP=['Escríbeme, mándame una nota de voz, una foto o un enlace, como si me hablaras en el Mac.','','/hoy — tu to-do de hoy, con botones para tacharla','/repaso — las tarjetas que te tocan hoy (active recall)','/calendario — si Alfred puede ver tu calendario y Recordatorios','/equipo — qué hace el equipo ahora','/lote — el lote del día, lo que hay por fusionar y los experimentos por lanzar o medir, con botones','/mesa — lo que el equipo te ha escrito','/hermes — tableros y tareas programadas de Hermes','/pausa y /seguir — parar o reanudar el equipo','/nueva — empezar una conversación nueva'].join('\n');
const MAX_ATTEMPTS=5;

let deps:Deps,token:string|null=null,bot='',link:Link|null=null,code='',attempts=0,offset=0,stopped=false,lastError='';
let chain:Promise<unknown>=Promise.resolve();
let morning:ReturnType<typeof setInterval>|null=null,ticks=0;
const permissionMessages=new Map<string,number>();
// «¿Qué mediste…?» messages waiting for the owner's reply: message_id → the experiment the reply is the result of.
const measureAsks=new Map<number,{project:string;tarea:string;titulo:string}>();
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const linkFile=()=>path.join(deps.dataDir,'telegram.json');
const clean=(e:unknown)=>(e instanceof Error?e.message:String(e)).split(token||'\0').join('…').slice(0,160);

function keychain():Promise<string|null>{
 if(TEST)return Promise.resolve(TEST.token);
 return secretos.leer('alfred-telegram').then(t=>t&&/^\d+:[A-Za-z0-9_-]{30,}$/.test(t)?t:null);
}
async function call(method:string,body:Record<string,unknown>,timeoutMs=15000){
 const r=await fetch(API+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
 const j:any=await r.json().catch(()=>({}));
 if(!j.ok)throw Error(j.description||'Telegram ha respondido '+r.status);
 return j.result;
}
async function send(text:string,extra:Record<string,unknown>={}){
 if(!link)return null;
 // Telegram caps a message at 4096 characters; split on paragraph or sentence boundaries.
 let rest=text.trim(),last:any=null;
 while(rest){let cut=rest.length<=3800?rest.length:Math.max(rest.lastIndexOf('\n',3800),rest.lastIndexOf('. ',3800)+1);if(cut<=0)cut=3800;
  const piece=rest.slice(0,cut).trim();rest=rest.slice(cut).trim();
  last=await call('sendMessage',{chat_id:link.chatId,text:piece,disable_web_page_preview:true,...(rest?{}:extra)});}
 return last;
}
function newCode(){code=String(randomInt(100000,1000000));attempts=0;}

export function status():TelegramStatus{
 if(lastError&&!token)return {estado:'error',error:lastError};
 if(!token)return {estado:'sin-token'};
 if(!link)return {estado:'sin-vincular',bot,codigo:attempts<MAX_ATTEMPTS?code:undefined,error:attempts>=MAX_ATTEMPTS?'Demasiados intentos. Pide un código nuevo.':undefined};
 return {estado:'vinculado',bot,nombre:link.name,desde:link.since};
}
export function control(action:string){
 if(action==='codigo')newCode();
 else if(action==='desvincular'){link=null;try{fs.rmSync(linkFile());}catch{}newCode();}
 else throw Error('Acción de Telegram no válida.');
 return status();
}

// ---------- team shortcuts (read the engine's status; act only on the owner's explicit tap) ----------

async function team(){return JSON.parse(await deps.equipo(['status']));}
const ago=(iso?:string)=>{if(!iso)return '';const d=new Date(iso);return d.toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'});};

async function teamSummary(){
 const s=await team(),lines=[s.pausado?'El equipo está en pausa.':'Equipo · ✓ hecha  ▶ trabajando  ○ en cola  ✕ bloqueada'];
 for(const p of Object.values<any>(s.proyectos)){
  const steps:any[]=p.tareas||[],icon:Record<string,string>={'hecha':'✓','trabajando':'▶','en cola':'○','bloqueada':'✕'};
  lines.push('',p.nombre);
  if(steps.length)for(const t of steps)lines.push(icon[t.estado]+' '+t.titulo+(t.estado==='hecha'&&t.hora?' ('+t.hora+')':t.estado==='hecha'?'':' — '+t.estado));
  else lines.push(p.trabajando[0]?'▶ '+p.trabajando[0].titulo:'Sin tareas en curso.');
 }
 return lines.join('\n');
}
// Team work that is done and reviewed, waiting to be joined to the owner's project: said plainly, one tap.
async function merges(s:any,omitir:string[]=[]){
 let any=false;
 for(const {texto,reply_markup} of mensajesFusion(s,omitir)){any=true;await send(texto,{reply_markup});}
 return any;
}
async function batch(){
 const s=await team();let any=false;
 // What waits for the owner, explained in plain words and grouped by the engine (para_ti): one message per thing.
 const grupos:any[]=Array.isArray(s.para_ti)?s.para_ti:[];
 if(grupos.length){
  for(const g of grupos)await send(textoGrupo(g,s.tablero),{reply_markup:botonesGrupo(g,s.tablero)});
  for(const {texto,...opciones} of mensajesFaltaDecidir(s))await send(texto,opciones);
  const omitir=[...new Set(grupos.map(g=>fusionPendienteDeGrupo(g,s.tablero)).filter((pid):pid is string=>pid!==null))];
  await merges(s,omitir);return;
 }
 for(const [pid,p] of Object.entries<any>(s.proyectos)){
  const tareas=p.lote?.tareas||[];if(p.lote?.estado!=='pendiente'||!tareas.length)continue;any=true;
  // What waits for the owner after the team approved the routine part: one decision per message, Sí / No / Más tarde.
  if(Array.isArray(p.lote.indices)||tareas.some((t:any)=>t.importante)){
   const idx:number[]=p.lote.indices||tareas.map((_:any,i:number)=>i);
   for(const [n,t] of tareas.entries())await send(`${p.nombre} · decide: ${t.titulo}`+(typeof t.importante==='string'?`\n${t.importante}`:''),{reply_markup:decidirBotones(pid,idx[n])});
   continue;
  }
  await send(p.nombre+' — lote del '+s.fecha+'\n\n'+tareas.map((t:any,i:number)=>(i+1)+'. '+t.titulo).join('\n'),{reply_markup:{inline_keyboard:[[{text:'Aprobar las '+tareas.length,callback_data:'a:'+pid}]]}});
 }
 if(await merges(s))any=true;
 // Finished experiments nobody has launched: the button writes down the launch, which starts the clock to measure it.
 const {porLanzar,faltaMedir}=experimentosPendientes(s.tablero||[]);
 for(const it of porLanzar){
  any=true;
  const l=it.lanzamiento,botones=[{text:'Ya lo he lanzado',callback_data:boton(BOTON_LANZADO,it.id)},{text:'No lo lanzo',callback_data:boton(BOTON_NO_LANZO,it.id)}].filter(b=>b.callback_data!==null);
  await send((s.proyectos?.[it.proyecto]?.nombre||it.proyecto)+' — listo para lanzar: «'+it.titulo+'»\nQué: '+l.que+'\nA quién: '+l.a_quien+'\nMétrica: '+l.metrica+'\nUmbral: '+l.umbral,
   botones.length?{reply_markup:{inline_keyboard:[botones]}}:{});
 }
 // Launched experiments waiting for a result: the button asks what he measured and the reply is written down.
 for(const it of faltaMedir){
  any=true;
  const l=it.lanzamiento,data=boton(BOTON_MEDIDO,it.id);
  await send((s.proyectos?.[it.proyecto]?.nombre||it.proyecto)+' — falta medir: «'+it.titulo+'»\nMétrica: '+l.metrica+'\nUmbral: '+l.umbral,
   data?{reply_markup:{inline_keyboard:[[{text:'Apuntar lo medido',callback_data:data}]]}}:{});
 }
 for(const {texto,...opciones} of mensajesFaltaDecidir(s)){
  any=true;
  await send(texto,opciones);
 }
 if(!any)await send('No hay ningún lote, fusión ni experimento por lanzar, medir o decidir.');
}
async function mesaSummary(){
 const s=await team(),m=s.mesa||{},r=m.reunion||{};
 const deps_=m.departamentos||{},who=(id:string)=>id==='owner'?'Tú':deps_[id]||id;
 const lines=[r.resumen?'Reunión de hoy: '+r.resumen:'Hoy no ha habido reunión todavía.'];
 if(r.acuerdos?.length)lines.push('','Acuerdos:',...r.acuerdos.slice(0,5).map((a:any)=>'• '+(a.titulo||a.texto||a)));
 const asks=preguntasPendientes(m);
 lines.push('',asks.length?`Te ${asks.length===1?'espera 1 pregunta':`esperan ${asks.length} preguntas`}:`:'No te espera ninguna pregunta.');
 await send(lines.join('\n'));
 // Each question on its own, with buttons: answering takes one tap.
 for(const q of asks)await send(`${who(q.de)} te pregunta: ${q.texto}`,{reply_markup:preguntaBotones(q.id)});
}
async function hermesSummary(){
 const h=(await team()).hermes||{},lines:string[]=[];
 const stale=h.reloj&&Date.now()-new Date(h.reloj).getTime()>60*60*1000;
 if(h.programadas?.length){lines.push(stale?'Las tareas programadas de Hermes están paradas desde el '+ago(h.reloj)+'.':'Tareas programadas de Hermes:');
  for(const j of h.programadas)lines.push('• '+j.nombre+' ('+j.cada+') — última '+ago(j.ultima)+(j.estado==='error'?', con error':''));}
 for(const b of h.tableros||[]){const e=b.estados||{};lines.push('','• '+b.nombre+': '+Object.entries(e).map(([k,v])=>v+' '+k).join(' · '));
  if(b.revision?.length)lines.push('  En revisión: '+b.revision.join('; '));if(b.bloqueadas?.length)lines.push('  Bloqueadas: '+b.bloqueadas.join('; '));}
 return lines.join('\n')||'Hermes no tiene tableros ni tareas programadas.';
}
const DEPTS:Record<string,string>={operaciones:'alfred',inteligencia:'radar',producto:'product',creativo:'studio',negocio:'business',control:'control',todos:'todos'};

// ---------- Alfred ----------

async function alfred(text:string){
 const id=randomUUID();await deps.remember(id,'user',text);
 const typing=()=>call('sendChatAction',{chat_id:link!.chatId,action:'typing'}).catch(()=>{});
 void typing();const timer=setInterval(typing,4500);
 const pieces:string[]=[];let sent=0; // raw pieces keep their own line breaks: joined as they came
 const day=today()||{fecha:hoy.isoDay(new Date()),items:[]};let listChanged=false;
 const cards=repaso.load(deps.dataDir);let cardsAdded=0;
 // Flush what Alfred has said before he goes off to read or asks for a permission, so the owner isn't left waiting.
 const flush=async()=>{const out=pieces.slice(sent).join('').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();sent=pieces.length;if(out)await send(out);};
 let outbox=Promise.resolve();const queue=(fn:()=>Promise<unknown>)=>{outbox=outbox.then(fn,fn).then(()=>{},()=>{});};
 const emit=(e:voice.VoiceEvent)=>{
  if(e.t==='say'&&(e.raw||e.text)){const raw=e.raw??e.text,lead=raw.match(/^\s*/)![0],tail=raw.match(/\s*$/)![0];const r=hoy.applyDirectives(raw,day);if(r.changed)listChanged=true;const c=repaso.applyDirectives(r.text,cards,new Date());cardsAdded+=c.added.length;if(c.text)pieces.push(lead+c.text+tail);}
  else if(e.t==='state'&&e.v==='tool')queue(flush);
  else if(e.t==='permission')queue(async()=>{await flush();const m=await send('Alfred quiere '+e.what+'.'+(e.detail?'\n\n'+e.detail.slice(0,700):''),{reply_markup:{inline_keyboard:[[{text:'Permitir',callback_data:'p:'+e.id+':1'},{text:'No',callback_data:'p:'+e.id+':0'}]]}});if(m)permissionMessages.set(e.id,m.message_id);});
  else if(e.t==='permission-closed')queue(async()=>{const mid=permissionMessages.get(e.id);permissionMessages.delete(e.id);if(mid)await call('editMessageReplyMarkup',{chat_id:link!.chatId,message_id:mid,reply_markup:{inline_keyboard:[[{text:e.allowed?'✓ Permitido':'✕ No permitido',callback_data:'x'}]]}}).catch(()=>{});});
  else if(e.t==='error')queue(()=>send(e.message));
 };
 try{
  const reply=await voice.speak(id,prefix()+text,emit);
  queue(flush);await outbox;
  if(listChanged){hoy.save(deps.dataDir,day);await refreshList(day);void pushReminders();}
  if(cardsAdded)repaso.save(deps.dataDir,cards);
  if(reply)await deps.remember(id,'assistant',repaso.applyDirectives(hoy.applyDirectives(reply,{fecha:day.fecha,items:[]}).text,[],new Date()).text);else if(!pieces.length)await send('No he podido terminar la respuesta.');
 }catch{await send('No he podido abrir la sesión de Claude. Comprueba en el Mac que tu cuenta sigue conectada.');}
 finally{clearInterval(timer);}
}

// ---------- today's to-do: written by Alfred at nine, ticked with a button ----------
async function refreshList(day:hoy.Day){
 if(!day.mensaje)return;
 await call('editMessageText',{chat_id:link!.chatId,message_id:day.mensaje,text:hoy.render(day),reply_markup:hoy.keyboard(day)}).catch(()=>{});
}
async function decisions(){
 try{return decisionesDelEquipo(await team());}catch{return [];}
}
async function writeToday():Promise<hoy.Day>{
 const now=new Date(),fecha=hoy.isoDay(now),before=hoy.load(deps.dataDir,fecha);
 const y=new Date(now);y.setDate(y.getDate()-1);
 let agenda='';if(cal.available())try{agenda=cal.agenda(await cal.events(fecha));}catch{}
 const ctx={yesterday:hoy.load(deps.dataDir,hoy.isoDay(y)),decisions:await decisions(),agenda};
 let lines:string[]=[];
 let raw='',why='';
 try{await voice.speak(randomUUID(),hoy.prompt(ctx),e=>{if(e.t==='say')raw+=e.raw;else if(e.t==='error')why=e.message;});lines=hoy.parse(raw);}catch(e){why=clean(e);}
 hoy.note(deps.dataDir,`${fecha} ${lines.length?'Alfred '+lines.length+' tareas':'respaldo'}${why?' · '+why:''}${!lines.length&&raw?' · respuesta sin lista: '+raw.slice(0,160).replace(/\s+/g,' '):''}`);
 // If Alfred could not write it, the list still comes: decisions first, then what was left from yesterday.
 if(!lines.length)lines=[...ctx.decisions.map(d=>d[0].toUpperCase()+d.slice(1)),...(ctx.yesterday?.items||[]).filter(i=>!i.hecho).map(i=>i.t)].slice(0,hoy.MAX);
 const kept=(before?.items||[]).filter(i=>!lines.some(l=>l.toLowerCase()===i.t.toLowerCase()));
 return {fecha,items:[...lines.map(t=>({t,hecho:false})),...kept],enviado:now.toISOString(),...(agenda?{agenda}:{})};
}
async function showToday(){
 let day=today();
 if(!day||!day.items.length){void call('sendChatAction',{chat_id:link!.chatId,action:'typing'}).catch(()=>{});day=await writeToday();}
 if(!day.items.length)return void await send('Hoy no tengo nada que proponerte. Dime qué quieres hacer y lo apunto.');
 const m=await send(hoy.render(day),{reply_markup:hoy.keyboard(day)});
 const first=!day.enviado;day.mensaje=m?.message_id;day.enviado=day.enviado||new Date().toISOString();hoy.save(deps.dataDir,day);
 void pushReminders();
 // the morning brings the day's review too, as a separate one-line invitation
 if(first){const n=repaso.due(repaso.load(deps.dataDir),new Date()).length;if(n)await send(repaso.invite(n),{reply_markup:repaso.startButton()});}
}

// ---------- review: one message edited in place, card after card ----------
let review:{ids:string[];i:number;right:number}|null=null;
async function startReview(messageId?:number){
 const cards=repaso.load(deps.dataDir),list=repaso.due(cards,new Date());
 if(!list.length){const t='Nada que repasar hoy. Mándame algo que quieras aprender y lo guardo.';return void (messageId?await call('editMessageText',{chat_id:link!.chatId,message_id:messageId,text:t}).catch(()=>{}):await send(t));}
 review={ids:list.map(c=>c.id),i:0,right:0};
 const c=list[0],text=repaso.question(c,1,list.length);
 if(messageId)await call('editMessageText',{chat_id:link!.chatId,message_id:messageId,text,reply_markup:repaso.showButton(c)}).catch(()=>{});
 else await send(text,{reply_markup:repaso.showButton(c)});
}
// ---------- Apple Reminders: the same list on the iPhone (list «Alfred») ----------
/** Recent days' reminder ids: a reminder Alfred already handled is not taken as a new task the owner added. */
function knownReminders(){const ids=new Set<string>();for(let i=0;i<8;i++){const d=new Date();d.setDate(d.getDate()-i);for(const it of hoy.load(deps.dataDir,hoy.isoDay(d))?.items||[])if(it.rid)ids.add(it.rid);}return ids;}
/** Every task of today without a reminder gets one (reusing an open reminder with the same title: yesterday's carry-over). */
function pushReminders(){
 if(!cal.available())return;
 chain=chain.then(async()=>{
  const day=today();if(!day)return;
  let open:cal.Rem[]=[];try{open=(await cal.reminders()).filter(r=>!r.hecho);}catch{return;}
  let changed=false;
  for(const it of day.items){if(it.rid||it.hecho)continue;
   const same=open.find(r=>r.titulo.trim().toLowerCase()===it.t.toLowerCase());
   try{it.rid=same?.id||await cal.create(it.t,day.fecha);changed=true;}catch{}}
  if(changed)hoy.save(deps.dataDir,day);
 }).catch(()=>{});
}
/** Ticks made in Reminders reach today's list; reminders the owner adds to the list become tasks. */
let syncing=false;
function calendarSync(){
 if(!link||!cal.available()||syncing)return;syncing=true;
 chain=chain.then(async()=>{
  const day=today();if(!day)return;
  const rems=await cal.reminders(),known=knownReminders();let changed=false;
  for(const it of day.items){const r=it.rid&&rems.find(x=>x.id===it.rid);if(r&&r.hecho&&!it.hecho){it.hecho=true;changed=true;}}
  for(const r of rems)if(!r.hecho&&!known.has(r.id)&&(!r.vence||r.vence<=day.fecha)){day.items.push({t:r.titulo.trim().slice(0,70),hecho:false,rid:r.id});changed=true;}
  if(changed){hoy.save(deps.dataDir,day);await refreshList(day);}
 }).catch(()=>{}).finally(()=>{syncing=false;});
}
async function calendarStatus(){
 if(!cal.available())return void await send('El calendario solo funciona con la app del Mac abierta.');
 try{const p=await cal.permission(),ok=(v:string)=>v==='concedido'?'con permiso':'sin permiso';
  await send(`Calendario: ${ok(p.eventos)} · Recordatorios: ${ok(p.recordatorios)}.`+(p.eventos!=='concedido'||p.recordatorios!=='concedido'?' Actívalo en Ajustes del Sistema → Privacidad → Calendarios / Recordatorios → life.operatingsystem.':' Tu to-do va a la lista «Alfred» de Recordatorios.'));
 }catch(e){await send('No he podido mirar el calendario: '+clean(e)+'.');}
}

let morningBusy=false;
/** Once a day from nine (until two, if the Mac was off at nine). */
function morningCheck(){
 if(!link||!token||morningBusy||voice.busy())return;
 const now=new Date(),h=now.getHours(),day=today();
 if(h<hoy.HOUR||h>=hoy.LAST||day?.enviado)return;
 morningBusy=true;chain=chain.then(showToday).catch(()=>{}).finally(()=>{morningBusy=false;});
}

// ---------- voice notes: transcribed on this Mac (whisper.cpp), never sent anywhere else ----------

const WHISPER_MODEL=ruta('whisper.modelo','LIFE_OS_WHISPER_MODEL',path.join(soporte||os.homedir(),'modelos','ggml-large-v3-turbo-q5_0.bin'));
const tool=(name:string)=>['/opt/homebrew/bin/'+name,'/usr/local/bin/'+name].find(p=>fs.existsSync(p))||name;
// Names Whisper would otherwise mishear ("traders fundidos").
const VOCABULARY=texto('whisper.vocabulario','Alfred, Claude, Entregas, Cartera.');
const run=(cmd:string,args:string[],timeout:number)=>new Promise<string>((resolve,reject)=>execFile(cmd,args,{timeout,maxBuffer:4_000_000},(e,out)=>e?reject(e):resolve(String(out))));

/** Any audio file → Spanish text. Exported for telegram-checks. */
export async function transcribeFile(file:string){
 if(!fs.existsSync(WHISPER_MODEL))throw Error('falta el modelo de voz en este ordenador');
 // A 16 kHz mono WAV (the desktop app's push-to-talk) goes straight to Whisper; anything else is converted first.
 const direct=file.endsWith('.wav'),wav=direct?file:file+'.wav';
 try{
  if(!direct)await run(tool('ffmpeg'),['-loglevel','error','-y','-i',file,'-ar','16000','-ac','1','-c:a','pcm_s16le',wav],60_000);
  const out=await run(tool('whisper-cli'),['-m',WHISPER_MODEL,'-l','es','-nt','-np','--prompt',VOCABULARY,'-f',wav],180_000);
  return out.replace(/\s+/g,' ').trim();
 }finally{if(!direct)fs.rmSync(wav,{force:true});}
}
/** Whether this computer can transcribe (the Whisper model is in place). */
export const canTranscribe=()=>fs.existsSync(WHISPER_MODEL);

/** A photo or a document the owner sends → a file in the data folder that Alfred can open (Read sees images and PDFs). */
async function receiveFile(m:any):Promise<{file:string;kind:string}>{
 const doc=m.document,photo=Array.isArray(m.photo)?m.photo[m.photo.length-1]:null,f=photo||doc;
 if((f.file_size||0)>20_000_000)throw Error('pesa más de 20 MB');
 const info=await call('getFile',{file_id:f.file_id});
 const r=await fetch(API.replace(/\/bot$/,'/file/bot')+token+'/'+info.file_path,{signal:AbortSignal.timeout(60_000)});
 if(!r.ok)throw Error('no he podido descargarlo');
 const dir=path.join(deps.dataDir,'telegram','recibido');fs.mkdirSync(dir,{recursive:true});
 const ext=(path.extname(doc?.file_name||info.file_path)||'.jpg').toLowerCase().replace(/[^.a-z0-9]/g,'');
 const file=path.join(dir,hoy.isoDay(new Date())+'-'+m.message_id+ext);
 fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()),{mode:0o600});
 return {file,kind:photo?'una foto':/pdf/i.test(doc?.mime_type||'')?'un PDF':'un archivo'};
}

async function transcribeVoice(m:any){
 const v=m.voice||m.audio;
 if((v.duration||0)>300)throw Error('dura más de cinco minutos');
 if((v.file_size||0)>20_000_000)throw Error('pesa más de 20 MB');
 const info=await call('getFile',{file_id:v.file_id});
 const r=await fetch(API.replace(/\/bot$/,'/file/bot')+token+'/'+info.file_path,{signal:AbortSignal.timeout(60_000)});
 if(!r.ok)throw Error('no he podido descargar el audio');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alfred-audio-')),file=path.join(dir,'nota'+(path.extname(info.file_path)||'.oga'));
 try{fs.writeFileSync(file,Buffer.from(await r.arrayBuffer()));return await transcribeFile(file);}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}

// ---------- updates ----------

async function onMessage(m:any){
 const text=typeof m.text==='string'?m.text.trim():'';
 if(!link){
  if(m.chat?.type!=='private')return;
  const given=text.match(/^(?:\/(?:start|vincular)\s*)?(\d{6})$/)?.[1];
  if(given&&attempts<MAX_ATTEMPTS&&given===code){
   link={chatId:m.chat.id,userId:m.from.id,name:[m.from.first_name,m.from.last_name].filter(Boolean).join(' ')||profile.load().name,since:new Date().toISOString()};
   fs.writeFileSync(linkFile(),JSON.stringify(link),{mode:0o600});code='';
   await send('Vinculado. Soy Alfred: el mismo que en tu Mac, con la misma memoria y los mismos permisos.\n\n'+HELP);return;
  }
  if(given)attempts++;
  await call('sendMessage',{chat_id:m.chat.id,text:`Este Alfred es privado. Si eres ${profile.load().name}, envía el código de 6 cifras que aparece en ${profile.load().app}, en Entregas → Telegram.`}).catch(()=>{});
  return;
 }
 // Only the linked person in the linked private chat; everything else is ignored without a reply.
 if(m.chat?.id!==link.chatId||m.from?.id!==link.userId)return;
 // A reply to a «¿Qué mediste…?» message is the experiment's result, not a chat with Alfred.
 const answerTo=text&&!text.startsWith('/')?respuestaA(m.reply_to_message?.text):null;
 if(answerTo){
  let qm:any;try{qm=((await team()).mesa?.mensajes||[]).find((x:any)=>x.id===answerTo);}catch{}
  if(!qm)return void await send('Esa pregunta ya no está en la mesa de hoy. Escríbeselo con /a <departamento> <mensaje>.');
  await deps.equipo(['mensaje',qm.de,'--texto',text.slice(0,1200),'--responde-a',answerTo]);
  return void await send('Enviado. Te responden en menos de cinco minutos.');
 }
 let asked=text&&!text.startsWith('/')?measureAsks.get(m.reply_to_message?.message_id):undefined;
 // After a restart measureAsks is empty: the quoted question still names the experiment.
 if(!asked&&text&&!text.startsWith('/')&&typeof m.reply_to_message?.text==='string'&&m.reply_to_message.text.startsWith(PREGUNTA_MEDIDO_INICIO)){
  try{
   const it=experimentoDeRespuesta(m.reply_to_message.text,experimentosPendientes((await team()).tablero).faltaMedir);
   if(it)asked={project:it.proyecto,tarea:it.id,titulo:it.titulo};
  }catch{asked=undefined;}
  if(!asked)return void await send('Ese experimento ya no está pendiente de medir. Míralo en Entregas.');
 }
 if(!asked&&!text.startsWith('/')&&typeof m.reply_to_message?.text==='string'&&m.reply_to_message.text.startsWith(PREGUNTA_FRENO_INICIO)){
  let it:any;
  try{it=experimentoDeFreno(m.reply_to_message.text,experimentosPendientes((await team()).tablero).porLanzar);}
  catch{return void await send('Ese experimento ya no está pendiente de lanzar. Míralo en Entregas.');}
  if(!it)return void await send('Ese experimento ya no está pendiente de lanzar. Míralo en Entregas.');
  const r=experimentoArgs({action:'descartar',tarea:it.id,texto:text});
  if('error' in r)return void await send(r.error);
  try{await deps.equipo(r.args);}catch{return void await send('No se ha podido apuntar. Míralo en Entregas.');}
  return void await send('Apuntado: «'+it.titulo+'» no se lanza por ahora. El equipo lo tendrá en cuenta al planificar. Si cambias de idea, «Ya lo he lanzado» sigue valiendo.');
 }
 if(asked){
  const decision=decisionDeTexto(text),r=experimentoArgs({action:'resultado',project:asked.project,tarea:asked.tarea,texto:text,decision});
  if('error' in r)return void await send(r.error);
  try{await deps.equipo(r.args);}catch{return void await send('No se ha podido apuntar. Míralo en Entregas.');}
  measureAsks.delete(m.reply_to_message.message_id);
  if(!decision){
   const botones=['seguir','cambiar','parar'].map(d=>({text:d[0].toUpperCase()+d.slice(1),callback_data:boton(BOTON_DECIDIR+d+':',asked.tarea)}));
   if(botones.every(b=>b.callback_data))return void await send('Apuntado el resultado de «'+asked.titulo+'». ¿Qué decides?',{reply_markup:{inline_keyboard:[botones]}});
  }
  return void await send(decision?'Apuntado el resultado de «'+asked.titulo+'» (decisión: '+decision+').':'Apuntado el resultado de «'+asked.titulo+'». Si empiezas por «seguir», «cambiar» o «parar», el equipo sabrá qué hacer después.');
 }
 if(!text&&(m.voice||m.audio)){
  void call('sendChatAction',{chat_id:link.chatId,action:'typing'}).catch(()=>{});
  let heard='';
  try{heard=await transcribeVoice(m);}catch(e){return void await send('No he podido escuchar el audio: '+clean(e)+'. Puedes escribírmelo.');}
  if(!heard)return void await send('No he entendido nada en el audio. ¿Me lo repites o me lo escribes?');
  await send('🎙️ He entendido: «'+heard.slice(0,900)+'»');
  return void await alfred(heard);
 }
 if(!text&&(m.photo||m.document)){
  const caption=typeof m.caption==='string'?m.caption.trim():'';
  let got:{file:string;kind:string};
  try{got=await receiveFile(m);}catch(e){return void await send('No he podido abrirlo: '+clean(e)+'.');}
  return void await alfred(`[Te manda ${got.kind}; está en ${got.file}. Ábrelo con Read antes de responder.]${caption?' '+caption:' Sin texto: dile en una línea qué ves y qué haría con ello.'}`);
 }
 if(!text){await send('Leo texto, notas de voz, fotos, PDF y enlaces; esto todavía no.');return;}
 const [cmd,...rest]=text.split(/\s+/),arg=rest.join(' ');
 switch(cmd.toLowerCase().replace(/@.*$/,'')){
  case '/start':case '/ayuda':case '/help':return void await send(HELP);
  case '/hoy':return void await showToday();
  case '/calendario':return void await calendarStatus();
  case '/repaso':return void await startReview();
  case '/equipo':return void await send(await teamSummary());
  case '/lote':return void await batch();
  case '/mesa':return void await mesaSummary();
  case '/hermes':return void await send(await hermesSummary());
  case '/pausa':await deps.equipo(['pause']);return void await send('Equipo en pausa. Termina lo que tenga a medias y no empieza nada nuevo. /seguir para reanudar.');
  case '/seguir':await deps.equipo(['resume']);return void await send('Equipo en marcha otra vez.');
  case '/nueva':await voice.control('clear');return void await send('Conversación nueva. Lo anterior sigue guardado en el Mac.');
  case '/a':{
   const [dept,...words]=rest,para=DEPTS[(dept||'').toLowerCase()],texto=words.join(' ').trim().slice(0,1200);
   if(!para||!texto)return void await send('Escribe: /a <departamento> <mensaje>. Departamentos: '+Object.keys(DEPTS).join(', ')+'.');
   await deps.equipo(['mensaje',para,'--texto',texto]);return void await send('Enviado. Te responden en el siguiente ciclo, en menos de cinco minutos.');
  }
 }
 if(cmd.startsWith('/')&&!arg&&cmd.length<20)return void await send('No conozco esa orden.\n\n'+HELP);
 await alfred(text);
}

async function onCallback(q:any){
 const answer=(text?:string)=>call('answerCallbackQuery',{callback_query_id:q.id,...(text?{text}:{})}).catch(()=>{});
 if(!link||q.from?.id!==link.userId||q.message?.chat?.id!==link.chatId)return void await answer();
 const data=String(q.data||'');
 const perm=data.match(/^p:([A-Za-z0-9-]{4,40}):([01])$/);
 if(perm){const ok=voice.answer(perm[1],perm[2]==='1');return void await answer(ok?undefined:'Esa petición ya no está abierta.');}
 if(data==='r:s'){await answer();return void await startReview(q.message.message_id);}
 const rv=data.match(/^r:(v|g):([0-9a-f]{8})(?::([012]))?$/);
 if(rv){
  const cards=repaso.load(deps.dataDir),c=cards.find(x=>x.id===rv[2]),edit=(text:string,markup?:any)=>call('editMessageText',{chat_id:link!.chatId,message_id:q.message.message_id,text,...(markup?{reply_markup:markup}:{})}).catch(()=>{});
  if(!c)return void await answer('Esa tarjeta ya no existe.');
  if(!review||!review.ids.includes(c.id))review={ids:[c.id,...repaso.due(cards,new Date()).map(x=>x.id).filter(id=>id!==c.id)],i:0,right:0};
  const n=review.i+1,total=review.ids.length;
  if(rv[1]==='v'){await answer();return void await edit(repaso.answer(c,n,total),repaso.gradeButtons(c));}
  const g=Number(rv[3]) as 0|1|2;repaso.grade(c,g,new Date());repaso.save(deps.dataDir,cards);repaso.logAnswer(deps.dataDir,c.id,g,new Date());await answer(g===2?'Bien':g===1?'Vuelve antes':'Mañana otra vez');
  if(g===2)review.right++;review.i++;
  const next=cards.find(x=>x.id===review!.ids[review!.i]);
  if(!next){const t=repaso.summary(review.right,total,cards,new Date());review=null;return void await edit(t);}
  return void await edit(repaso.question(next,review.i+1,total),repaso.showButton(next));
 }
 const tickMatch=data.match(/^h:(\d{4}-\d{2}-\d{2}):(\d{1,2})$/);
 if(tickMatch){const day=hoy.load(deps.dataDir,tickMatch[1]);if(!day)return void await answer('Esa lista ya no existe.');
  hoy.tick(day,Number(tickMatch[2]));if(!day.mensaje)day.mensaje=q.message.message_id;hoy.save(deps.dataDir,day);await answer('Hecho');
  const rid=day.items[Number(tickMatch[2])]?.rid;if(rid&&cal.available())void cal.complete(rid).catch(()=>{});
  await call('editMessageText',{chat_id:link.chatId,message_id:q.message.message_id,text:hoy.render(day),reply_markup:hoy.keyboard(day)}).catch(()=>{});return;}
 const grupo=grupoBoton(data);
 if(grupo){
  const mark=(text:string)=>call('editMessageReplyMarkup',{chat_id:link!.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text,callback_data:'x'}]]}}).catch(()=>{});
  let s:any;try{s=await team();}catch{return void await answer('No he podido mirar el equipo. Míralo en Entregas.');}
  const g=(s.para_ti||[]).find((x:any)=>x.id===grupo.id);
  if(!g)return void await answer('Esto ya ha cambiado. Pide /lote otra vez.');
  if(grupo.accion==='l'){await answer('Para luego');return void await mark(etiquetaAccion(g.tipo,'l'));}
  if(grupo.accion==='r'){const qid=String(g.claves[0]||'').split(':')[1],m=(s.mesa?.mensajes||[]).find((x:any)=>x.id===qid);
   if(!m)return void await answer('Esa pregunta ya no está en la mesa de hoy.');
   await answer();return void await send(pedirRespuesta(qid,s.mesa?.departamentos?.[m.de]||m.de),{reply_markup:{force_reply:true}});}
  if(grupo.accion==='m'){const tid=String(g.claves[0]||'').split(':')[1],it=(s.tablero||[]).find((x:any)=>x.id===tid);
   if(!it)return void await answer('Ese experimento ya no está pendiente de medir.');
   await answer();const m=await send(preguntaMedido(it.titulo),{reply_markup:{force_reply:true}});
   if(m){for(const [id,a] of measureAsks)if(a.tarea===it.id)measureAsks.delete(id);measureAsks.set(m.message_id,{project:it.proyecto,tarea:it.id,titulo:it.titulo});}
   return;}
  const orders=ordenesGrupo(g,grupo.accion,s.mesa);
  if(!orders.length)return void await answer('No hay nada que hacer con eso.');
  try{for(const o of orders)await deps.equipo(o);await answer('Hecho');await mark(etiquetaAccion(g.tipo,grupo.accion));}
  catch{await answer('No se ha podido del todo. Míralo en Entregas.');}
  return;
 }
 const decided=decidirBoton(data);
 if(decided){
  try{const out=JSON.parse(await deps.equipo(decided.args)),r=String(out?.resultado||'');await answer(r==='aprobada'?'Aprobada':r==='descartada'?'Descartada':r==='pospuesta'?'Para luego':r||'Hecho');
   await call('editMessageReplyMarkup',{chat_id:link.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text:/^(aprobada|descartada|pospuesta)$/.test(r)?decided.label:r||decided.label,callback_data:'x'}]]}}).catch(()=>{});
  }catch{await answer('No se ha podido. Míralo en Entregas.');}
  return;
 }
 const asked=preguntaBoton(data);
 if(asked){
  const mark=(text:string)=>call('editMessageReplyMarkup',{chat_id:link!.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text,callback_data:'x'}]]}}).catch(()=>{});
  if(asked.accion==='l'){await answer('Para luego');return void await mark('⏸ Más tarde');}
  let qm:any;try{const s=await team();qm=(s.mesa?.mensajes||[]).find((x:any)=>x.id===asked.id);if(qm)qm.quien=s.mesa?.departamentos?.[qm.de]||qm.de;}catch{}
  if(!qm)return void await answer('Esa pregunta ya no está en la mesa de hoy.');
  if(asked.accion==='r'){await answer();return void await send(pedirRespuesta(asked.id,qm.quien),{reply_markup:{force_reply:true}});}
  try{await deps.equipo(['mensaje',qm.de,'--texto',asked.accion==='s'?'Sí':'No','--responde-a',asked.id]);await answer('Enviado');await mark(asked.accion==='s'?'✓ Sí':'✕ No');}
  catch{await answer('No se ha podido enviar. Míralo en Entregas.');}
  return;
 }
 const measured=medidoBoton(data);
 if(measured){
  let it:any;
  try{it=experimentosPendientes((await team()).tablero).faltaMedir.find((x:any)=>x.id===measured);}
  catch{return void await answer('No he podido mirar el equipo. Míralo en Entregas.');}
  if(!it)return void await answer('Ese experimento ya no está pendiente de medir.');
  await answer();
  const m=await send(preguntaMedido(it.titulo),{reply_markup:{force_reply:true}});
  if(m){
   for(const [id,a] of measureAsks)if(a.tarea===it.id)measureAsks.delete(id);
   measureAsks.set(m.message_id,{project:it.proyecto,tarea:it.id,titulo:it.titulo});
  }
  return;
 }
 const chosen=decisionExperimentoBoton(data);
 if(chosen){
  try{await deps.equipo(chosen);await answer('Apuntado');
   const decision=chosen[3];
   await call('editMessageReplyMarkup',{chat_id:link.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text:'✓ '+decision[0].toUpperCase()+decision.slice(1),callback_data:'x'}]]}}).catch(()=>{});
  }catch{await answer('No se ha podido apuntar. Míralo en Entregas.');}
  return;
 }
 const notLaunched=noLanzoBoton(data);
 if(notLaunched){
  let it:any;
  try{it=experimentosPendientes((await team()).tablero).porLanzar.find((x:any)=>x.id===notLaunched);}
  catch{return void await answer('No he podido mirar el equipo. Míralo en Entregas.');}
  if(!it)return void await answer('Ese experimento ya no está pendiente de lanzar.');
  await answer();
  return void await send(preguntaFreno(it.titulo),{reply_markup:{force_reply:true}});
 }
 const launched=lanzadoBoton(data);
 if(launched){
  try{await deps.equipo(launched.args);await answer('Apuntado');
   await call('editMessageReplyMarkup',{chat_id:link.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text:'✓ Lanzado',callback_data:'x'}]]}}).catch(()=>{});
  }catch{await answer('No se ha podido apuntar. Míralo en Entregas.');}
  return;
 }
 const approve=data.match(/^a:(.+)$/);
 if(approve&&PROJECT.test(approve[1])){
  try{await deps.equipo(['approve',approve[1]]);await answer('Aprobado');
   await call('editMessageReplyMarkup',{chat_id:link.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text:'✓ Aprobado',callback_data:'x'}]]}}).catch(()=>{});
  }catch{await answer('No se ha podido aprobar. Míralo en Entregas.');}
  return;
 }
 const merge=fusionarBoton(data);
 if(merge){
  const mark=(text:string)=>call('editMessageReplyMarkup',{chat_id:link!.chatId,message_id:q.message.message_id,reply_markup:{inline_keyboard:[[{text,callback_data:'x'}]]}}).catch(()=>{});
  await answer('Fusionando…');await mark('⏳ Fusionando…');
  try{const out=JSON.parse(await deps.equipo(['fusionar',merge],15*60000)),r=String(out?.[merge]||'sin respuesta');
   const done=r.startsWith('fusionada');await mark(done?'✓ Fusionado':'✕ Sin fusionar');await send((done?'Hecho: ':'No se ha fusionado: ')+r);
  }catch{await mark('✕ Sin fusionar');await send('No he podido fusionar. Míralo en Entregas.');}
  return;
 }
 await answer();
}

async function loop(){
 while(!stopped){
  if(!token){
   token=await keychain();
   if(!token){await sleep(30000);continue;}
   try{bot=(await call('getMe',{})).username||'';lastError='';
    await call('setMyCommands',{commands:[['hoy','Tu to-do de hoy'],['repaso','Repasar lo que estás aprendiendo'],['equipo','Qué hace el equipo ahora'],['lote','Aprobar el lote del día'],['mesa','Lo que te ha escrito el equipo'],['hermes','Tableros y tareas de Hermes'],['pausa','Pausar el equipo'],['seguir','Reanudar el equipo'],['nueva','Conversación nueva'],['ayuda','Qué puedo hacer']].map(([command,description])=>({command,description}))}).catch(()=>{});
   }catch(e){lastError=clean(e);token=null;await sleep(60000);continue;}
  }
  try{
   const updates=await call('getUpdates',{offset,timeout:50,allowed_updates:['message','callback_query']},65000);
   lastError='';
   for(const u of updates){
    offset=u.update_id+1;
    // Messages one at a time and in order; button taps right away (a permission tap answers the message in flight).
    if(u.callback_query)void onCallback(u.callback_query).catch(()=>{});
    else if(u.message)chain=chain.then(()=>onMessage(u.message)).catch(()=>{});
   }
  }catch(e){
   if(stopped)break;lastError=clean(e);
   if(/Unauthorized|Not Found/i.test(lastError)){token=null;}
   await sleep(/Conflict/i.test(lastError)?20000:5000);
  }
 }
}

export function start(d:Deps){
 deps=d;newCode();
 try{const saved=JSON.parse(fs.readFileSync(linkFile(),'utf8'));if(Number.isInteger(saved.chatId)&&Number.isInteger(saved.userId))link=saved;}catch{}
 void loop();
 morning=setInterval(()=>{morningCheck();if(++ticks%2===0)calendarSync();},60_000);
 // ask macOS for Calendar and Reminders access while the owner is at the Mac (opening the app), not at nine
 if(cal.available())void cal.permission().catch(()=>{});
 // a list the team's service sent while the app was closed: its tasks go to Reminders now
 setTimeout(()=>{if(today()?.items.some(i=>!i.rid&&!i.hecho))pushReminders();calendarSync();},8000);
}
/** For telegram-checks: run the Reminders sync now instead of waiting for the two-minute tick. */
export async function syncNow(){calendarSync();await chain;}
export function stop(){stopped=true;if(morning)clearInterval(morning);}
