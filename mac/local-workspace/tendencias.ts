// Tendencias: a read-only window onto the content machine's database (what works on X, Instagram, TikTok and YouTube
// for each configured account, plus an optional «radar» of foreign markets) and onto its reports in the vault. Nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {VAULT} from './cartera';
import {ruta} from './config';
import {BRANDS as CUENTAS} from './contenido';

const DB=ruta('contenido.maquina','LIFE_OS_RF_DB');
const REPORT_DIRS=['01-Projects/Contenido/Oportunidades','01-Projects/Contenido/Tendencias'];
export const BRANDS:Record<string,string>={...CUENTAS,radar:'De fuera'};
const PLATFORMS=['tiktok','instagram','youtube','x','douyin','xiaohongshu'];
// Cover image of each piece, as the scraper stored it (TikTok and Instagram links are signed and expire in days).
const THUMB_SQL=`case platform when 'tiktok' then coalesce(json_extract(raw,'$.videoMeta.coverUrl'),json_extract(raw,'$.videoMeta.originalCoverUrl')) when 'instagram' then json_extract(raw,'$.displayUrl') when 'youtube' then json_extract(raw,'$.thumbnailUrl') when 'x' then json_extract(raw,'$.extendedEntities.media[0].media_url_https') when 'douyin' then json_extract(raw,'$.video_cover_url') when 'xiaohongshu' then json_extract(raw,'$.cover_url') end`;

function profile(platform:string,author:string,id?:string|null){
 if(platform==='douyin')return id?'https://www.douyin.com/user/'+encodeURIComponent(id):'https://www.douyin.com/search/'+encodeURIComponent(String(author||''));
 if(platform==='xiaohongshu')return id?'https://www.xiaohongshu.com/user/profile/'+encodeURIComponent(id):'https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent(String(author||''));
 const a=String(author||'').trim();if(!a)return '';
 if(/^https?:\/\//.test(a))return a;
 const h=a.replace(/^@/,'');
 if(platform==='tiktok')return 'https://www.tiktok.com/@'+encodeURIComponent(h);
 if(platform==='instagram')return 'https://www.instagram.com/'+encodeURIComponent(h)+'/';
 if(platform==='x')return 'https://x.com/'+encodeURIComponent(h);
 if(platform==='youtube')return /\s/.test(h)?'https://www.youtube.com/results?search_query='+encodeURIComponent(h):'https://www.youtube.com/@'+encodeURIComponent(h);
 return '';
}

function perDay(views:number,posted:string|null,scraped:string){
 const from=Date.parse(posted||''),to=Date.parse((scraped||'').replace(' ','T')+'Z');
 if(!Number.isFinite(from)||!Number.isFinite(to)||!views)return 0;
 return Math.round(views/Math.max(1,(to-from)/86400000));
}

async function reports(){
 const out:{title:string;path:string;updated:number;kind:string}[]=[];
 for(const dir of REPORT_DIRS){
  if(!VAULT)break;
  try{for(const f of await fs.promises.readdir(path.join(VAULT,dir))){if(!f.endsWith('.md'))continue;const rel=path.join(dir,f),st=await fs.promises.stat(path.join(VAULT,rel));
   out.push({title:f.replace(/\.md$/,''),path:rel,updated:st.mtimeMs,kind:dir.endsWith('Oportunidades')?'oportunidades':'informe'});}}catch{/* not there yet */}
 }
 return out.sort((a,b)=>(a.kind===b.kind?0:a.kind==='oportunidades'?-1:1)||b.updated-a.updated).slice(0,40);
}

export async function read(params:URLSearchParams){
 const brand=BRANDS[params.get('brand')||'']?params.get('brand')!:'',platform=PLATFORMS.includes(params.get('platform')||'')?params.get('platform')!:'';
 const q=(params.get('q')||'').trim().slice(0,80).toLowerCase(),days=Math.min(365,Math.max(1,Number(params.get('days'))||60));
 const informes=await reports();
 if(!fs.existsSync(DB))return {disponible:false,motivo:'Todavía no hay datos de la máquina de tendencias en este ordenador.',marcas:[],piezas:[],cuentas:[],informes};
 const db=new DatabaseSync(DB,{readOnly:true});
 try{
  const where=['score is not null',"coalesce(posted_at, scraped_at) >= datetime('now', ?)"],args:any[]=[`-${days} days`];
  if(brand){where.push('brand = ?');args.push(brand);}
  if(platform){where.push('platform = ?');args.push(platform);}
  if(q){where.push("lower(coalesce(hook,'') || ' ' || coalesce(title,'') || ' ' || coalesce(caption,'') || ' ' || coalesce(author,'') || ' ' || coalesce(format,'')) like ?");args.push('%'+q+'%');}
  const rows=db.prepare(`select id,brand,platform,kind,url,author,author_followers,views,likes,comments,shares,score,format,faceless,hook,title,
   substr(caption,1,600) caption,substr(transcript,1,900) transcript,posted_at,scraped_at,niche,status,
   case platform when 'douyin' then json_extract(raw,'$.author.sec_uid') when 'xiaohongshu' then json_extract(raw,'$.author_user_id') end autor_id,
   ${THUMB_SQL} thumb_url from scraped where ${where.join(' and ')}
   order by score desc limit 200`).all(...args) as any[];
  const piezas=rows.map(r=>({...r,marca:BRANDS[r.brand]||r.brand,perfil:profile(r.platform,r.author,r.autor_id),autor_id:undefined,thumb_url:undefined,thumb:!!r.thumb_url,vistas_dia:perDay(r.views,r.posted_at,r.scraped_at),faceless:r.faceless==null?null:!!r.faceless}));
  const cuentas=Object.values(piezas.reduce((acc:any,p:any)=>{const k=p.platform+':'+(p.author||'');if(!p.author)return acc;
   const c=acc[k]||(acc[k]={autor:p.author,platform:p.platform,marca:p.marca,perfil:p.perfil,seguidores:p.author_followers||0,piezas:0,mejor:0,mejor_url:'',mejor_hook:'',vistas:[] as number[]});
   c.piezas++;c.vistas.push(p.views||0);if(p.score>c.mejor){c.mejor=p.score;c.mejor_url=p.url;c.mejor_hook=p.hook||p.title||'';}return acc;},{}))
   .map((c:any)=>{const v=c.vistas.sort((a:number,b:number)=>a-b);return {...c,vistas:undefined,vistas_mediana:v[Math.floor(v.length/2)]||0};})
   .sort((a:any,b:any)=>b.mejor-a.mejor).slice(0,120);
  const marcas=(db.prepare(`select brand, count(*) n, max(scraped_at) ultimo from scraped group by brand`).all() as any[])
   .map(m=>({id:m.brand,nombre:BRANDS[m.brand]||m.brand,n:m.n,ultimo:m.ultimo}));
  return {disponible:true,marcas,piezas,cuentas,informes,ventana:days};
 }finally{db.close();}
}

// Thumbnails for the carousel: fetched once and kept in the data folder, because the signed TikTok and
// Instagram links die within days. TikTok gets a fresh cover from its public oEmbed when the stored one is dead;
// a dead piece is remembered for a day so it is not retried on every view.
const THUMBS=path.join(process.env.LIFE_OS_DATA_DIR||os.tmpdir(),'miniaturas');
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
async function download(url:string):Promise<{type:string;data:Buffer}|null>{
 try{const r=await fetch(url,{headers:{'User-Agent':UA,Accept:'image/*'},signal:AbortSignal.timeout(8000)});
  const type=r.headers.get('content-type')||'',data=Buffer.from(await r.arrayBuffer());
  return r.ok&&type.startsWith('image/')&&data.length<=3_000_000?{type,data}:null;}catch{return null;}
}
async function tiktokCover(page:string){
 if(!/^https:\/\/(www\.)?tiktok\.com\//.test(page))return '';
 try{const r=await fetch('https://www.tiktok.com/oembed?url='+encodeURIComponent(page),{headers:{'User-Agent':UA},signal:AbortSignal.timeout(6000)});return r.ok?String(((await r.json()) as any).thumbnail_url||''):'';}catch{return '';}
}
export async function thumbnail(idRaw:string):Promise<{type:string;data:Buffer}|null>{
 const id=Number(idRaw);if(!Number.isInteger(id)||id<1)return null;
 const file=path.join(THUMBS,id+'.img'),dead=path.join(THUMBS,id+'.none');
 try{const data=await fs.promises.readFile(file);return {type:data[0]===0x52?'image/webp':data[0]===0x89?'image/png':'image/jpeg',data};}catch{}
 try{if(Date.now()-(await fs.promises.stat(dead)).mtimeMs<86_400_000)return null;}catch{}
 if(!fs.existsSync(DB))return null;
 const db=new DatabaseSync(DB,{readOnly:true});let row:any=null;
 try{row=db.prepare(`select platform,url page,${THUMB_SQL} u from scraped where id=?`).get(id);}finally{db.close();}
 await fs.promises.mkdir(THUMBS,{recursive:true});
 const stored=String(row?.u||''),fresh=row?.platform==='tiktok'?await tiktokCover(String(row?.page||'')):'';
 for(const candidate of [stored,fresh].filter(u=>/^https:\/\//.test(u))){
  const got=await download(candidate);if(got){await fs.promises.writeFile(file,got.data);return got;}
 }
 await fs.promises.writeFile(dead,'').catch(()=>{});return null;
}
/** Keep covers of recent pieces while their signed links are alive (Instagram has no public way to renew them). */
export async function warmThumbnails(days=7){
 if(!fs.existsSync(DB))return 0;
 const db=new DatabaseSync(DB,{readOnly:true});let ids:number[]=[];
 try{ids=(db.prepare(`select id from scraped where score is not null and scraped_at >= datetime('now', ?) order by score desc limit 300`).all(`-${days} days`) as any[]).map(r=>r.id);}finally{db.close();}
 let got=0;for(let i=0;i<ids.length;i+=4){const batch=await Promise.all(ids.slice(i,i+4).map(id=>thumbnail(String(id))));got+=batch.filter(Boolean).length;}
 return got;
}
