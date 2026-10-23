import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openDatabase} from './database.mjs';
import {state,operate,write} from '../../alfred-os/lib/alfred-store';
import * as voice from './voice';
import * as tts from './tts';
import * as telegram from './telegram';
import * as cartera from './cartera';
import * as tendencias from './tendencias';
import * as contenido from './contenido';
import {ruta} from './config';
import * as profile from './profile';
import * as configurar from './configurar';
import * as secretos from './secretos';
import {PROJECT,experimentoArgs} from './equipo-acciones';
import {setPortfolio} from '../../alfred-os/lib/alfred-data';
import {chat} from '../../alfred-os/lib/alfred-chat';

process.umask(0o077);
const directory=process.env.LIFE_OS_DATA_DIR;
if(!directory||!path.isAbsolute(directory))throw Error('Falta la carpeta local del espacio.');
const root=path.dirname(fileURLToPath(import.meta.url)),clientRoot=path.join(root,'client');
let database:ReturnType<typeof openDatabase>;
const launchToken=randomBytes(32).toString('base64url'),session=randomBytes(32).toString('base64url'),bridgeToken=randomBytes(32).toString('base64url');
let origin='',closing=false,bridge:any=null,bridgeState='starting',lastSnapshot=0;
// The agent team engine (configuracion.json → equipo); the app only reads its status and relays the owner's explicit
// decisions (approve the batch, pause, resume, plan now). Not configured → the team views say it is not installed.
const EQUIPO_PY=configurar.python(),EQUIPO=configurar.motor();
function equipo(args:string[],timeout=60000){return new Promise<string>((resolve,reject)=>{const p=spawn(EQUIPO_PY,[EQUIPO,...args],{stdio:['ignore','pipe','ignore']});let out='';const t=setTimeout(()=>{p.kill();reject(Error('El equipo no responde.'));},timeout);p.stdout.on('data',d=>out+=d);p.on('error',e=>{clearTimeout(t);reject(e);});p.on('close',code=>{clearTimeout(t);code===0?resolve(out):reject(Error('El equipo ha devuelto un error.'));});});}
let queue=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const run=queue.then(fn);queue=run.then(()=>{},()=>{});return run;}
function equal(a:unknown,b:string){if(typeof a!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
function send(res:http.ServerResponse,code:number,body:unknown){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
function authenticated(req:http.IncomingMessage){const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim());return cookies.some(c=>c.startsWith('life_local=')&&equal(c.slice(12),session));}
async function body(req:http.IncomingMessage){let size=0;const chunks=[];for await(const piece of req){size+=piece.length;if(size>262144)throw Error('La petición es demasiado grande.');chunks.push(piece);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function eligible(id:string){return !!database.sqlite.prepare('SELECT 1 FROM local_admissions WHERE id=?').get(id);}
function admit(id:unknown){if(typeof id==='string')database.sqlite.prepare('INSERT OR IGNORE INTO local_admissions VALUES (?,?)').run(id,Date.now());}
async function visibleState(){const data=await state();if(data.snapshot){data.snapshot={...data.snapshot,bridge:{...(data.snapshot.bridge||{}),analysisEnabled:bridgeState==='ready',activeRequest:lastSnapshot&&bridgeState==='ready'?data.snapshot.bridge?.activeRequest:null}};}
 const entries=data.entries.map((entry:any)=>!eligible(entry.id)&&['queued','dispatching','linked'].includes(entry.status)?{...entry,localOriginalStatus:entry.status,status:'parked',result:'Histórico de la copia web. Este encargo no se ejecuta en la sesión local.'}:entry);
 return {...data,entries,local:{storage:'mac',cloudSync:false,bridge:bridgeState}};}
async function bridgeCall(m:any){
 if(m.method!=='tools/call')throw Error('Método local no disponible.');const args=m.params?.arguments||{};
 let result;
 if(m.params?.name==='alfred_get_office')result=await visibleState();
 else if(m.params?.name==='alfred_bridge'){
  if(args.action==='pending')result={requests:database.sqlite.prepare("SELECT entries.* FROM entries JOIN local_admissions ON entries.id=local_admissions.id WHERE kind IN ('request','conversation') AND status='queued' ORDER BY entries.created_at LIMIT 1").all()};
  else if(args.action==='claim'){
   if(!eligible(args.id))result={entry:null};
   else result={entry:database.sqlite.prepare("UPDATE entries SET status='dispatching',updated_at=? WHERE id=? AND status='queued' AND EXISTS (SELECT 1 FROM local_admissions WHERE id=entries.id) AND NOT EXISTS (SELECT 1 FROM entries e JOIN local_admissions a ON a.id=e.id WHERE e.status IN ('dispatching','linked')) RETURNING *").get(Date.now(),args.id)||null};
  }else if(args.action==='snapshot'){result=await operate(args,true);lastSnapshot=Date.now();bridgeState=args.snapshot?.bridge?.analysisEnabled===true?'ready':'unavailable';}
  else if(args.action==='update'&&eligible(args.id))result=await operate(args,true);
  else throw Error('Operación del puente no disponible.');
 }else throw Error('Herramienta local no disponible.');
 return {jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:false}};
}
const server=http.createServer(async(req,res)=>{
 try{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!==new URL(origin).host)return send(res,403,{error:'Destino local no permitido.'});
  if(req.headers.origin&&req.headers.origin!==origin)return send(res,403,{error:'Origen no permitido.'});
  if(['cross-site','same-site'].includes(req.headers['sec-fetch-site'] as string))return send(res,403,{error:'Origen no permitido.'});
  const url=new URL(req.url||'/',origin);
  const isBridge=url.pathname==='/api/bridge';
  if(isBridge){if(!equal(req.headers.authorization,'Bearer '+bridgeToken))return send(res,401,{error:'Puente no autorizado.'});if(req.method!=='POST')return send(res,405,{error:'Método no permitido.'});const m=await body(req);return send(res,200,await serial(()=>bridgeCall(m)));}
  if(req.method==='GET'&&url.pathname==='/'&&equal(req.headers['X-Life-Launch'],launchToken))res.setHeader('Set-Cookie',`life_local=${session}; HttpOnly; SameSite=Strict; Path=/`);
  else if(!authenticated(req))return send(res,401,{error:'Abre este espacio desde la app.'});
  if(url.pathname==='/api/perfil'&&req.method==='GET')return send(res,200,profile.publicView());
  if(url.pathname==='/api/vault'&&req.method==='GET'){const f=await cartera.folder(url.searchParams.get('dir')||'');return f?send(res,200,f):send(res,404,{error:'Carpeta no disponible.'});}
  if(url.pathname==='/api/vault/recientes'&&req.method==='GET')return send(res,200,{notas:await cartera.recent()});
  if(url.pathname==='/api/nota'&&req.method==='GET'){const n=await cartera.note(url.searchParams.get('path')||'');return n?send(res,200,{...n,vault:cartera.VAULT}):send(res,404,{error:'Nota no disponible.'});}
  if(url.pathname==='/api/contenido/dia'&&req.method==='GET'){try{return send(res,200,await contenido.dia(directory!,url.searchParams.get('fecha')||''));}catch(e){return send(res,400,{error:e instanceof Error?e.message:String(e)});}}
  if(url.pathname==='/api/contenido'&&req.method==='GET'){try{return send(res,200,await contenido.read(directory!));}catch(e){return send(res,500,{error:'No se ha podido leer el contenido: '+(e instanceof Error?e.message:String(e)).slice(0,200)});}}
  if(url.pathname==='/api/contenido'&&req.method==='POST'){
   try{const m=await body(req);
    if(m.accion==='hora')return send(res,200,await contenido.reprogramar(directory!,String(m.id||''),String(m.fecha||'')));
    if(m.accion==='publicado')return send(res,200,await contenido.marcar(directory!,String(m.id||''),m.publicado!==false,String(m.url||'')));
    if(m.accion==='ocultar')return send(res,200,await contenido.ocultar(directory!,String(m.id||'')));
    if(m.accion==='subido')return send(res,200,await contenido.marcarSubido(directory!,String(m.fecha||''),String(m.name||''),m.subido!==false));
    if(m.accion==='vistas')return send(res,200,await contenido.apuntarVistas(directory!,String(m.fecha||''),String(m.clave||''),m.vistas===''||m.vistas==null?null:Number(m.vistas)));
    if(m.accion==='ganador')return send(res,200,await contenido.elegirGanador(directory!,String(m.fecha||''),String(m.brand||''),String(m.name||''),String(m.h||'')));
    if(m.accion==='perfil')return send(res,200,await contenido.guardarPerfil(directory!,m.perfil||{}));
    return send(res,400,{error:'Acción desconocida.'});
   }catch(e){return send(res,400,{error:e instanceof Error?e.message:String(e)});}
  }
  if(url.pathname==='/api/contenido/media'&&req.method==='GET'){
   const f=await contenido.media(url.searchParams.get('p')||'');if(!f)return send(res,404,{error:'Archivo no disponible.'});
   const range=/^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range||''));
   if(range&&(range[1]||range[2])){
    let start=range[1]?Number(range[1]):Math.max(0,f.size-Number(range[2])),end=range[1]&&range[2]?Number(range[2]):f.size-1;
    end=Math.min(end,f.size-1);if(start>end||start>=f.size){res.writeHead(416,{'Content-Range':`bytes */${f.size}`});return res.end();}
    res.writeHead(206,{'Content-Type':f.type,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${f.size}`,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'});
    return void fs.createReadStream(f.file,{start,end}).pipe(res);
   }
   res.writeHead(200,{'Content-Type':f.type,'Content-Length':f.size,'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'});
   return void fs.createReadStream(f.file).pipe(res);
  }
  if(url.pathname==='/api/tendencias/miniatura'&&req.method==='GET'){const img=await tendencias.thumbnail(url.searchParams.get('id')||'');if(!img)return send(res,404,{error:'Sin miniatura.'});res.writeHead(200,{'Content-Type':img.type,'Content-Length':img.data.length,'Cache-Control':'private, max-age=86400'});return res.end(img.data);}
  if(url.pathname==='/api/tendencias'&&req.method==='GET'){try{return send(res,200,await tendencias.read(url.searchParams));}catch(e){return send(res,500,{error:'No se han podido leer las tendencias: '+(e instanceof Error?e.message:String(e)).slice(0,200)});}}
  if(url.pathname==='/api/cartera'&&req.method==='GET'){const list=await cartera.read();setPortfolio(list);return send(res,200,{fuente:list.length?'obsidian':'integrada',carpeta:cartera.CARTERA,proyectos:list});}
  if(url.pathname==='/api/office'&&req.method==='GET')return send(res,200,await serial(visibleState));
  if(url.pathname==='/api/office'&&req.method==='POST'){
   if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req);if(['snapshot','pending','claim'].includes(input.action))return send(res,403,{error:'Acción reservada al equipo.'});
   const result=await serial(()=>database.transaction(async()=>{const r:any=await operate(input,false);if((input.action==='create'&&input.kind==='request')||input.action==='prepare')admit(r.id);if(input.action==='update'&&input.status==='queued')admit(input.id);if(input.action==='revise')admit(input.id);return r;}));return send(res,200,result);
  }
  if(url.pathname==='/api/chat'&&req.method==='POST'){
   if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req);const result=await serial(()=>database.transaction(async()=>{const r:any=await chat(input);if(!r.duplicate)admit(r.requestId);return r;}));return send(res,200,result);
  }
  if(url.pathname==='/api/dictado'){
   // Push-to-talk in the desktop app outside macOS: a 16 kHz mono WAV, transcribed here with Whisper, then deleted.
   if(req.method==='GET')return send(res,200,{disponible:telegram.canTranscribe()});
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['content-type']!=='audio/wav')return send(res,403,{error:'Origen no permitido.'});
   const chunks:Buffer[]=[];let size=0;
   for await(const piece of req){size+=piece.length;if(size>20_000_000)return send(res,413,{error:'La grabación es demasiado larga.'});chunks.push(piece);}
   const audio=Buffer.concat(chunks);
   if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')return send(res,400,{error:'Audio no válido.'});
   const dir=path.join(directory,'tmp');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'dictado-'+randomUUID()+'.wav');
   try{fs.writeFileSync(file,audio,{mode:0o600});return send(res,200,{texto:await telegram.transcribeFile(file)});}
   catch(e){return send(res,500,{error:e instanceof Error?e.message:'No he podido transcribirlo.'});}
   finally{fs.rmSync(file,{force:true});}
  }
  if(url.pathname==='/api/configurar'){
   if(req.method==='GET')return send(res,200,await configurar.estado(url.searchParams.get('fresco')==='1'));
   if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req);let r:any;
   if(input.accion==='perfil')r=configurar.guardarPerfil(input);
   else if(input.accion==='sesion'){configurar.iniciarSesion();r={ok:true};}
   else if(input.accion==='notas')r=configurar.guardarNotas(input);
   else if(input.accion==='proyecto')r=await configurar.anadirProyecto(input);
   else if(input.accion==='quitar-proyecto')r=configurar.quitarProyecto(input);
   else if(input.accion==='servicio')r=await configurar.servicio(input);
   else if(input.accion==='reiniciar'){send(res,200,{ok:true});setTimeout(()=>process.exit(configurar.REINICIAR),300);return;}
   else return send(res,400,{error:'Acción no válida.'});
   return send(res,r.error?400:200,r.error?r:{...r,estado:await configurar.estado()});
  }
  if(url.pathname==='/api/equipo'){
   if(!fs.existsSync(EQUIPO))return send(res,404,{error:'El equipo no está instalado en este Mac.'});
   if(req.method==='GET')return send(res,200,JSON.parse(await equipo(['status'],120000)));
   if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req),project=String(input.project||'');
   if(project&&!PROJECT.test(project))return send(res,400,{error:'Proyecto no válido.'});
   if(input.action==='approve'&&project){const only=Array.isArray(input.only)&&input.only.every((n:unknown)=>Number.isInteger(n)&&(n as number)>=0&&(n as number)<10)?['--only',input.only.join(',')]:[];await equipo(['approve',project,...only]);}
   else if(input.action==='pause'||input.action==='resume')await equipo([input.action]);
   else if(input.action==='mensaje'){const para=String(input.para||'alfred'),texto=typeof input.texto==='string'?input.texto.trim().slice(0,1200):'';if(!['alfred','radar','product','studio','business','control','todos'].includes(para)||!texto)return send(res,400,{error:'Escribe el mensaje y elige a quién.'});const re_=typeof input.responde_a==='string'&&/^M\d{1,6}$/.test(input.responde_a)?['--responde-a',input.responde_a]:[];await equipo(['mensaje',para,'--texto',texto,...re_]);}
   else if(input.action==='decidir'&&project&&input.indice!==undefined){const n=Number(input.indice),d=String(input.decision||'');if(!Number.isInteger(n)||n<0||n>99||!['si','no','luego'].includes(d))return send(res,400,{error:'Decisión no válida.'});await equipo(['decidir',project,'--indice',String(n),'--decision',d]);}
   else if(input.action==='fusionar'&&project){spawn(EQUIPO_PY,[EQUIPO,'fusionar',project],{stdio:'ignore',detached:true}).unref();}   // tests first; the result arrives by Telegram
   else if(input.action==='plan'){spawn(EQUIPO_PY,[EQUIPO,'plan',...(project?[project]:[])],{stdio:'ignore',detached:true}).unref();}
   else if(input.action==='lanzado'||input.action==='resultado'||input.action==='descartar'||input.action==='decidir'){const r=experimentoArgs(input);if('error' in r)return send(res,400,{error:r.error});await equipo(r.args);}
   else return send(res,400,{error:'Acción del equipo no válida.'});
   return send(res,200,JSON.parse(await equipo(['status'])));
  }
  if(url.pathname==='/api/telegram'){
   if(req.method==='GET')return send(res,200,telegram.status());
   if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req);
   if(input.action==='token'){
    const t=typeof input.token==='string'?input.token.trim():'';
    if(!/^\d+:[A-Za-z0-9_-]{30,}$/.test(t))return send(res,400,{error:'Ese no parece un token de bot (número:letras, te lo da @BotFather).'});
    if(!await secretos.guardar('alfred-telegram',t))return send(res,500,{error:'No se ha podido guardar en el llavero del sistema.'});
    return send(res,200,{...telegram.status(),guardado:true});
   }
   return send(res,200,telegram.control(String(input.action)));
  }
  if(url.pathname.startsWith('/api/voice')){
   if(url.pathname==='/api/voice/status'&&req.method==='GET')return send(res,200,{...voice.status(),tts:await tts.ready(),clave:tts.keySource()});
   if(req.method!=='POST'||req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json'))return send(res,403,{error:'Origen no permitido.'});
   const input=await body(req);
   if(url.pathname==='/api/voice/permission')return send(res,200,{ok:voice.answer(String(input.id),input.allow===true,typeof input.reason==='string'?input.reason.slice(0,500):undefined)});
   if(url.pathname==='/api/voice/control')return send(res,200,await voice.control(String(input.action)));
   // The page reports what the Mac cannot see from here: a fallback to the Mac's voice, a stuck player.
   if(url.pathname==='/api/voice/log'){tts.note('página: '+String(input.event||'').slice(0,200));return send(res,200,{ok:true});}
   if(url.pathname==='/api/voice/tts'){
    const said=typeof input.text==='string'?input.text.trim().slice(0,1200):'';if(!said)return send(res,400,{error:'Sin texto.'});
    const ctrl=new AbortController();res.on('close',()=>ctrl.abort());
    try{const audio=await tts.synthesize(said,ctrl.signal,input.cache===true&&said.length<=400);res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length,'Cache-Control':'no-store'});return res.end(audio);}
    catch(e){if(!res.headersSent)return send(res,503,{error:e instanceof Error?e.message:'tts'});return res.end();}
   }
   if(url.pathname!=='/api/voice')return send(res,404,{error:'No encontrado.'});
   const id=typeof input.id==='string'&&/^[A-Za-z0-9-]{8,80}$/.test(input.id)?input.id:randomUUID(),text=typeof input.text==='string'?input.text.trim().slice(0,4000):'';
   if(!text)return send(res,400,{error:'Dime algo para empezar.'});
   // NDJSON stream: one event per line, so the client can speak each sentence as it lands.
   res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
   const emit=(e:voice.VoiceEvent)=>{if(!res.writableEnded)res.write(JSON.stringify(e)+'\n');};
   let finished=false;res.on('close',()=>{if(!finished)void voice.interrupt();});
   await serial(()=>write('message:'+id+':user',{id,author:'user',text,at:Date.now(),source:'voz'}));
   try{const reply=await voice.speak(id,text,emit);finished=true;if(reply)await serial(()=>write('message:'+id+':assistant',{id,author:'assistant',text:reply,at:Date.now(),source:'claude'}));emit({t:'done',text:reply});}
   catch{finished=true;emit({t:'error',message:'No he podido abrir la sesión de Claude. Comprueba que tu cuenta sigue conectada.'});}
   return res.end();
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,{error:'Método no permitido.'});
  const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const file=path.resolve(clientRoot,requested);
  if(!file.startsWith(clientRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return send(res,404,{error:'No encontrado.'});
  const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':file.endsWith('.html')?'no-store':'private, max-age=31536000, immutable'});if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
 }catch(e){if(!res.headersSent)send(res,400,{error:e instanceof Error?e.message:'No se ha podido guardar.'});else res.end();}
});
// Quit fast: once the HTTP server and the bridge are gone, exit at once. The app may be reopened seconds later and two
// servers must never share the database. The timer is only a backstop for a bridge that ignores SIGTERM.
function stop(){if(closing)return;closing=true;
 const finish=()=>{try{if(bridge?.pid&&bridge.exitCode===null)process.kill(-bridge.pid,'SIGKILL');}catch{}try{database?.close();}catch{}process.exit(0);};
 try{telegram.stop();}catch{}try{voice.shutdown();}catch{}
 const bridgeDone=new Promise<void>(r=>{if(!bridge?.pid||bridge.exitCode!==null)return r();bridge.once('exit',()=>r());try{bridge.stdin.end();process.kill(-bridge.pid,'SIGTERM');}catch{r();}});
 const httpDone=new Promise<void>(r=>{server.close(()=>r());(server as any).closeAllConnections?.();});
 Promise.all([bridgeDone,httpDone]).then(finish);setTimeout(finish,2500).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);process.stdin.resume();process.stdin.on('end',stop);
const configPath=path.join(directory,'runtime.json');let port=0;if(fs.existsSync(configPath)){const config=JSON.parse(fs.readFileSync(configPath,'utf8'));if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('Configuración local inválida.');port=config.port;}
server.on('error',()=>{console.error('No se pudo abrir el espacio local. Comprueba que no haya otra instancia.');process.exit(1);});
server.listen(port,'127.0.0.1',async()=>{
 try{
 const address=server.address() as any;origin=`http://127.0.0.1:${address.port}`;
 // Bind the persisted port before touching the database: a second app instance
 // cannot mistake the first instance's active work for an interrupted session.
 database=openDatabase(directory);(globalThis as any).__lifeLocalDB=database.DB;
 database.importInitial(path.join(directory,'initial-import.json'));
 const interrupted=database.sqlite.prepare("SELECT e.id FROM entries e JOIN local_admissions a ON a.id=e.id WHERE e.status IN ('dispatching','linked')").all();
 for(const entry of interrupted)await operate({action:'update',id:entry.id,status:'blocked',result:'La sesión anterior terminó durante el análisis. No se ha vuelto a ejecutar. Puedes enviar una nueva petición cuando quieras.'},true);
 fs.writeFileSync(configPath,JSON.stringify({port:address.port}),{mode:0o600});
 process.stdout.write('READY '+JSON.stringify({origin,bootstrapToken:launchToken})+'\n');
 // Trend covers: save the recent ones while their signed links are alive (after READY, never blocking start-up).
 setTimeout(()=>{void tendencias.warmThumbnails().catch(()=>{});setInterval(()=>void tendencias.warmThumbnails().catch(()=>{}),6*3600_000).unref();},60_000).unref();
 // The live portfolio lives in ~/Documents: read it after READY, never in the way of the app starting.
 void cartera.read().then(list=>{if(list.length)setPortfolio(list);}).catch(()=>{});
 // Alfred por Telegram: the same brain and permissions; idle until the owner stores the bot token in the Keychain.
 if(process.env.LIFE_OS_DISABLE_TELEGRAM!=='1')telegram.start({dataDir:directory,equipo,remember:(id,author,text)=>serial(()=>write('message:'+id+':'+author,{id,author,text,at:Date.now(),source:author==='user'?'telegram':'claude'}))});
 if(process.env.LIFE_OS_DISABLE_BRIDGE==='1'){bridgeState='disabled';return;}
 const python=ruta('puente.python','LIFE_OS_PUENTE_PY');
 if(!python||!fs.existsSync(python)){bridgeState='unavailable';return;}
 bridge=spawn(python,['-B',path.join(root,'local-bridge.py')],{cwd:root,env:{...process.env,LIFE_OS_DATA_DIR:directory},stdio:['pipe','ignore','pipe'],detached:true});
 bridge.stdin.on('error',()=>{});bridge.stderr.on('data',()=>{});bridge.on('error',()=>{bridgeState='unavailable';});bridge.on('exit',()=>{bridgeState='unavailable';lastSnapshot=0;});
 bridge.stdin.write(JSON.stringify({url:origin,token:bridgeToken})+'\n');
 }catch{console.error('No se pudo preparar la copia local. Los datos existentes se conservan.');server.close();process.exit(1);}
});
