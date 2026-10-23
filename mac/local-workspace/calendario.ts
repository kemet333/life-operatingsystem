// Bridge to alfred-calendario (Sources/CalendarHelper.swift), the app's helper for Apple Calendar and Reminders.
// Today's events feed the morning to-do; the to-do itself lives in the Reminders list «Alfred», which syncs to the iPhone:
// ticking there or on Telegram is the same thing. Without the helper (tests, the web copy) everything here is a no-op.
import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type Ev={titulo:string;inicio:string;fin:string;todoElDia:boolean;calendario:string};
export type Rem={id:string;titulo:string;hecho:boolean;vence?:string};
export const LIST='Alfred';
// server.mjs runs from Contents/Resources/workspace; the helper sits in Contents/MacOS.
const helper=()=>process.env.LIFE_OS_CALENDAR_HELPER||path.resolve(path.dirname(process.argv[1]||'.'),'../../MacOS/alfred-calendario');
export const available=()=>fs.existsSync(helper());

// The first call may wait for the owner to answer macOS's permission prompt, hence the long timeout.
function run(args:string[],timeout=130_000):Promise<any>{
 return new Promise((resolve,reject)=>execFile(helper(),args,{timeout,maxBuffer:2_000_000},(e,out)=>{
  let j:any=null;try{j=JSON.parse(String(out||'').trim().split('\n').pop()||'null');}catch{}
  if(j&&!Array.isArray(j)&&j.error)return reject(Error(j.error));
  if(e&&!j)return reject(e);resolve(j);
 }));
}
export const permission=():Promise<{eventos:string;recordatorios:string}>=>run(['permiso']);
export const events=(fecha:string):Promise<Ev[]>=>run(['eventos',fecha]).then(r=>Array.isArray(r)?r:[]);
export const reminders=():Promise<Rem[]>=>run(['recordatorios',LIST]).then(r=>Array.isArray(r)?r:[]);
export const create=(titulo:string,fecha:string):Promise<string>=>run(['crear',LIST,titulo,fecha]).then(r=>String(r?.id||''));
export const complete=(id:string,done=true)=>run(['completar',id,done?'1':'0']);

/** «10:00 Reunión con X · 17:30 Gimnasio · Cumpleaños de Ana» — today's events in one line, at most four. */
export function agenda(evs:Ev[]):string{
 const hm=(iso:string)=>new Date(iso).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
 return evs.slice(0,4).map(e=>(e.todoElDia?'':hm(e.inicio)+' ')+e.titulo.trim()).filter(Boolean).join(' · ')+(evs.length>4?` · +${evs.length-4}`:'');
}
