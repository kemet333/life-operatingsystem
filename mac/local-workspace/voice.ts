// Alfred's voice brain: one warm Claude session (Agent SDK) for the whole app run.
// Replies stream sentence by sentence so the Mac starts speaking while the rest of
// the thought is still forming. Anything that acts on the machine asks the owner first.
import {ruta,rutas} from './config';
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {projects,divisions} from '../../alfred-os/lib/alfred-data';
import {note} from './tts';
import * as profile from './profile';

export type VoiceEvent =
 |{t:'state';v:'thinking'|'tool'}
 |{t:'step';text:string}
 |{t:'model';model:string;deep:boolean}
 |{t:'say';text:string;directions:string[];raw:string}   // raw: Alfred's text as written (Telegram), text: cleaned for the voice
 |{t:'permission';id:string;what:string;detail:string}
 |{t:'permission-closed';id:string;allowed:boolean}
 |{t:'usage';usage:Usage}
 |{t:'done';text:string}
 |{t:'error';message:string};
export type Usage={status:string;fiveHour?:number;sevenDay?:number;resetsAt?:number};
type Emit=(e:VoiceEvent)=>void;
export type Turn={id:string;emit:Emit;buffer:string;spoken:string;done:(text:string)=>void;urls:string[]};
type Pending={resolve:(allow:boolean,reason?:string)=>void;timer:ReturnType<typeof setTimeout>};

// Where Alfred works and what else it may read (configuracion.json → alfred); by default the app's data folder only.
const AGENT_HOME=ruta('alfred.carpeta','LIFE_OS_ALFRED_HOME',process.env.LIFE_OS_DATA_DIR||homedir());
const READABLE=rutas('alfred.puedeLeer');
const SONNET='claude-sonnet-5-5',OPUS='claude-opus-5-5';
// Same ledger as the team engine, so one file shows what every model cost that day.
const LEDGER=ruta('equipo.consumo','LIFE_OS_CONSUMO_DIR',join(process.env.LIFE_OS_DATA_DIR||homedir(),'consumo'));
// Most of what the owner says out loud is quick and Sonnet answers it well. Thinking work goes to Opus.
const HEAVY=/\b(analiz|revis|audit|planific|estrategi|compar|disen|arquitectur|codigo|program|depur|investig|por que|evalu|prioriz|redact|propuesta|decid|decision|piensa|razona|a fondo|en detalle)/;
type Pick={model:string;effort:'low'|'high'};
const ANSWER_WINDOW_MS=75_000;
// Reading never needs a spoken yes; anything that writes, runs or reaches out still does.
const READ_ONLY=['Read','Glob','Grep','WebSearch','TodoWrite',...['ls','cat','head','tail','wc','find','grep','rg','git log','git status','git diff','git show','sqlite3 -readonly'].map(c=>`Bash(${c}:*)`)];

// Alfred's standing instructions: the generic core is here; everything about the person (who they are, goals, rules,
// their projects and team) comes from their private profile in the data folder (profile.ts), never from the code.
export const discipline=()=>{const p=profile.load();return `SESIÓN DE VOZ. Eres Alfred, el asistente personal de ${p.name} dentro de ${p.app}. Eres su mentor, no un simple ejecutor. Lo que escribes se lee en voz alta con una voz masculina en castellano, no se muestra como texto.
Tu registro es el de un mayordomo de inteligencia artificial al estilo Jarvis: sereno, elegante y preciso, con un humor seco y sutil, nunca servil ni exagerado. Español de España, frases cortas y naturales. Responde en dos o tres frases salvo que la pregunta pida más.
Nada de markdown, listas, emojis, código ni URLs. Di los números como se dicen en voz alta. NUNCA leas una ruta de archivo ni un identificador largo: nombra la cosa ("la ficha del proyecto", "el CLAUDE punto md"), no su dirección.
Puedes mover la interfaz mientras hablas con indicaciones entre dobles ángulos, que no se leen: <<vista:alfred>>, <<vista:equipo>>, <<vista:proyectos>>, <<vista:entregas>>, <<vista:memoria>>, <<vista:contenido>> (calendario de publicaciones, perfiles y tendencias), <<area:${divisions.map(d=>d.id).join('|')}>> y <<proyecto:ID>>. Ponlas justo antes de la frase a la que acompañan. IDs de proyecto: ${projects.map(p=>p.id+' ('+p.name+')').join(', ')}.
Consola de voz, la gestiona la app con frases exactas: "modo profundo", "modo rápido", "nueva conversación", "informe de uso". Si te preguntan cómo cambiar algo de eso, di la frase exacta.
Modelos, para ahorrar uso del plan: la app elige uno por turno. Sonnet cinco punto cinco para lo corriente; Opus cinco punto cinco para analizar, revisar, planificar, decidir o con "modo profundo"; ${p.name} puede forzarlo diciendo "con Opus" o "con Sonnet".${p.instructions?`
Lo que ${p.name} te ha dejado escrito sobre sí mismo, sus objetivos y cómo quiere que trabajes (instrucciones suyas, por encima de las generales cuando choquen):
${p.instructions}`:''}`;};

let session:{q:any;push:(text:string)=>void;close:()=>void}|null=null;
let starting:Promise<void>|null=null;
let turn:Turn|null=null;
// An interrupted turn still reports its own result; skip it (and its late deltas) so it never closes the next turn.
let stale=0;
let deep=false;
let active:Pick={model:SONNET,effort:'low'};
let spent=0;
let usage:Usage|null=null;
const pending=new Map<string,Pending>();

export function status(){return {available:true,deep,usage,warm:!!session,model:active.model};}

// One model per turn: «modo profundo», an explicit «con Opus», a long message or thinking work → Opus high;
// everything else (and an explicit «con Sonnet») → Sonnet low, which answers in voice time.
export function route(text:string):Pick{
 // A leading [note] (the Telegram preamble) is context, not the request.
 const t=text.replace(/^\[[^\]]*\]\s*/,'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(/\b(con|usa|usando) sonnet\b/.test(t))return {model:SONNET,effort:'low'};
 if(deep||/\b(con|usa|usando) opus\b/.test(t)||t.length>600||HEAVY.test(t))return {model:OPUS,effort:'high'};
 return {model:SONNET,effort:'low'};
}

function record(m:any){
 const total=typeof m.total_cost_usd==='number'?m.total_cost_usd:null;
 const cost=total===null?null:Math.max(0,total-spent);if(total!==null)spent=total;
 const d=new Date(),pad=(n:number)=>String(n).padStart(2,'0'),day=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 const line={hora:`${day}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,rol:'alfred',modelo:active.model,esfuerzo:active.effort,coste_usd:cost===null?null:Math.round(cost*1e6)/1e6};
 try{mkdirSync(LEDGER,{recursive:true});appendFileSync(join(LEDGER,day+'.jsonl'),JSON.stringify(line)+'\n');}catch{}
}

function describe(tool:string,input:Record<string,any>,title?:string):{what:string;detail:string}{
 const file=(p:unknown)=>typeof p==='string'?p.split('/').filter(Boolean).slice(-2).join(' / '):'un archivo';
 const detail=tool==='Bash'?String(input.command||''):JSON.stringify(input,null,1).slice(0,1200);
 if(tool==='Write')return {what:'crear o reescribir '+file(input.file_path),detail};
 if(tool==='Edit'||tool==='MultiEdit'||tool==='NotebookEdit')return {what:'cambiar '+file(input.file_path||input.notebook_path),detail};
 if(tool==='Bash')return {what:'ejecutar un comando'+(input.description?': '+String(input.description).toLowerCase():''),detail};
 if(tool==='WebFetch')return {what:'abrir una página web',detail:String(input.url||'')};
 return {what:title||'usar la herramienta '+tool,detail};
}

/** The links in a message, without trailing punctuation. Exported for the checks. */
export const linksIn=(text:string)=>(text.match(/https?:\/\/[^\s<>"'«»]+/g)||[]).map(u=>u.replace(/[).,;:!?]+$/,''));
const sentByOwner=(t:Turn,url:string)=>{const u=url.replace(/\/+$/,'');return !!u&&t.urls.some(x=>x.replace(/\/+$/,'')===u);};

async function canUseTool(tool:string,input:Record<string,any>,options:{signal:AbortSignal;title?:string}){
 const current=turn;
 if(!current)return {behavior:'deny' as const,message:`No hay ninguna conversación activa con ${profile.load().name}.`};
 // A link the owner himself sent in this message is read without asking; any other page still needs his yes
 // (a page Alfred reads must not be able to send him off to fetch others).
 if(tool==='WebFetch'&&sentByOwner(current,String(input.url||'')))return {behavior:'allow' as const,updatedInput:input};
 const id='perm-'+Math.random().toString(36).slice(2,10),{what,detail}=describe(tool,input,options.title);
 return new Promise<{behavior:'allow';updatedInput:Record<string,any>}|{behavior:'deny';message:string}>(resolve=>{
  const finish=(allow:boolean,reason?:string)=>{
   const entry=pending.get(id);if(!entry)return;clearTimeout(entry.timer);pending.delete(id);
   current.emit({t:'permission-closed',id,allowed:allow});
   resolve(allow?{behavior:'allow',updatedInput:input}:{behavior:'deny',message:reason?`${profile.load().name} ha dicho que no: "${reason}". Ajusta el plan a lo que pide.`:`${profile.load().name} no lo ha autorizado.`});
  };
  pending.set(id,{resolve:finish,timer:setTimeout(()=>finish(false,'sin respuesta a tiempo'),ANSWER_WINDOW_MS)});
  options.signal.addEventListener('abort',()=>finish(false),{once:true});
  current.emit({t:'permission',id,what,detail});
 });
}

export function answer(id:string,allow:boolean,reason?:string){const entry=pending.get(id);if(!entry)return false;entry.resolve(allow,reason);return true;}

// Lift <<directions>> out and speak only complete sentences; an unclosed << waits for more text.
export function drain(current:Turn,final=false){
 let text=current.buffer;
 const open=text.lastIndexOf('<<');
 const safeEnd=!final&&open>text.lastIndexOf('>>')?open:text.length;
 let head=text.slice(0,safeEnd);const tail=text.slice(safeEnd);
 let cut=-1;
 if(final)cut=head.length;
 else{const re=/[.!?…](?=\s)|\n/g;let m;while((m=re.exec(head)))cut=m.index+1;}
 if(cut<=0){return;}
 const piece=head.slice(0,cut);current.buffer=head.slice(cut)+tail;
 const directions:string[]=[];
 const spoken=piece.replace(/<<\s*([a-z]+:[a-z0-9_-]+)\s*>>/gi,(_,d)=>{directions.push(d.toLowerCase());return ' ';})
  .replace(/<<[^>]*>>/g,' ').replace(/https?:\/\/\S+/g,'').replace(/[*_#`>|]/g,'').replace(/^\s*[-•]\s+/gm,'').replace(/\s+/g,' ').trim();
 // Telegram reads the text as written (lists, links and its own <<hoy:…>>/<<repaso:…>> directives intact); only the
 // interface directions are lifted. The voice gets the cleaned sentence.
 const raw=piece.replace(/<<\s*[a-z]+:[a-z0-9_-]+\s*>>/gi,'');
 if(spoken||directions.length||raw.trim()){current.spoken+=(current.spoken?' ':'')+spoken;current.emit({t:'say',text:spoken,directions,raw});}
}

// A file inside the configured notes vault.
const VAULT_DIR=ruta('vault','LIFE_OS_VAULT_DIR');
const inVault=(file:string)=>!!VAULT_DIR&&file.startsWith(VAULT_DIR.replace(/\/+$/,'')+'/');
// One short, honest line per tool call, in the owner's words. Never the raw command: that stays in the permission detail.
export function stepText(name:string,input:any):string{
 const file=String(input?.file_path||input?.path||''),cmd=String(input?.command||''),base=file.split('/').pop()?.replace(/\.md$/,'')||'';
 if(name==='Read'){if(inVault(file))return `Leyendo tu nota «${base}»`;if(/projects\.json$/.test(file))return 'Leyendo los proyectos del equipo';if(/Administración/.test(file))return 'Leyendo tu administración';return base?`Leyendo ${base}`:'Leyendo un archivo';}
 if(name==='Bash'){
  if(/equipo\.py\s+status/.test(cmd))return 'Mirando el tablero del equipo';
  if(/equipo\.py\s+encargar/.test(cmd))return 'Preparando el encargo para el equipo';
  if(/equipo\.py\s+(resultado|lanzado)/.test(cmd))return 'Apuntando el resultado del experimento';
  if(/equipo\.py\s+mensaje/.test(cmd))return 'Escribiendo al equipo';
  if(/\bgit\s+(log|show|diff)/.test(cmd))return 'Revisando los últimos cambios';
  if(/\b(ls|find|cat|head|tail|wc)\b/.test(cmd))return 'Mirando los archivos';
  // Otherwise Alfred's own one-line description of the command (the same words the permission card shows).
  const said=String(input?.description||'').trim().replace(/\.$/,'');
  return said&&said.length<=90?said[0].toUpperCase()+said.slice(1):'Haciendo una comprobación';}
 if(name==='Grep'||name==='Glob')return 'Buscando en tus archivos';
 if(name==='WebSearch')return input?.query?`Buscando en la web: ${String(input.query).slice(0,60)}`:'Buscando en la web';
 if(name==='WebFetch')return 'Leyendo una página web';
 if(name==='Write'||name==='Edit')return inVault(file)?`Escribiendo en tu nota «${base}»`:'Escribiendo un archivo';
 if(name==='TodoWrite')return 'Ordenando los pasos';
 return '';
}

function explain(raw:string){
 if(/not logged in|\/login|authentication|oauth/i.test(raw))return 'No puedo pensar ahora: Claude no tiene la sesión iniciada en este Mac. Hay que volver a iniciar sesión en Claude Code.';
 if(/limit|usage|quota|rate/i.test(raw))return 'He llegado al límite de uso de Claude. Vuelve a intentarlo cuando se renueve.';
 return 'No he podido terminar la respuesta. Claude ha dado un error: '+raw.slice(0,160);
}

async function start(){
 const {query}=await import('@anthropic-ai/claude-agent-sdk');
 const inbox:any[]=[];let wake:(()=>void)|null=null,closed=false;
 async function* input(){while(!closed){if(inbox.length){yield inbox.shift();continue;}await new Promise<void>(r=>wake=r);wake=null;}}
 const q=query({prompt:input(),options:{
  model:active.model,effort:active.effort,fallbackModel:active.model===OPUS?SONNET:OPUS,cwd:AGENT_HOME,additionalDirectories:READABLE,settingSources:['project'],strictMcpConfig:true,
  includePartialMessages:true,permissionMode:'default',canUseTool,allowedTools:READ_ONLY,
  systemPrompt:{type:'preset',preset:'claude_code',append:discipline()},stderr:()=>{},
 }});
 session={q,push:text=>{inbox.push({type:'user',message:{role:'user',content:text},parent_tool_use_id:null});wake?.();},close:()=>{closed=true;wake?.();try{q.close();}catch{}}};
 (async()=>{
  try{
   for await(const m of q){
    if(m.type==='rate_limit_event'){
     // unifiedWindows arrives at runtime but is not in the published types; fall back to the documented fields.
     const info:any=m.rate_limit_info,w=info?.unifiedWindows||{},own=(k:string)=>info?.rateLimitType===k?info.utilization:undefined;
     usage={status:info?.status,fiveHour:w.five_hour?.utilization??own('five_hour'),sevenDay:w.seven_day?.utilization??own('seven_day'),resetsAt:w.five_hour?.resetsAt??info?.resetsAt};turn?.emit({t:'usage',usage});
     // The team's health check reads it (equipo.py check_uso): plan usage seen from the Mac, with its time.
     if(process.env.LIFE_OS_DATA_DIR)try{writeFileSync(join(process.env.LIFE_OS_DATA_DIR,'uso.json'),JSON.stringify({...usage,hora:new Date().toISOString()}));}catch{}
     continue;}
    if(m.type==='result')record(m);
    if(stale>0){if(m.type==='result')stale--;continue;}
    const current=turn;if(!current)continue;
    // Visible steps: each tool Alfred uses becomes one plain line on screen ("Mirando el tablero del equipo…").
    if(m.type==='assistant'&&m.parent_tool_use_id===null){for(const b of (m.message?.content||[]) as any[])if(b?.type==='tool_use'){const text=stepText(b.name,b.input||{});if(text)current.emit({t:'step',text});}continue;}
    if(m.type==='stream_event'&&m.parent_tool_use_id===null){
     const e=m.event;
     if(e.type==='content_block_delta'&&e.delta?.type==='text_delta'){current.buffer+=e.delta.text;drain(current);}
     else if(e.type==='content_block_start'&&e.content_block?.type==='tool_use'){drain(current,true);current.emit({t:'state',v:'tool'});}
     continue;
    }
    if(m.type==='result'){drain(current,true);turn=null;
     // An error before any word (no login, usage limit) must be said out loud, not met with silence.
     if((m.is_error||m.subtype!=='success')&&!current.spoken){const why=explain(String(m.result||m.subtype||''));note('cerebro: '+String(m.result||m.subtype).slice(0,160));current.emit({t:'error',message:why});current.done(why);}
     else current.done(current.spoken);}
   }
  }catch(e){turn?.emit({t:'error',message:'La sesión de Alfred se ha cortado. Vuelve a hablarme y la reabro.'});turn?.done('');turn=null;}
  finally{session=null;stale=0;spent=0;for(const p of pending.values())p.resolve(false);}
 })();
}

async function ensure(){if(session)return;if(!starting)starting=start().finally(()=>{starting=null;});await starting;}
export async function warm(){try{await ensure();}catch{}}

export async function speak(id:string,text:string,emit:Emit):Promise<string>{
 const want=route(text);
 if(!session)active=want;
 await ensure();
 if(turn)await interrupt();
 if(want.model!==active.model||want.effort!==active.effort){
  try{if(want.model!==active.model)await session!.q.setModel(want.model);if(want.effort!==active.effort)await session!.q.applyFlagSettings({effortLevel:want.effort});active=want;}catch{}
 }
 return new Promise<string>(resolve=>{
  turn={id,emit,buffer:'',spoken:'',done:resolve,urls:linksIn(text)};
  emit({t:'state',v:'thinking'});emit({t:'model',model:active.model,deep});if(usage)emit({t:'usage',usage});
  session!.push(text);
 });
}

export const busy=()=>!!turn;

export async function interrupt(){
 const current=turn;if(!current)return;
 for(const p of pending.values())p.resolve(false,'Se ha interrumpido la conversación');
 turn=null;stale++;current.done(current.spoken);
 try{await session?.q.interrupt();}catch{stale=Math.max(0,stale-1);}
}

export async function control(action:string){
 if(action==='interrupt'){await interrupt();return status();}
 if(action==='clear'){await interrupt();session?.close();session=null;return status();}
 if(action==='deep'||action==='fast'){deep=action==='deep';return status();}
 if(action==='warm'){void warm();return status();}
 throw Error('Acción de voz no disponible.');
}

export function shutdown(){for(const p of pending.values())p.resolve(false);session?.close();session=null;}
