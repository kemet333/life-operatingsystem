// Contenido: the content calendar of every project in one place, so the owner can see what goes out, when, and how it looks.
// Three sources, one list:
//  · the content machine (pieces + publications in machine.db): what it schedules and, once PostOnce is connected,
//    publishes. Changing a time or marking something as published writes there, so the machine stays the backend.
//  · a posting plan in the vault (contenido.plan: a folder with plan-*.md, one «### Day (date)» and «#### Network · Type · HH:MM: Title» per post)
//  · finished full-visual reels with no date yet (Documents/full-visual-0.2.0/workspace/output).
// Plan and loose reels have no database of their own: times and «ya publicado» for them live in Workspace/contenido/agenda.json.
// Profiles (bio, name, link) are a preview the owner edits here, in Workspace/contenido/perfiles.json; Instagram is changed by him.
import * as profile from './profile';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {VAULT} from './cartera';
import {ruta,texto,lista} from './config';

// Every source is optional and set in configuracion.json (config.ts); an empty one is simply not read.
const DB=ruta('contenido.maquina','LIFE_OS_RF_DB');
const FV_OUT=ruta('contenido.fullVisual','LIFE_OS_FV_OUT');
const REELS_DIR=ruta('contenido.reelsCurso','LIFE_OS_COURSE_REELS');
const PLAN_DIR=texto('contenido.plan','','LIFE_OS_CONTENT_PLAN');
// The day's videos of the Plan de contenido único, as the content system delivers them: Reels/<fecha>/kc-1030-h1.mp4 + .txt
const DAY_DIR=ruta('contenido.reelsDia','LIFE_OS_DAY_REELS');
const MEDIA_ROOTS=()=>[FV_OUT,REELS_DIR,DAY_DIR,DB?path.join(path.dirname(DB),'media'):''].filter(Boolean);
// The accounts whose content this calendar follows (configuracion.json → contenido.marcas):
//   [{"id": "mi-marca", "nombre": "Mi marca", "prefijo": "mm", "claves": ["mi-marca"], "perfiles": [{"red": "instagram", "usuario": "…", "nombre": "…", "bio": "…", "enlace": "…", "nota": "…"}]}]
// prefijo names the day's files (mm-1030-h1.mp4); claves tell a loose reel's folder or text apart; contenido.planMarca is the
// account the vault plan belongs to (by default the first).
type Marca={id:string;nombre:string;prefijo:string;claves:string[];perfiles:any[]};
const MARCAS:Marca[]=lista('contenido.marcas').filter((m:any)=>m&&typeof m.id==='string'&&/^[a-z0-9-]{2,40}$/.test(m.id)).map((m:any)=>({
 id:m.id,nombre:String(m.nombre||m.id),prefijo:/^[a-z]{1,6}$/.test(m.prefijo||'')?m.prefijo:'',
 claves:(Array.isArray(m.claves)?m.claves:[m.id]).filter((c:unknown)=>typeof c==='string'&&c.trim()).map((c:string)=>c.toLowerCase()),perfiles:Array.isArray(m.perfiles)?m.perfiles:[]}));
export const BRANDS:Record<string,string>=Object.fromEntries(MARCAS.map(m=>[m.id,m.nombre]));
export const marcas=()=>MARCAS.map(m=>({id:m.id,nombre:m.nombre}));
const PLAN_BRAND=texto('contenido.planMarca',MARCAS[0]?.id||'');
const TZ='Europe/Madrid';

export type Video={nombre:string;path:string};
export type Item={id:string;fuente:'maquina'|'plan'|'video';brand:string;marca:string;canal:string;tipo:string;fecha:string|null;
 titulo:string;gancho:string;texto:string;nota:string;estado:'publicado'|'programado'|'postonce'|'tu'|'falta'|'fallo'|'plan'|'sin-fecha';
 detalle:string;url:string;videos:Video[];portadas:string[];elegido:number;horaEditable:boolean;marcable:boolean};
export type Perfil={brand:string;red:string;usuario:string;nombre:string;bio:string;enlace:string;nota:string};

// ---------- small helpers ----------
const sha=(s:string)=>createHash('sha1').update(s).digest('hex').slice(0,10);
/** «2026-10-21» + «20:00» in Madrid → ISO in UTC (handles the October and March clock changes). */
export function madrid(day:string,hm:string):string{
 const [y,m,d]=day.split('-').map(Number),[h,mi]=hm.split(':').map(Number),guess=Date.UTC(y,m-1,d,h,mi);
 const off=(t:number)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
  return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-t;};
 let t=guess-off(guess);t=guess-off(t);return new Date(t).toISOString();
}
const workspace=(dataDir:string)=>path.join(dataDir,'contenido');
async function readJson<T>(file:string,fallback:T):Promise<T>{try{return JSON.parse(await fs.promises.readFile(file,'utf8'));}catch{return fallback;}}
async function writeJson(file:string,data:unknown){await fs.promises.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(data,null,1));await fs.promises.rename(tmp,file);}
type Agenda=Record<string,{fecha?:string;publicado?:string;url?:string;oculto?:boolean}>;
const agendaFile=(dataDir:string)=>path.join(workspace(dataDir),'agenda.json');

// ---------- the content machine ----------
function open(write=false){
 if(!fs.existsSync(DB))return null;
 const db=new DatabaseSync(DB,write?{}:{readOnly:true});db.exec('PRAGMA busy_timeout=4000');return db;
}
function machineState(status:string,error:string|null,fv:any):{estado:Item['estado'];detalle:string}{
 if(status==='published')return {estado:'publicado',detalle:'Publicado'};
 if(status==='sent')return {estado:'postonce',detalle:'En PostOnce, a la espera de su hora'};
 if(status==='failed')return {estado:'fallo',detalle:'Falló al publicar: '+(error||'sin motivo')};
 if(fv?.state==='manual'||/a mano/i.test(error||''))return {estado:'tu',detalle:'Lo subes tú'};
 if(status==='blocked')return {estado:'falta',detalle:/media/i.test(error||'')?'Falta el vídeo':(error||'Bloqueado')};
 return {estado:'programado',detalle:'Programado: lo publica la máquina cuando PostOnce esté conectado'};
}
function machine():{items:Item[];proyectos:Set<string>}{
 const db=open(),proyectos=new Set<string>();if(!db)return {items:[],proyectos};
 try{
  const rows=db.prepare(`select u.id pub,u.channel,u.publish_at,u.status,u.error,u.url,p.id piece,p.brand,p.format,p.title,p.hook,p.caption,p.media_path,p.meta
   from publications u join pieces p on p.id=u.piece_id `).all() as any[];
  for(const p of db.prepare("select meta from pieces where json_extract(meta,'$.fv.project') is not null").all() as any[]){try{proyectos.add(JSON.parse(p.meta).fv.project);}catch{}}
  const items=rows.filter(r=>BRANDS[r.brand]).map(r=>{
   let meta:any={};try{meta=r.meta?JSON.parse(r.meta):{};}catch{}
   const fv=meta.fv||{};const s=machineState(r.status,r.error,fv);
   const vids:string[]=Array.isArray(fv.videos)?fv.videos:r.media_path?[r.media_path]:[];
   const chosen=r.media_path?Math.max(0,vids.indexOf(r.media_path)):Math.max(0,(Number(fv.chosen)||1)-1);
   const nota=String(fv.note||'');
   return {id:'rf:'+r.pub,fuente:'maquina',brand:r.brand,marca:BRANDS[r.brand],canal:r.channel,tipo:r.format==='tiktok'?'Vídeo':r.format==='reel'?'Reel':r.format,
    fecha:r.publish_at,titulo:r.title||r.hook||'(sin título)',gancho:r.hook||'',texto:r.caption||'',nota,...s,url:r.url||'',
    videos:vids.map((v,i)=>({nombre:vids.length>1?'Apertura '+(i+1):'Vídeo',path:v})),portadas:[],elegido:chosen,
    horaEditable:['queued','blocked','failed'].includes(r.status),marcable:r.status!=='sent'} as Item;
  });
  return {items,proyectos};
 }finally{db.close();}
}

// ---------- the posting plan in the vault ----------
const CANAL:Record<string,string>={instagram:'instagram',x:'x',telegram:'telegram',discord:'discord',youtube:'youtube',email:'email',tiktok:'tiktok'};
async function planFile():Promise<string|null>{
 if(!VAULT||!PLAN_DIR)return null;
 try{const fs_=(await fs.promises.readdir(path.join(VAULT,PLAN_DIR))).filter(f=>/^plan-.*\.md$/.test(f)).sort();return fs_.length?path.join(VAULT,PLAN_DIR,fs_[fs_.length-1]):null;}catch{return null;}
}
/** The plan's days (### Lun 19 (2026-10-19)) and posts (#### Red · Tipo · HH:MM: Título), with their text blocks. */
export function parsePlan(md:string,reels:string[]=[]):Item[]{
 const out:Item[]=[];let day='';let cur:{red:string;tipo:string;hm:string;titulo:string;lines:string[]}|null=null;
 const flush=()=>{
  if(!cur||!day)return;
  const blocks:{label:string;text:string}[]=[];let label='',inCode=false,buf:string[]=[];const notes:string[]=[];
  for(const l of cur.lines){
   if(l.startsWith('```')){if(inCode){blocks.push({label,text:buf.join('\n').trim()});buf=[];label='';}inCode=!inCode;continue;}
   if(inCode){buf.push(l);continue;}
   const b=l.match(/^\*\*(.+?)\*\*\s*$/);if(b){label=b[1];continue;}
   const n=l.match(/^_(.+)_\s*$/);if(n)notes.push(n[1]);
  }
  const red=cur.red.toLowerCase(),canal=CANAL[red]||red;
  const gancho=blocks.find(b=>/gancho|texto en pantalla|título/i.test(b.label))?.text||'';
  const texto=(blocks.find(b=>/caption|mensaje|texto|descripción|post|#/i.test(b.label)&&b.text!==gancho)||blocks.find(b=>b.text!==gancho)||blocks[0])?.text||'';
  const n=cur.titulo.match(/^Reel (\d+)\b/);
  const vids=n?reels.filter(f=>f.startsWith(`reel${n[1]}-`)).sort((a,b)=>Number(/corto/.test(a))-Number(/corto/.test(b))):[];
  const id='plan:'+sha(day+'|'+cur.red+'|'+cur.tipo+'|'+cur.titulo);
  out.push({id,fuente:'plan',brand:PLAN_BRAND,marca:BRANDS[PLAN_BRAND]||'',canal,tipo:cur.tipo,fecha:madrid(day,cur.hm),titulo:cur.titulo,gancho,texto,
   nota:notes.join(' '),estado:'plan',detalle:'Del plan',url:'',
   videos:vids.map(f=>({nombre:/corto/.test(f)?'Versión corta':'Vídeo',path:path.join(REELS_DIR,f)})),portadas:[],elegido:0,horaEditable:true,marcable:true});
  cur=null;
 };
 for(const line of md.split('\n')){
  const d=line.match(/^### .*\((\d{4}-\d{2}-\d{2})\)/);
  if(d||/^## /.test(line)){flush();day=d?d[1]:(/^## Semana/.test(line)?day:'');continue;}
  const h=line.match(/^#### ([^·]+?) · ([^·]+?) · (\d{1,2}:\d{2}): (.+)$/);
  if(h){flush();cur={red:h[1].trim(),tipo:h[2].trim(),hm:h[3].padStart(5,'0'),titulo:h[4].trim(),lines:[]};continue;}
  if(cur)cur.lines.push(line);
 }
 flush();
 // «Tú · Revisión» is the owner's own work, not something that goes out
 return out.filter(i=>!['tú','tu','privado'].includes(i.canal));
}

// ---------- finished reels with no date ----------
async function looseReels(known:Set<string>):Promise<Item[]>{
 if(!FV_OUT)return [];
 let dirs:string[]=[];try{dirs=await fs.promises.readdir(FV_OUT);}catch{return [];}
 const out:Item[]=[];
 for(const d of dirs){
  if(known.has(d)||/prueba/.test(d))continue;
  const dir=path.join(FV_OUT,d);let files:string[]=[];try{files=await fs.promises.readdir(dir);}catch{continue;}
  const mp4=files.filter(f=>f.endsWith('.mp4')&&!/\.v\d+\.mp4$/.test(f)&&!/sin-cta/.test(f)).sort();if(!mp4.length)continue;
  const capFile=files.filter(f=>/^caption.*\.txt$/.test(f)).sort((a,b)=>b.localeCompare(a))[0];
  const texto=capFile?await fs.promises.readFile(path.join(dir,capFile),'utf8').catch(()=>''):'';
  const where=(d+'\n'+texto).toLowerCase();
  const brand=MARCAS.find(m=>m.claves.some(c=>where.includes(c))||(m.prefijo&&d.includes('-'+m.prefijo+'-')))?.id||'';
  if(!brand)continue;
  // the caption's first line, unless it is the call to action («Comenta PALABRA…»)
  const titulo=(texto.split('\n').map(l=>l.trim()).filter(Boolean).find(l=>!/^comenta\b/i.test(l))||d.replace(/^\d{4}-\d{2}-\d{2}-full-visual-/,'').replace(/-/g,' ')).slice(0,90);
  out.push({id:'fv:'+d,fuente:'video',brand,marca:BRANDS[brand],canal:'instagram',tipo:'Reel',fecha:null,titulo,gancho:'',texto:texto.trim(),nota:'Hecho por el sistema de contenidos, todavía sin fecha.',
   estado:'sin-fecha',detalle:'Listo, sin fecha',url:'',videos:mp4.map(f=>({nombre:f.replace(/\.mp4$/,''),path:path.join(dir,f)})),
   portadas:files.filter(f=>/^cover.*\.jpg$/.test(f)&&!/\.v\d+\./.test(f)).sort().map(f=>path.join(dir,f)),elegido:0,horaEditable:true,marcable:true});
 }
 return out;
}

/** Covers next to a video (cover-h1.jpg for …-h1.mp4), for the machine's reels too. */
async function addCovers(items:Item[]){
 for(const it of items){
  if(it.portadas.length||!it.videos.length)continue;
  const dir=path.dirname(it.videos[0].path);
  try{const files=await fs.promises.readdir(dir);it.portadas=files.filter(f=>/^cover.*\.jpg$/.test(f)&&!/\.v\d+\./.test(f)).sort().map(f=>path.join(dir,f));}catch{}
 }
}

export async function read(dataDir:string){
 const motivo:string[]=[];
 let maquina:{items:Item[];proyectos:Set<string>}={items:[],proyectos:new Set()};
 try{maquina=machine();if(DB&&!fs.existsSync(DB))motivo.push('No encuentro la base de datos de la máquina de contenido.');}catch(e){motivo.push('No he podido leer la máquina de contenido: '+(e instanceof Error?e.message:String(e)).slice(0,120));}
 let plan:Item[]=[];
 const file=await planFile();
 if(file){let reels:string[]=[];try{reels=(await fs.promises.readdir(REELS_DIR)).filter(f=>f.endsWith('.mp4'));}catch{}
  plan=parsePlan(await fs.promises.readFile(file,'utf8').catch(()=>''),reels);}
 const sueltos=await looseReels(maquina.proyectos);
 const agenda=await readJson<Agenda>(agendaFile(dataDir),{});
 for(const it of [...plan,...sueltos]){
  const a=agenda[it.id];if(!a)continue;
  if(a.fecha){it.fecha=a.fecha;if(it.estado==='sin-fecha'){it.estado='tu';it.detalle='Lo subes tú';}}
  if(a.publicado){it.estado='publicado';it.detalle='Publicado';it.url=a.url||'';}
 }
 const items=[...maquina.items,...plan,...sueltos.filter(i=>!agenda[i.id]?.oculto)];
 await addCovers(items);
 const desde=Date.now()-14*86400_000;
 const visibles=items.filter(i=>!i.fecha||Date.parse(i.fecha)>=desde||i.estado!=='publicado'&&Date.parse(i.fecha)>=Date.now()-30*86400_000)
  .sort((a,b)=>(a.fecha?Date.parse(a.fecha):9e15)-(b.fecha?Date.parse(b.fecha):9e15));
 return {disponible:items.length>0,motivo:motivo.join(' '),plan:file?path.relative(VAULT,file):'',items:visibles,perfiles:await perfiles(dataDir),marcas:marcas()};
}

// ---------- changes ----------
export async function reprogramar(dataDir:string,id:string,fecha:string){
 const t=Date.parse(fecha);if(!Number.isFinite(t))throw new Error('Fecha no válida.');
 const iso=new Date(t).toISOString();
 if(id.startsWith('rf:')){
  const db=open(true);if(!db)throw new Error('No encuentro la máquina de contenido.');
  try{const r=db.prepare("update publications set publish_at=?,updated_at=datetime('now') where id=? and status in ('queued','blocked','failed')").run(iso,Number(id.slice(3)));
   if(!r.changes)throw new Error('Esa publicación ya ha salido hacia PostOnce o está publicada: su hora no se cambia aquí.');}finally{db.close();}
  return {ok:true};
 }
 if(!/^(plan|fv):/.test(id))throw new Error('No sé qué es eso.');
 const a=await readJson<Agenda>(agendaFile(dataDir),{});a[id]={...a[id],fecha:iso};await writeJson(agendaFile(dataDir),a);return {ok:true};
}
export async function ocultar(dataDir:string,id:string){
 if(!id.startsWith('fv:'))throw new Error('Solo se ocultan reels sin fecha.');
 const a=await readJson<Agenda>(agendaFile(dataDir),{});a[id]={...a[id],oculto:true};await writeJson(agendaFile(dataDir),a);return {ok:true};
}
export async function marcar(dataDir:string,id:string,publicado:boolean,url=''){
 url=/^https?:\/\//.test(url)?url.slice(0,500):'';
 if(id.startsWith('rf:')){
  const db=open(true);if(!db)throw new Error('No encuentro la máquina de contenido.');
  try{
   const pub=db.prepare('select u.id,u.piece_id,u.status,p.meta from publications u join pieces p on p.id=u.piece_id where u.id=?').get(Number(id.slice(3))) as any;
   if(!pub)throw new Error('Esa publicación ya no existe.');
   if(pub.status==='sent')throw new Error('Está en PostOnce: se marcará sola cuando salga.');
   if(publicado){
    db.prepare("update publications set status='published',url=coalesce(?,url),error=null,provider=coalesce(provider,'manual'),updated_at=datetime('now') where id=?").run(url||null,pub.id);
    db.prepare("update pieces set status='published',updated_at=datetime('now') where id=?").run(pub.piece_id);
   }else{
    let manual=false;try{manual=JSON.parse(pub.meta||'{}')?.fv?.state==='manual';}catch{}
    db.prepare("update publications set status=?,error=?,updated_at=datetime('now') where id=?").run(manual?'blocked':'queued',manual?'Se publica a mano: la máquina no lo sube':null,pub.id);
    db.prepare("update pieces set status='scheduled',updated_at=datetime('now') where id=?").run(pub.piece_id);
   }
  }finally{db.close();}
  return {ok:true};
 }
 if(!/^(plan|fv):/.test(id))throw new Error('No sé qué es eso.');
 const a=await readJson<Agenda>(agendaFile(dataDir),{});const cur={...a[id]};
 if(publicado){cur.publicado=new Date().toISOString();if(url)cur.url=url;}else{delete cur.publicado;delete cur.url;}
 a[id]=cur;await writeJson(agendaFile(dataDir),a);return {ok:true};
}

// ---------- profiles ----------
// Each account's profiles come from its marca in the configuration; edits are kept per copy in perfiles.json.
const PERFILES:Perfil[]=MARCAS.flatMap(m=>m.perfiles.filter((p:any)=>p&&typeof p.red==='string').map((p:any)=>({brand:m.id,red:p.red,usuario:String(p.usuario||''),nombre:String(p.nombre||m.nombre),bio:String(p.bio||''),enlace:String(p.enlace||''),nota:String(p.nota||'')})));
const perfilesFile=(dataDir:string)=>path.join(workspace(dataDir),'perfiles.json');
export async function perfiles(dataDir:string):Promise<Perfil[]>{
 const saved=await readJson<Perfil[]>(perfilesFile(dataDir),[]);
 return PERFILES.map(p=>({...p,...(saved.find(s=>s.brand===p.brand&&s.red===p.red)||{})}));
}
export async function guardarPerfil(dataDir:string,p:Partial<Perfil>){
 const base=PERFILES.find(x=>x.brand===p.brand&&x.red===p.red);if(!base)throw new Error('Ese perfil no existe.');
 const clean=(s:unknown,n:number)=>String(s??'').slice(0,n);
 const saved=(await readJson<Perfil[]>(perfilesFile(dataDir),[])).filter(s=>!(s.brand===p.brand&&s.red===p.red));
 const next:Perfil={...base,usuario:clean(p.usuario??base.usuario,40).replace(/^@/,''),nombre:clean(p.nombre??base.nombre,64),bio:clean(p.bio??base.bio,160),enlace:clean(p.enlace??base.enlace,300),nota:base.nota};
 saved.push(next);await writeJson(perfilesFile(dataDir),saved);return next;
}

// ---------- media (video and covers), only from the content folders ----------
export async function media(p:string):Promise<{file:string;size:number;type:string}|null>{
 if(!p||!/\.(mp4|mov|jpg|jpeg|png|webp)$/i.test(p))return null;
 let real:string;try{real=await fs.promises.realpath(p);}catch{return null;}
 const roots=await Promise.all(MEDIA_ROOTS().map(r=>fs.promises.realpath(r).catch(()=>'')));
 if(!roots.some(r=>r&&real.startsWith(r+path.sep)))return null;
 const st=await fs.promises.stat(real).catch(()=>null);if(!st?.isFile())return null;
 const ext=path.extname(real).toLowerCase();
 return {file:real,size:st.size,type:ext==='.mp4'?'video/mp4':ext==='.mov'?'video/quicktime':ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg'};
}

// ---------- the day of the plan: 6 Trial Reels and 1 good reel per account ----------
// Trial Reels: one video per slot (10:30, 17:30) with 3 openings, delivered by the content system to Reels/<fecha>/.
// Their state comes from the machine (queued, running, rendered); «subido» and the views of each opening are noted here
// (until they upload and measure themselves); the winner of each account is written next to the videos as ganadores.json,
// where the content system and the owner's iPhone see it, and becomes the next day's good reel.
const PREFIX:Record<string,string>=Object.fromEntries(MARCAS.filter(m=>m.prefijo).map(m=>[m.prefijo,m.id]));
const SLOT_NAME=new RegExp(`^(${Object.keys(PREFIX).join('|')||'(?!)'})-(1030|1730)$`);
const OPENING_NAME=new RegExp(`^(${Object.keys(PREFIX).join('|')||'(?!)'})-(1030|1730)-h[123]$`);
const SLOTS=['1030','1730'];
type DiaNotas={subido?:Record<string,string>;vistas?:Record<string,number>};
const notasFile=(dataDir:string)=>path.join(workspace(dataDir),'dia.json');
export type Apertura={h:string;video:string;texto:string;vistas:number|null};
export type Franja={name:string;brand:string;hora:string;titulo:string;estado:'listo'|'haciendose'|'en-cola'|'sin-video'|'subido';aperturas:Apertura[];subido:string|null};
const validDay=(f:string)=>/^\d{4}-\d{2}-\d{2}$/.test(f);
export async function dia(dataDir:string,fecha:string){
 if(!validDay(fecha))throw new Error('Fecha no válida.');
 const dir=path.join(DAY_DIR,fecha);
 let files:string[]=[];if(DAY_DIR)try{files=await fs.promises.readdir(dir);}catch{}
 const piezas=new Map<string,{titulo:string;estado:string}>();
 const db=open();
 if(db){try{
  for(const r of db.prepare("select title,meta from pieces where json_extract(meta,'$.deliver.date')=?").all(fecha) as any[]){
   let m:any={};try{m=JSON.parse(r.meta||'{}');}catch{}
   if(m.deliver?.name)piezas.set(m.deliver.name,{titulo:r.title||'',estado:m.fv?.state||'queued'});
  }}finally{db.close();}}
 const notas=(await readJson<Record<string,DiaNotas>>(notasFile(dataDir),{}))[fecha]||{};
 const ganadores=DAY_DIR?await readJson<Record<string,{name:string;h:string;titulo:string;vistas:number|null}>>(path.join(dir,'ganadores.json'),{}):{};
 const cuentas=[] as {brand:string;marca:string;franjas:Franja[]}[];
 for(const [pre,brand] of Object.entries(PREFIX)){
  const franjas:Franja[]=[];
  for(const slot of SLOTS){
   const name=`${pre}-${slot}`,p=piezas.get(name);
   const aperturas:Apertura[]=[];
   for(const h of ['h1','h2','h3']){
    const mp4=`${name}-${h}.mp4`;if(!files.includes(mp4))continue;
    const texto=await fs.promises.readFile(path.join(dir,`${name}-${h}.txt`),'utf8').catch(()=>'');
    aperturas.push({h,video:path.join(dir,mp4),texto:texto.trim(),vistas:notas.vistas?.[`${name}-${h}`]??null});
   }
   if(!aperturas.length&&!p)continue;
   const subido=notas.subido?.[name]||null;
   const first=(aperturas[0]?.texto.split('\n').map(l=>l.trim()).find(l=>l&&!/^comenta\b/i.test(l))||name);
   const titulo=p?.titulo||((first.match(/^.{12,80}?[.!?](\s|$)/)?.[0]||first).trim().replace(/[.]$/,'').slice(0,80));
   const estado:Franja['estado']=subido?'subido':aperturas.length?'listo':p?.estado==='running'?'haciendose':p?'en-cola':'sin-video';
   franjas.push({name,brand,hora:slot.slice(0,2)+':'+slot.slice(2),titulo,estado,aperturas,subido});
  }
  cuentas.push({brand,marca:BRANDS[brand],franjas});
 }
 // The good reel at 20:00: whatever the calendar has for that day at 20:00 in Instagram.
 const todo=await read(dataDir);
 const buenos=todo.items.filter(i=>i.fecha&&i.canal==='instagram'&&new Date(i.fecha).toLocaleDateString('sv-SE',{timeZone:TZ})===fecha&&new Date(i.fecha).toLocaleTimeString('es-ES',{timeZone:TZ,hour:'2-digit',minute:'2-digit'})==='20:00');
 return {fecha,cuentas:cuentas.map(c=>({...c,bueno:buenos.find(i=>i.brand===c.brand)||null,ganador:ganadores[c.brand]||null}))};
}
export async function marcarSubido(dataDir:string,fecha:string,name:string,subido:boolean){
 if(!validDay(fecha)||!SLOT_NAME.test(name))throw new Error('Franja no válida.');
 const all=await readJson<Record<string,DiaNotas>>(notasFile(dataDir),{});const d=all[fecha]||{};d.subido={...d.subido};
 if(subido)d.subido[name]=new Date().toISOString();else delete d.subido[name];
 all[fecha]=d;await writeJson(notasFile(dataDir),all);return {ok:true};
}
export async function apuntarVistas(dataDir:string,fecha:string,clave:string,vistas:number|null){
 if(!validDay(fecha)||!OPENING_NAME.test(clave))throw new Error('Apertura no válida.');
 if(vistas!==null&&!(Number.isInteger(vistas)&&vistas>=0&&vistas<1e9))throw new Error('Escribe las visitas como un número.');
 const all=await readJson<Record<string,DiaNotas>>(notasFile(dataDir),{});const d=all[fecha]||{};d.vistas={...d.vistas};
 if(vistas===null)delete d.vistas[clave];else d.vistas[clave]=vistas;
 all[fecha]=d;await writeJson(notasFile(dataDir),all);return {ok:true};
}
/** The proposed winner of an account for a day: the opening with most views among its Trial Reels. */
export function propuesto(c:{franjas:Franja[]}){
 let best:{name:string;h:string;titulo:string;vistas:number}|null=null;
 for(const f of c.franjas)for(const a of f.aperturas)if(a.vistas!=null&&(!best||a.vistas>best.vistas))best={name:f.name,h:a.h,titulo:f.titulo,vistas:a.vistas};
 return best;
}
export async function elegirGanador(dataDir:string,fecha:string,brand:string,name:string,h:string){
 if(!DAY_DIR)throw new Error('La carpeta de los vídeos del día no está configurada.');
 if(!validDay(fecha)||!BRANDS[brand]||!SLOT_NAME.test(name)||!/^h[123]$/.test(h)||PREFIX[name.split('-')[0]]!==brand)throw new Error('Ganador no válido.');
 const d=await dia(dataDir,fecha),f=d.cuentas.find(c=>c.brand===brand)?.franjas.find(x=>x.name===name),a=f?.aperturas.find(x=>x.h===h);
 if(!f||!a)throw new Error('Ese vídeo no está en la carpeta del día.');
 const file=path.join(DAY_DIR,fecha,'ganadores.json'),g=await readJson<Record<string,unknown>>(file,{});
 g[brand]={name,h,titulo:f.titulo,vistas:a.vistas,video:path.basename(a.video),elegido:new Date().toISOString(),por:profile.load().name};
 await writeJson(file,g);return {ok:true};
}
