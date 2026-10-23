// Today's to-do: at most five short lines, written by Alfred every morning from what is pending (the team's decisions,
// what was left undone yesterday, the person's goals and routine) and sent once on Telegram with a button per line.
// Readable in a second: one verb-first line per task, nothing else. Alfred adds or ticks items from a conversation with
// the directives <<hoy:+texto>> and <<hoy:hecho:N>> (N = the item's number), which never reach the person.
// Pure functions and small file helpers only, so telegram-checks can exercise them without Telegram or Claude.
import fs from 'node:fs';
import path from 'node:path';

export type Item={t:string;hecho:boolean;rid?:string};   // rid: the matching reminder in Apple Reminders
export type Day={fecha:string;items:Item[];mensaje?:number;enviado?:string;agenda?:string};
export const MAX=5;
export const HOUR=9;          // the morning message; until LAST it is still sent if the Mac was off at nine
export const LAST=21;    // a to-do at seven in the evening is still better than none (18/10: the app opened at 14:05 and no list came)

export const isoDay=(d:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const fileOf=(dataDir:string,fecha:string)=>path.join(dataDir,'hoy',fecha+'.json');
export function load(dataDir:string,fecha:string):Day|null{
 try{const d=JSON.parse(fs.readFileSync(fileOf(dataDir,fecha),'utf8'));return d&&Array.isArray(d.items)?d:null;}catch{return null;}
}
/** One line per morning in hoy/registro.log: whether Alfred wrote the list or the fallback was used, and why. */
export function note(dataDir:string,line:string){try{fs.mkdirSync(path.join(dataDir,'hoy'),{recursive:true});fs.appendFileSync(path.join(dataDir,'hoy','registro.log'),new Date().toISOString()+' '+line+'\n');}catch{}}
export function save(dataDir:string,day:Day){fs.mkdirSync(path.join(dataDir,'hoy'),{recursive:true});fs.writeFileSync(fileOf(dataDir,day.fecha),JSON.stringify(day,null,1));}

const tidy=(s:string)=>s.replace(/\*\*|__|`/g,'').replace(/\s+/g,' ').trim().replace(/[.;]+$/,'');
/** Alfred's reply → the list: lines that start with a dash, bullet or number; short, unique, five at most. */
export function parse(reply:string):string[]{
 const out:string[]=[];
 // one task per line; a reply squeezed into one line («- a - b» or «a | b») is split too
 const parts=reply.includes('\n')?[]:reply.split(/\s+\|\s+|\s+-\s+(?=[A-ZÁÉÍÓÚÑ¿])/);
 const rows=parts.length>1?parts.map(r=>'- '+r.replace(/^\s*[-•*]\s+/,'')):reply.split('\n');
 for(const raw of rows){
  const m=raw.match(/^\s*(?:[-•*]|\d+[.)])\s+(.+)$/);if(!m)continue;
  let t=tidy(m[1]);if(!t)continue;if(t.length>70)t=t.slice(0,69).trimEnd()+'…';
  if(!out.some(o=>o.toLowerCase()===t.toLowerCase()))out.push(t);
  if(out.length>=MAX)break;
 }
 return out;
}

const DAYS=['dom','lun','mar','mié','jue','vie','sáb'];
/** The message: a header and one line per task, a tick on the ones done. */
export function render(day:Day):string{
 const d=new Date(day.fecha+'T12:00:00'),left=day.items.filter(i=>!i.hecho).length;
 const head=`Hoy, ${DAYS[d.getDay()]} ${d.getDate()}`+(day.items.length&&!left?' · todo hecho':'');
 return [head,...(day.agenda?['📅 '+day.agenda]:[]),...day.items.map(i=>(i.hecho?'✓ ':'○ ')+i.t)].join('\n');
}
/** One button per task still open; tapping it ticks the task. */
export function keyboard(day:Day){
 return {inline_keyboard:day.items.map((it,i)=>it.hecho?null:[{text:'✓ '+(it.t.length>34?it.t.slice(0,33)+'…':it.t),callback_data:'h:'+day.fecha+':'+i}]).filter(Boolean)};
}
export function tick(day:Day,i:number){if(day.items[i])day.items[i].hecho=true;return day;}

/** What Alfred needs to write today's list. Yesterday's undone items come first so nothing silently drops. */
export function prompt(ctx:{yesterday:Day|null;decisions:string[];agenda?:string}):string{
 const undone=(ctx.yesterday?.items||[]).filter(i=>!i.hecho).map(i=>i.t);
 const done=(ctx.yesterday?.items||[]).filter(i=>i.hecho).map(i=>i.t);
 return ['[Tarea programada de la mañana, no es un mensaje suyo. Escribe su to-do de hoy.',
  `Como mucho ${MAX} tareas, una por línea, cada línea empieza por "- ", empieza por un verbo y tiene menos de 60 caracteres.`,
  'Elige lo que más le acerca a sus objetivos hoy y lo que solo puede hacer él. Ten en cuenta su rutina y sus objetivos (están en tus instrucciones y en su vault).',
  ctx.agenda?'Hoy en su calendario: '+ctx.agenda+'. Planea alrededor de eso (no lo repitas como tarea).':'',
  ctx.decisions.length?'Decisiones del equipo que le esperan: '+ctx.decisions.join('; ')+'.':'El equipo no le espera para nada.',
  undone.length?'De ayer quedó sin hacer: '+undone.join('; ')+'. Si sigue importando, mantenlo.':'',
  done.length?'Ayer hizo: '+done.join('; ')+'.':'',
  'Responde solo con la lista: sin saludo, sin explicaciones, sin nada más.]'].filter(Boolean).join('\n');
}

/** <<hoy:+texto>> adds a task, <<hoy:hecho:N>> ticks task N (1-based). Returns the reply without the directives. */
export function applyDirectives(reply:string,day:Day):{text:string;changed:boolean}{
 let changed=false;
 const text=reply.replace(/<<hoy:([^>]{1,140})>>/g,(_,body:string)=>{
  const b=body.trim();
  if(b.startsWith('+')){const t=tidy(b.slice(1));if(t&&day.items.length<MAX+3&&!day.items.some(i=>i.t.toLowerCase()===t.toLowerCase())){day.items.push({t:t.slice(0,70),hecho:false});changed=true;}}
  else{const n=Number(b.match(/^hecho:\s*(\d+)$/)?.[1]);if(n>=1&&day.items[n-1]&&!day.items[n-1].hecho){day.items[n-1].hecho=true;changed=true;}}
  return '';
 }).replace(/[ \t]{2,}/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {text,changed};
}
/** The list as context for a conversation, so «¿qué me queda?» or «ya lo he hecho» can be answered and acted on. */
export function context(day:Day|null):string{
 if(!day||!day.items.length)return 'Hoy todavía no tiene to-do.';
 return 'Su to-do de hoy: '+day.items.map((i,n)=>`${n+1}. ${i.t}${i.hecho?' (hecha)':''}`).join(' · ')+'. Para añadir una tarea escribe <<hoy:+texto>>; para tachar la número N, <<hoy:hecho:N>>.';
}
