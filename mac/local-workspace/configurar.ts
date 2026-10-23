// First-run setup, and the same screen later to change it: the owner's name, the Claude login (Alfred's brain), the notes
// folder and the projects the agent team works on. Everything is written to the app's data folder, never to the code:
//   perfil/perfil.json        name and how Alfred addresses them (profile.ts reads it on every turn)
//   configuracion.json        notes folder (config.ts reads it at startup: changing it restarts the local server)
//   equipo/projects.json      the team's projects, when the engine has no projects.json of its own next to it
import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {ruta,expand} from './config';

const DATA=process.env.LIFE_OS_DATA_DIR||'';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const WIN=process.platform==='win32';

/** Exit code that asks the desktop app to start the local server again (to read a new configuracion.json). */
export const REINICIAR=75;

function run(bin:string,args:string[],timeout=20000,cwd?:string){
 return new Promise<{code:number,out:string}>(resolve=>execFile(bin,args,{timeout,cwd,windowsHide:true,maxBuffer:4<<20},(e:any,stdout)=>resolve({code:e?(typeof e.code==='number'?e.code:1):0,out:String(stdout||'')})));
}

// ---------- Claude ----------

/** The Claude Code that travels with the app (Alfred's Agent SDK), else one on the PATH. */
export function claudeBin(){
 if(process.env.LIFE_OS_CLAUDE_BIN)return process.env.LIFE_OS_CLAUDE_BIN;
 try{
  const pkg=createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
  const bin=path.join(path.dirname(pkg),WIN?'claude.exe':'claude');
  if(fs.existsSync(bin))return bin;
 }catch{}
 return 'claude';
}
let claudeCache:{at:number,value:any}|null=null;
export async function claude(fresh=false){
 if(!fresh&&claudeCache&&Date.now()-claudeCache.at<30_000)return claudeCache.value;
 const bin=claudeBin(),v=await run(bin,['--version']);
 let sesion=false;
 if(v.code===0){const s=await run(bin,['auth','status']);try{sesion=JSON.parse(s.out).loggedIn===true;}catch{sesion=/logged in/i.test(s.out)&&!/not logged/i.test(s.out);}}
 const value={instalado:v.code===0,version:v.out.trim().split(/\s/)[0]||'',sesion};
 claudeCache={at:Date.now(),value};return value;
}
/** Opens the Anthropic sign-in page in the browser; Claude Code finishes on its own when the person accepts. */
export function iniciarSesion(){
 const p=spawn(claudeBin(),['auth','login'],{stdio:'ignore',detached:true,windowsHide:true});
 p.on('error',()=>{});p.unref();claudeCache=null;
}

// ---------- profile and notes ----------

function readJson(file:string){try{return JSON.parse(fs.readFileSync(file,'utf8'))||{};}catch{return {};}}
function writeJson(file:string,value:unknown){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,file);
}
const clean=(v:unknown,max:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';

export function guardarPerfil(input:any){
 const nombre=clean(input.nombre,60),apodo=clean(input.apodo,40);
 if(!nombre)return {error:'Escribe tu nombre.'};
 const file=path.join(DATA,'perfil','perfil.json');
 writeJson(file,{...readJson(file),nombre,apodo});
 return {ok:true};
}

/** Sets the notes folder (an existing folder; empty turns the notes off). The server must restart to use it. */
export function guardarNotas(input:any){
 const raw=clean(input.ruta,600),dir=raw?path.resolve(expand(raw)):'';
 if(dir&&!fs.statSync(dir,{throwIfNoEntry:false})?.isDirectory())return {error:'Esa carpeta no existe.'};
 const file=path.join(DATA,'configuracion.json'),config=readJson(file);
 if(dir)config.vault=dir;else delete config.vault;
 writeJson(file,config);
 return {ok:true,reiniciar:true};
}

// ---------- the agent team ----------

/** The engine: the configured one (the owner's own checkout) or the copy that travels with the app. */
export function motor(){
 const bundled=path.join(HERE,'equipo','equipo.py');
 return ruta('equipo.motor','LIFE_OS_EQUIPO',fs.existsSync(bundled)?bundled:'');
}
export function python(){return ruta('equipo.python','LIFE_OS_EQUIPO_PY',WIN?'python':'python3');}
/** Where the team's projects live; an engine with its own projects.json is configured in its repository (read-only here). */
function proyectosFile(){
 const own=motor()?path.join(path.dirname(motor()),'projects.json'):'';
 return own&&fs.existsSync(own)?{file:own,propio:true}:{file:path.join(DATA,'equipo','projects.json'),propio:false};
}
const DEFAULTS={version:1,model:'claude-sonnet-5-5',continuo:true,auto_aprobar:true,
 limits:{parallel:1,tasks_per_batch:3,attempts:2,plan_seconds:600,builder_seconds:900,review_seconds:420,test_seconds:240,max_files:8,rounds_per_day:2},projects:{}};

export async function equipo(){
 const m=motor(),py=python(),{file,propio}=proyectosFile();
 const pv=m?await run(py,['--version']):{code:1,out:''};
 const cfg=readJson(file),projects=Object.entries(cfg.projects||{}).map(([id,p]:[string,any])=>({id,nombre:p.name||id,repo:p.repo||'',base:p.base||''}));
 let servicio:any=null;
 if(m&&pv.code===0){const s=await run(py,[path.join(path.dirname(m),'servicio.py'),'estado']);try{servicio=JSON.parse(s.out);}catch{}}
 return {instalado:!!m,python:pv.code===0?pv.out.trim():'',propio,proyectos:projects,servicio};
}

const slug=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30);

export async function anadirProyecto(input:any){
 const {file,propio}=proyectosFile();
 if(propio)return {error:'Los proyectos de este equipo se configuran en su repositorio.'};
 const nombre=clean(input.nombre,60),repo=path.resolve(expand(clean(input.repo,600)||'.')),objetivo=clean(input.objetivo,600);
 const id=slug(nombre);
 if(!nombre||!id)return {error:'Pon un nombre al proyecto.'};
 const head=await run('git',['-C',repo,'rev-parse','--abbrev-ref','HEAD']);
 if(head.code!==0)return {error:'Esa carpeta no es un repositorio de git.'};
 const cfg={...DEFAULTS,...readJson(file)};cfg.projects={...(cfg.projects||{})};
 if(cfg.projects[id])return {error:'Ya hay un proyecto con ese nombre.'};
 cfg.projects[id]={name:nombre,repo,base:clean(input.base,100)||head.out.trim(),board:'equipo-'+id,goal:objetivo||`Hacer avanzar ${nombre}.`,tests:{}};
 writeJson(file,cfg);
 const s=await run(python(),[motor(),'setup'],120000);
 return s.code===0?{ok:true}:{ok:true,aviso:'Proyecto guardado; la rama del equipo se creará en la primera vuelta.'};
}

export function quitarProyecto(input:any){
 const {file,propio}=proyectosFile(),id=String(input.id||'');
 if(propio)return {error:'Los proyectos de este equipo se configuran en su repositorio.'};
 const cfg=readJson(file);if(!cfg.projects?.[id])return {error:'Ese proyecto no está.'};
 delete cfg.projects[id];writeJson(file,cfg);return {ok:true};
}

/** Turns the team's schedule on or off on this computer (launchd, Task Scheduler or cron). */
export async function servicio(input:any){
 const m=motor();if(!m)return {error:'El equipo no viene en esta copia.'};
 if(input.activo===true&&!Object.keys(readJson(proyectosFile().file).projects||{}).length)return {error:'Añade antes un proyecto.'};
 const r=await run(python(),[path.join(path.dirname(m),'servicio.py'),input.activo===true?'instalar':'quitar'],60000);
 return r.code===0?{ok:true}:{error:'No se ha podido cambiar el servicio del equipo.'};
}

export async function estado(fresco=false){
 const [c,e]=await Promise.all([claude(fresco),equipo()]);
 const perfil=readJson(path.join(DATA,'perfil','perfil.json')),vault=ruta('vault','LIFE_OS_VAULT_DIR');
 return {perfil:{nombre:clean(perfil.nombre,60),apodo:clean(perfil.apodo,40)},claude:c,notas:{ruta:vault,existe:!!vault&&fs.existsSync(vault)},equipo:e,
  listo:!!clean(perfil.nombre,60)&&c.sesion};
}
