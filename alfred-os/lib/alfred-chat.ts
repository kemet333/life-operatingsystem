import {env} from 'cloudflare:workers';
import {state,operate,write} from './alfred-store';
import {projects,divisions,aliases} from './alfred-data';
import {ENTRY_TITLE_MAX,ENTRY_BODY_MAX} from './office-limits';
export type ChatMessage={id:string;author:'user'|'assistant';text:string;at:number;source?:string;requestId?:string;runId?:string;actions?:ChatAction[]};
export type ChatAction={type:'division'|'project'|'activity'|'request';id?:string;title?:string;body?:string;project?:string};
const clean=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[¿?!.]/g,'').trim();
function projectFrom(text:string){return projects.find(p=>(aliases[p.id]||[p.name.toLowerCase()]).some(a=>new RegExp('(?:^|[^a-z0-9])'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])').test(text)));}
async function message(m:ChatMessage){await write('message:'+m.id+':'+m.author,m);}
export async function chat(input:any){
 if(!env.DB)throw new Error('El almacenamiento no está disponible.');
 const db=env.DB;
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)throw new Error('Escribe una petición de hasta 4000 caracteres.');
 if(typeof input.id!=='string'||!/^[-a-f0-9]{36}$/i.test(input.id))throw new Error('Identificador de mensaje inválido.');
 const id=input.id,text=input.text.trim(),now=Date.now(),attempt=crypto.randomUUID();
 const gate=JSON.stringify({status:'processing',at:now,text,attempt});
 const user:ChatMessage={id,author:'user',text,at:now};
 const claim=await db.batch([
  db.prepare('INSERT OR IGNORE INTO office(id,value,updated_at) VALUES (?,?,?)').bind('turn:'+id,gate,now),
  db.prepare("UPDATE office SET value=?,updated_at=? WHERE id=? AND (json_extract(value,'$.text') IS NULL OR json_extract(value,'$.text')=?) AND (json_extract(value,'$.status')='failed' OR (json_extract(value,'$.status')='processing' AND updated_at<?))").bind(gate,now,'turn:'+id,text,now-60000),
  db.prepare("INSERT OR IGNORE INTO office(id,value,updated_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM office WHERE id=? AND json_extract(value,'$.attempt')=?)").bind('message:'+id+':user',JSON.stringify(user),now,'turn:'+id,attempt)
 ]);
 if(!claim[0].meta.changes&&!claim[1].meta.changes){const row=await db.prepare('SELECT value FROM office WHERE id=?').bind('turn:'+id).first<{value:string}>();const old=row?JSON.parse(row.value):{};if(old.text&&old.text!==text)throw new Error('Este mensaje ya tiene otro contenido.');return {ok:true,duplicate:true,action:old.action,requestId:old.requestId};}
 async function finish(value:any){await db.prepare("UPDATE office SET value=?,updated_at=? WHERE id=? AND json_extract(value,'$.attempt')=?").bind(JSON.stringify({...value,text,attempt}),Date.now(),'turn:'+id,attempt).run();}
 try{
 const office=await state(),normalized=clean(text).replace(/^alfred[, :]*/, ''),p=projectFrom(normalized);
 let reply='',action:ChatAction|undefined;
 const nav=/^(alfred[, :]*)?(muestra(me)?|abre|ver|lleva(me)? a|ensena(me)?)( el| la| los| las)?\s+/;
 if(nav.test(normalized)){
  // An area by its name or short name, as the person says it.
  const area=divisions.find(d=>[d.name,d.short].some(n=>n&&normalized.includes(clean(n))));
  if(p){reply=`Aquí tienes ${p.name}. ${p.next}`;action={type:'project',id:p.id};}
  else if(area){reply=`Abro ${area.name}.`;action={type:'division',id:area.id};}
 }
 const capture=text.match(/^(?:alfred[, :]*\s*)?(?:guarda|guardar|anota|captura)(?:\s+(?:esta|una|mi))?\s+idea\s*[:\-]?\s+([\s\S]+)$/i);
 if(!reply&&capture){
  await db.prepare("INSERT OR IGNORE INTO entries(id,kind,project,title,body,status,role,created_at,updated_at) VALUES (?,'idea',?,?,?,'inbox','alfred',?,?)").bind('idea-'+id,p?.id||'alfred',capture[1].slice(0,ENTRY_TITLE_MAX),capture[1],now,now).run();
  reply='Idea guardada en tu bandeja. El foco sigue igual.';
 }
 const focusMatch=normalized.match(/^(?:prioriza|cambia (?:el )?foco a|pon (?:el )?foco en|centrate en|mi foco es) (.+)$/);
 const focusProject=focusMatch?projects.find(p=>(aliases[p.id]||[p.name.toLowerCase()]).some(a=>a===focusMatch[1].trim())):null;
 if(!reply&&focusProject){
  await operate({action:'settings',focus:focusProject.id,text:focusProject.next});reply=`Tu foco ahora es ${focusProject.name}. El siguiente paso es: ${focusProject.next}`;action={type:'project',id:focusProject.id};
 }
 if(!reply&&/^(tengo poca energia|modo poca energia|activa (el )?modo poca energia|poca energia)$/.test(normalized)){
  await operate({action:'settings',energy:'low'});reply='Bajamos el ritmo. Elige una sola decisión de cinco minutos; las demás ideas se quedan guardadas.';
 }
 if(!reply&&/^(estado|resumen|como vamos|que tengo pendiente|que esta bloqueado|muestra(me)? (las )?entregas|mis entregas)$/.test(normalized)){
  const tasks=(office.snapshot?.boards||[]).flatMap((b:any)=>b.tasks.map((t:any)=>({...t,board:b.name}))),blocked=tasks.filter((t:any)=>t.status==='blocked'),ready=office.entries.filter((e:any)=>e.kind==='request'&&e.status==='review');
  const stamp=office.snapshot?new Date(office.snapshot.observedAt).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):null;
  reply=`El foco es ${projects.find(p=>p.id===office.settings.focus)?.name}. ${ready.length} entregas esperan revisión.`;
  if(normalized.includes('bloqueado'))reply+=blocked.length?` Bloqueadas en la última lectura: ${blocked.slice(0,5).map((t:any)=>t.title).join('; ')}.`:' No aparecen tareas bloqueadas en la lectura disponible.';
  reply+=stamp?`\nFuente: lectura de Hermes del ${stamp}.`:'\nTodavía no hay una lectura del tablero.';action={type:'activity'};
 }
 if(!reply&&/^(hola( alfred)?|buenas( alfred)?|buenos dias|buenas noches)$/.test(normalized))reply=`Hola. Tu siguiente paso es: ${office.settings.action} Puedes pedirme contexto, abrir un área o guardar una idea.`;
 if(reply){await message({id,author:'assistant',text:reply,at:Math.max(Date.now(),now+1),source:'office'});await finish({status:'done',at:now,action});return {ok:true,action};}
 const requestId='chat-'+id;
 const payload=JSON.stringify({messageId:id,text,scope:'professional'});
 await db.prepare("INSERT OR IGNORE INTO entries(id,kind,project,title,body,status,role,created_at,updated_at) VALUES (?,?,?,?,?,'queued','alfred',?,?)").bind(requestId,'conversation','alfred',text.slice(0,120),payload,now,now).run();
 await finish({status:'done',at:now,requestId});
 return {ok:true,requestId};
 }catch(e){try{await finish({status:'failed',at:now});}catch{}throw e;}
}
export function chatResult(entry:any,result:string,status:string,external:string){
 const payload=JSON.parse(entry.body);
 let text=result,actions:ChatAction[]=[];
 if(status==='review'){
  try{
   const parsed=JSON.parse(result.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));
   if(typeof parsed.reply==='string')text=parsed.reply.slice(0,12000);
   if(Array.isArray(parsed.actions))actions=parsed.actions.filter((a:any)=>a?.type==='request'&&projects.some(p=>p.id===a.project)&&typeof a.title==='string'&&typeof a.body==='string').slice(0,3).map((a:any)=>({type:'request',project:a.project,title:a.title.slice(0,ENTRY_TITLE_MAX),body:a.body.slice(0,ENTRY_BODY_MAX)}));
  }catch{/* The genuine model response remains visible; never infer actions from prose. */}
 }
 return {id:payload.messageId,author:'assistant' as const,text,at:Date.now(),source:status==='review'?'codex':'office',requestId:entry.id,runId:external.startsWith('run/')?external.slice(4):undefined,actions};
}
