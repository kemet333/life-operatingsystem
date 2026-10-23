// The live portfolio: one Obsidian note per project in the vault (01-Projects/Cartera), edited by the owner.
// Properties (frontmatter) give the map; the body gives evidence and context for Alfred and the team.
import fs from 'node:fs';
import path from 'node:path';
import {ruta} from './config';
import os from 'node:os';
import {divisions,type Project} from '../../alfred-os/lib/alfred-data';

// Both come from configuracion.json (config.ts); empty on a fresh install, and then nothing is read.
export const VAULT=ruta('vault','LIFE_OS_VAULT_DIR');
export const CARTERA=ruta('cartera','LIFE_OS_CARTERA_DIR',VAULT?path.join(VAULT,'Cartera'):'');
const ID=/^[a-z0-9-]{2,30}$/;

function value(raw:string){
 const v=raw.trim();
 if(v.startsWith('"')){try{return String(JSON.parse(v));}catch{return v.slice(1,-1);}}
 if(v.startsWith("'")&&v.endsWith("'"))return v.slice(1,-1).replace(/''/g,"'");
 return v;
}
export function parse(text:string,file:string):(Project&{order:number})|null{
 const m=text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);if(!m)return null;
 const fm:Record<string,string>={};
 for(const line of m[1].split(/\r?\n/)){const kv=line.match(/^([a-zA-ZñÑáéíóú_]+):\s*(.*)$/);if(kv)fm[kv[1].toLowerCase()]=value(kv[2]);}
 if(fm.tipo!=='proyecto'||!ID.test(fm.id||''))return null;
 const body=m[2],name=(body.match(/^#\s+(.+)$/m)?.[1]||path.basename(file,'.md')).trim();
 const evidence=(body.match(/\*\*Evidencia:\*\*\s*(.+)/)?.[1]||'').trim();
 const context=(body.split(/^##\s+Contexto[^\n]*$/m)[1]||'').replace(/<!--[\s\S]*?-->/g,'').trim();
 const division=divisions.some(d=>d.id===fm.area)?fm.area:'lab';
 return {id:fm.id,division,name:name.slice(0,80),line:(fm.linea||'').slice(0,60),stage:(fm.etapa||'Por documentar').slice(0,60),next:(fm.siguiente||'').slice(0,240),
  repo:/^https:\/\//.test(fm.repo||'')?fm.repo:'',evidence:evidence.slice(0,400),context:context.slice(0,4000),updated:fm.actualizado||'',team:fm.equipo||'',source:path.basename(file),note:path.join(CARTERA,path.basename(file)),order:Number(fm.orden)||999};
}
// Read on demand (a couple of dozen small files); a missing or empty folder means "use the built-in list".
// Asynchronous on purpose: ~/Documents is guarded by macOS, and while its permission prompt waits a synchronous
// read would freeze the whole local server (and Alfred's voice) instead of just this list.
export async function read():Promise<Project[]>{
 let files:string[]=[];if(!CARTERA)return [];try{files=(await fs.promises.readdir(CARTERA)).filter(f=>f.endsWith('.md'));}catch{return [];}
 const seen=new Set<string>(),list:(Project&{order:number})[]=[];
 for(const f of files){let p;try{p=parse(await fs.promises.readFile(path.join(CARTERA,f),'utf8'),f);}catch{continue;}if(p&&!seen.has(p.id)){seen.add(p.id);list.push(p);}}
 const area=(id:string)=>divisions.findIndex(d=>d.id===id);
 return list.sort((a,b)=>area(a.division)-area(b.division)||a.order-b.order||a.name.localeCompare(b.name,'es')).map(({order,...p})=>p);
}

// Read one note of the vault for Memoria (read-only). Only real .md files inside the vault, never outside it.
export async function note(requested:string):Promise<{path:string;name:string;text:string;updated:number}|null>{
 if(!VAULT)return null;
 if(typeof requested!=='string'||!requested.endsWith('.md'))return null;
 try{
  const real=await fs.promises.realpath(path.resolve(VAULT,requested)),root=await fs.promises.realpath(VAULT);
  if(!real.startsWith(root+path.sep))return null;
  const st=await fs.promises.stat(real);if(!st.isFile()||st.size>400_000)return null;
  return {path:real,name:path.basename(real,'.md'),text:await fs.promises.readFile(real,'utf8'),updated:st.mtimeMs};
 }catch{return null;}
}

// Finder-style browsing for Memoria (read-only): folders and notes inside the vault, never outside it, never hidden
// folders (.obsidian, .git, .trash). Paths go back relative to the vault, the same ones note() accepts.
type Entry={name:string;path:string};
const hidden=(n:string)=>n.startsWith('.')||n==='node_modules';
async function within(rel:string){
 const root=await fs.promises.realpath(VAULT),real=await fs.promises.realpath(path.resolve(VAULT,rel||'.'));
 return real===root||real.startsWith(root+path.sep)?{root,real}:null;
}
export async function folder(rel:string):Promise<{path:string;dirs:(Entry&{count:number})[];notes:(Entry&{updated:number})[]}|null>{
 if(!VAULT)return null;
 if(typeof rel!=='string')return null;
 try{
  const at=await within(rel);if(!at||!(await fs.promises.stat(at.real)).isDirectory())return null;
  const dirs:(Entry&{count:number})[]=[],notes:(Entry&{updated:number})[]=[];
  for(const e of await fs.promises.readdir(at.real,{withFileTypes:true})){
   if(hidden(e.name))continue;const full=path.join(at.real,e.name),relative=path.relative(at.root,full);
   if(e.isDirectory()){let count=0;try{count=(await fs.promises.readdir(full,{withFileTypes:true})).filter(x=>!hidden(x.name)&&(x.isDirectory()||x.name.endsWith('.md'))).length;}catch{}dirs.push({name:e.name,path:relative,count});}
   else if(e.isFile()&&e.name.endsWith('.md'))notes.push({name:e.name.slice(0,-3),path:relative,updated:(await fs.promises.stat(full)).mtimeMs});
  }
  dirs.sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));notes.sort((a,b)=>b.updated-a.updated);
  return {path:path.relative(at.root,at.real),dirs,notes};
 }catch{return null;}
}
// The notes touched lately, newest first, for «Recientes» (grouped by day in the app).
export async function recent(days=30,limit=80):Promise<(Entry&{updated:number;folder:string})[]>{
 const out:(Entry&{updated:number;folder:string})[]=[],since=Date.now()-days*86_400_000;
 if(!VAULT)return out;
 let root:string;try{root=await fs.promises.realpath(VAULT);}catch{return out;}
 const walk=async(dir:string,depth:number)=>{
  if(depth>6)return;let entries:fs.Dirent[];try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const e of entries){if(hidden(e.name))continue;const full=path.join(dir,e.name);
   if(e.isDirectory())await walk(full,depth+1);
   else if(e.isFile()&&e.name.endsWith('.md')){const t=(await fs.promises.stat(full)).mtimeMs;if(t>=since)out.push({name:e.name.slice(0,-3),path:path.relative(root,full),updated:t,folder:path.relative(root,dir)});}}
 };
 await walk(root,0);
 return out.sort((a,b)=>b.updated-a.updated).slice(0,limit);
}
