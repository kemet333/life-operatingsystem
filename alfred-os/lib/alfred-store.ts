import {env} from 'cloudflare:workers';
import type {FocusSession} from './focus';
import {projects,roles,divisions,brief,initialFocus} from './alfred-data';
import {REVISE_FEEDBACK_MAX,REQUEST_BODY_MAX,ENTRY_TITLE_MAX,ENTRY_BODY_MAX} from './office-limits';
function db(){if(!env.DB)throw new Error('El almacenamiento no está disponible.');return env.DB;}
function txt(v:unknown,max=ENTRY_BODY_MAX){if(typeof v!=='string')throw new Error('El texto no es válido.');return v.trim().slice(0,max);}
async function read(key:string){const r=await db().prepare('SELECT value FROM office WHERE id=?').bind(key).first<{value:string}>();return r?JSON.parse(r.value):null;}
export async function write(key:string,value:unknown){await db().prepare('INSERT INTO office(id,value,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),Date.now()).run();}
async function event(kind:string,title:string){await write('event:'+crypto.randomUUID(),{kind,title,at:Date.now()});}
export async function state(){
 const [entries,settings,snapshot,events,messages,focusSession,focusHistory,knowledge]=await Promise.all([
  db().prepare('SELECT * FROM entries ORDER BY created_at DESC LIMIT 250').all(),read('settings'),read('snapshot'),
  db().prepare("SELECT value FROM office WHERE id LIKE 'event:%' ORDER BY updated_at DESC LIMIT 30").all<{value:string}>(),
  db().prepare("SELECT value FROM office WHERE id LIKE 'message:%' ORDER BY updated_at DESC LIMIT 100").all<{value:string}>(),read('focus-session'),
  db().prepare("SELECT value FROM office WHERE id LIKE 'focus-completed:%' ORDER BY updated_at DESC LIMIT 30").all<{value:string}>(),
  db().prepare("SELECT id,value FROM office WHERE id LIKE 'knowledge:%'").all<{id:string;value:string}>()
 ]);
 return {focusSession,focusHistory:focusHistory.results.map(x=>JSON.parse(x.value)),knowledge:Object.fromEntries(knowledge.results.map(x=>[x.id.slice(10),JSON.parse(x.value)])),entries:entries.results,settings:settings||{...initialFocus,energy:'normal'},snapshot,history:events.results.map(x=>JSON.parse(x.value)),messages:messages.results.map(x=>JSON.parse(x.value)).sort((a,b)=>a.at-b.at),projects};
}
export async function operate(input:any,service=false){
 const action=input.action;
 if(action==='focus'){
  const old:FocusSession|null=await read('focus-session'),now=Date.now(),command=input.command;
  let next:FocusSession;
  if(command==='create'){
   if(old&&(old.id!==input.previousId||old.revision!==input.revision||old.status!=='completed'))throw new Error('Conservamos tu paso actual. Termínalo antes de preparar otro.');
   if(!projects.some(p=>p.id===input.project)||![5,10,15].includes(input.minutes))throw new Error('Paso inválido.');
   const title=txt(input.title,240),doneWhen=txt(input.doneWhen,400),id=txt(input.id,100);if(!title||!doneWhen||!id)throw new Error('Escribe el paso y cómo sabrás que está terminado.');
   next={id,project:input.project,title,doneWhen,minutes:input.minutes,status:input.start?'active':'ready',note:'',elapsed:0,startedAt:input.start?now:null,completedAt:null,updatedAt:now,revision:(old?.revision||0)+1};
  }else{
   if(!old||old.id!==input.id||old.revision!==input.revision)throw new Error('El paso cambió en otra ventana. Recarga antes de continuar.');
   next={...old,revision:old.revision+1,updatedAt:now};
   const elapsed=old.elapsed+(old.status==='active'&&old.startedAt?Math.max(0,now-old.startedAt):0);
   if(command==='start'&&['ready','paused'].includes(old.status)){next.status='active';next.startedAt=now;if(input.note!==undefined)next.note=txt(input.note,2000);}
   else if(command==='pause'&&old.status==='active'){next.status='paused';next.elapsed=elapsed;next.startedAt=null;next.note=txt(input.note||'',2000);}
   else if(command==='complete'&&['active','paused'].includes(old.status)){next.status='completed';next.elapsed=elapsed;next.startedAt=null;next.note=txt(input.note||'',2000);next.completedAt=now;}
   else if(command==='edit'&&['ready','paused'].includes(old.status)){if(input.note!==undefined)next.note=txt(input.note,2000);next.title=txt(input.title,240);next.doneWhen=txt(input.doneWhen,400);if(!next.title||!next.doneWhen)throw new Error('El paso y el criterio necesitan texto.');if(input.minutes!==undefined){if(![5,10,15].includes(input.minutes))throw new Error('Duración inválida.');next.minutes=input.minutes;}}
   else if(command==='note'&&['ready','paused','active'].includes(old.status)){next.note=txt(input.note||'',2000);}
   else throw new Error('Ese cambio no corresponde al estado actual del paso.');
  }
  const update=old?db().prepare("UPDATE office SET value=?,updated_at=? WHERE id='focus-session' AND json_extract(value,'$.revision')=?").bind(JSON.stringify(next),now,old.revision):db().prepare("INSERT OR IGNORE INTO office(id,value,updated_at) VALUES ('focus-session',?,?)").bind(JSON.stringify(next),now);
  const batch=[update];if(next.status==='completed')batch.push(db().prepare("INSERT INTO office(id,value,updated_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM office WHERE id='focus-session' AND json_extract(value,'$.revision')=? AND json_extract(value,'$.id')=? AND json_extract(value,'$.status')='completed' AND value=?) ON CONFLICT(id) DO NOTHING").bind('focus-completed:'+next.id,JSON.stringify({...next,basis:'user_report'}),now,next.revision,next.id,JSON.stringify(next)));
  const result=await db().batch(batch);if(!result[0].meta.changes)throw new Error('El paso ha cambiado. Recarga antes de continuar.');return {ok:true,session:next};
 }
 if(action==='knowledge'){
  if(!divisions.some(d=>d.id===input.division))throw new Error('Área inválida.');
  const key='knowledge:'+input.division,old=await read(key),revision=old?.revision||0;if(input.revision!==revision)throw new Error('La memoria cambió en otra ventana. Conserva tu texto y recarga antes de guardar.');
  const fields:Record<string,string>={};for(const field of ['goal','audience','offer','voice','constraints'])fields[field]=txt(input.fields?.[field]||'',2000);
  const now=Date.now(),value=JSON.stringify({...fields,revision:revision+1,updatedAt:now});
  const result=old?await db().prepare("UPDATE office SET value=?,updated_at=? WHERE id=? AND json_extract(value,'$.revision')=?").bind(value,now,key,revision).run():await db().prepare('INSERT OR IGNORE INTO office(id,value,updated_at) VALUES (?,?,?)').bind(key,value,now).run();
  if(!result.meta.changes)throw new Error('La memoria cambió. Conserva tu texto y recarga.');return {ok:true};
 }
 if(action==='prepare'){
  const e=await db().prepare('SELECT * FROM entries WHERE id=?').bind(txt(input.id,100)).first<any>();if(!e||e.kind!=='idea'||!['inbox','parked'].includes(e.status))throw new Error('Esta idea ya ha cambiado de estado.');
  const title=txt(input.title,ENTRY_TITLE_MAX),body=txt(input.body||'');if(!title||!body||!projects.some(p=>p.id===input.project)||!roles.some(r=>r.id===input.role))throw new Error('Completa el encargo y su responsable.');
  const r=await db().prepare("UPDATE entries SET kind='request',status='queued',title=?,body=?,project=?,role=?,updated_at=? WHERE id=? AND kind='idea' AND status=? AND updated_at=?").bind(title,body,input.project,input.role,Date.now(),e.id,e.status,e.updated_at).run();if(!r.meta.changes)throw new Error('La idea cambió mientras la guardabas.');return {ok:true,id:e.id};
 }
 if(action==='settings'){
  const fields:any[]=[];
  if(input.focus!==undefined){if(!projects.some(p=>p.id===input.focus))throw new Error('Proyecto inválido.');fields.push('$.focus',input.focus);}
  if(input.energy!==undefined){if(!['normal','low'].includes(input.energy))throw new Error('Energía inválida.');fields.push('$.energy',input.energy);}
  if(input.text!==undefined)fields.push('$.action',txt(input.text,300));
  if(!fields.length)return {ok:true};
  const initial={focus:initialFocus.focus,energy:'normal',action:initialFocus.action};
  const placeholders=fields.map(()=>'?').join(',');
  await db().prepare(`INSERT INTO office(id,value,updated_at) VALUES ('settings',json_set(?,${placeholders}),?) ON CONFLICT(id) DO UPDATE SET value=json_set(office.value,${placeholders}),updated_at=excluded.updated_at`).bind(JSON.stringify(initial),...fields,Date.now(),...fields).run();return {ok:true};
 }
 if(action==='create'){
  if(!['idea','request'].includes(input.kind))throw new Error('Tipo inválido.');const title=txt(input.title,ENTRY_TITLE_MAX),body=txt(input.body||'');if(!title)throw new Error('Escribe qué necesitas.');
  if(!projects.some(p=>p.id===input.project)||!roles.some(r=>r.id===input.role))throw new Error('Proyecto o responsable inválido.');
  const id=crypto.randomUUID(),now=Date.now();await db().prepare('INSERT INTO entries(id,kind,project,title,body,status,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,input.kind,input.project,title,body,input.kind==='idea'?'inbox':'queued',input.role,now,now).run();
  try{await event('capture',title);}catch{}return {id};
 }
 if(action==='update'){
  const e=await db().prepare('SELECT * FROM entries WHERE id=?').bind(txt(input.id,100)).first<any>();if(!e)throw new Error('Encargo no encontrado.');
  const allowed=service?['linked','review','blocked']:['parked','queued','accepted','cancelled'];if(!allowed.includes(input.status))throw new Error('Estado inválido.');
  if(service){
   if(['review','accepted'].includes(e.status))return {ok:true,alreadyCompleted:true};
   if(e.status===input.status)return {ok:true,duplicate:true};
   if(!['dispatching','linked'].includes(e.status)||(input.status==='linked'&&e.status!=='dispatching'))throw new Error('El encargo ya ha cambiado de estado.');
  }else{
   if(['linked','dispatching'].includes(e.status))throw new Error('El estado de una tarea admitida se gestiona en Hermes.');
   if(input.status==='accepted'&&e.status!=='review')throw new Error('Primero hace falta un resultado para revisar.');
   if(input.status==='queued'&&(['review','accepted','cancelled'].includes(e.status)||(e.status==='blocked'&&e.kind!=='request')))throw new Error('No se puede volver a despachar este encargo.');
   if(['accepted','cancelled'].includes(e.status)){
    if(input.status===e.status&&e.status==='cancelled')return {ok:true,duplicate:true};
    throw new Error('Este encargo ya está cerrado.');
   }
  }
  const result=service&&input.result!==undefined?txt(input.result,16000):e.result,external=service&&input.externalId!==undefined?txt(input.externalId,150):e.external_id,now=Date.now();
  const update=db().prepare('UPDATE entries SET status=?,kind=?,result=?,external_id=?,updated_at=? WHERE id=? AND status=? AND updated_at=?').bind(input.status,input.status==='queued'&&e.kind==='idea'?'request':e.kind,result,external,now,e.id,e.status,e.updated_at);
  let changes=0;
  if(service&&e.kind==='conversation'&&['review','blocked'].includes(input.status)){
   const {chatResult}=await import('./alfred-chat');const m=chatResult(e,result||'',input.status,external||'');
   const batch=await db().batch([update,db().prepare('INSERT INTO office(id,value,updated_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM entries WHERE id=? AND status=? AND updated_at=?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('message:'+m.id+':assistant',JSON.stringify(m),m.at,e.id,input.status,now)]);changes=batch[0].meta.changes;
  }else changes=(await update.run()).meta.changes;
  if(!changes)throw new Error('El encargo cambió mientras se guardaba. Vuelve a consultar su estado.');
  try{await event('update',e.title+' · '+input.status);}catch{}return {ok:true};
 }
 if(action==='revise'&&!service){
  const e=await db().prepare('SELECT * FROM entries WHERE id=?').bind(txt(input.id,100)).first<any>();if(!e||e.kind!=='request'||e.status!=='review')throw new Error('Solo se pueden pedir cambios sobre un resultado pendiente de revisión.');
  const feedback=typeof input.feedback==='string'?txt(input.feedback,REVISE_FEEDBACK_MAX):'';if(!feedback)throw new Error('Escribe qué hay que cambiar.');
  const now=Date.now(),body=(e.body||'')+'\n\nCambios pedidos ('+new Date(now).toLocaleString('es-ES')+'):\n'+feedback;
  if(body.length>REQUEST_BODY_MAX)throw new Error('Este encargo ya acumula demasiados cambios. Acéptalo o crea uno nuevo.');
  const r=await db().prepare("UPDATE entries SET status='queued',body=?,updated_at=? WHERE id=? AND status='review' AND updated_at=?").bind(body,now,e.id,e.updated_at).run();if(!r.meta.changes)throw new Error('El encargo cambió mientras se guardaba.');
  try{await event('update',e.title+' · cambios pedidos');}catch{}return {ok:true,id:e.id};
 }
 if(action==='claim'&&service){
  const r=await db().prepare("UPDATE entries SET status='dispatching',updated_at=? WHERE id=? AND kind IN ('request','conversation') AND status='queued' AND (SELECT COUNT(*) FROM entries WHERE status IN ('dispatching','linked'))=0 RETURNING *").bind(Date.now(),txt(input.id,100)).all();return {entry:r.results[0]||null};
 }
 if(action==='snapshot'&&service){const s=input.snapshot;if(!s||typeof s.observedAt!=='string'||!Array.isArray(s.boards)||JSON.stringify(s).length>180000)throw new Error('La lectura del puente no es válida.');await write('snapshot',s);return {ok:true};}
 if(action==='pending'&&service){const r=await db().prepare("SELECT * FROM entries WHERE kind IN ('request','conversation') AND status='queued' ORDER BY created_at LIMIT 1").all();return {requests:r.results};}
 if(action==='brief'){const e=await db().prepare('SELECT * FROM entries WHERE id=?').bind(txt(input.id,100)).first<any>();if(!e)throw new Error('Encargo no encontrado.');return {brief:brief(e)};}
 throw new Error('Acción desconocida.');
}
