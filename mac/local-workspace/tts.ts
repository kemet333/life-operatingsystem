// Alfred's speaking voice: ElevenLabs, one request per sentence, streamed back to the page.
// The key is never stored by this app: macOS Keychain first (service "alfred-elevenlabs"),
// then the existing course config the owner already keeps with chmod 600.
import {rutas,texto} from './config';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import * as secretos from './secretos';

// Optional .env files that may hold ELEVENLABS_API_KEY (configuracion.json → voz.archivosClave), after the Keychain.
const COURSE_ENV=rutas('voz.archivosClave')[0]||'';
// "Alfred · Jarvis" (J6): a voice designed for the owner in ElevenLabs, saved in his account on 04/10/2026.
// eleven_v3 is the model it was designed with and the one the owner preferred by ear (closer than turbo,
// at roughly a second more per sentence). Switch to eleven_turbo_v2_5 in alfred-voice.json for speed.
// The voice comes from configuracion.json (voz.id); without one, a stock ElevenLabs voice everyone has.
const DEFAULTS={voiceId:texto('voz.id','JBFqnCBsd6RMkjVDRZzb'),model:texto('voz.modelo','eleven_v3'),stability:0.5,similarity:0.85,style:0.2,speed:1};
// Candidates in order; one that ElevenLabs rejects (401) is dropped for the rest of the session.
let keys:string[]|undefined;

function keychain():Promise<string|null>{return secretos.leer('alfred-elevenlabs');}
// Where the key came from (never the key itself), for the voice log: macOS can block ~/Documents for a rebuilt app.
let source='sin buscar';
// The course file is in ~/Documents: if macOS is still asking for permission, give up after 3 s and try again
// on the next sentence instead of freezing the voice.
let blocked=false;
async function courseKey(){
 if(!COURSE_ENV)return null;
 const read=fs.promises.readFile(COURSE_ENV,'utf8').then(text=>{const line=text.split('\n').find(l=>l.startsWith('ELEVENLABS_API_KEY='));return line?line.slice(19).trim().replace(/^["']|["']$/g,'')||null:null;})
  .catch((e:any)=>{source='archivo ilegible ('+(e?.code||'error')+')';return null;});
 let timer:ReturnType<typeof setTimeout>|undefined;
 const late=new Promise<null>(r=>{timer=setTimeout(()=>{blocked=true;source='archivo bloqueado (macOS pide permiso para Documentos)';r(null);},3000);});
 blocked=false;
 try{return await Promise.race([read,late]);}finally{clearTimeout(timer);}
}
async function candidates(){
 if(!keys){const own=await keychain(),course=own?null:await courseKey();const found=[own,course].filter((k,i,all):k is string=>!!k&&all.indexOf(k)===i);
  source=own?'llavero':course?'archivo del curso':source==='sin buscar'?'ninguna':source;note('clave: '+source);
  if(found.length||!blocked)keys=found;else return found;}
 return keys;
}

// A small local log of how the voice behaves (latency, failures, fallbacks), never the key or the audio.
const LOG=path.join(process.env.LIFE_OS_DATA_DIR||'','voz.log');
export function note(line:string){
 if(!process.env.LIFE_OS_DATA_DIR)return;
 try{if(fs.existsSync(LOG)&&fs.statSync(LOG).size>256_000)fs.renameSync(LOG,LOG+'.1');fs.appendFileSync(LOG,new Date().toISOString().slice(0,19)+' '+line.replace(/\s+/g,' ').slice(0,300)+'\n');}catch{}
}
export function keySource(){return source;}

// Optional overrides in the data folder: {"voiceId":"…","model":"eleven_flash_v2_5","speed":1}
function settings(){
 try{const file=path.join(process.env.LIFE_OS_DATA_DIR||'','alfred-voice.json');return {...DEFAULTS,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch{return DEFAULTS;}
}

export async function ready(){return (await candidates()).length>0;}

// The Creator plan allows 5 concurrent requests; keep 3 for Alfred (the course scripts share the key)
// and retry when ElevenLabs answers "concurrent_limit_exceeded".
const LIMIT=3;let active=0;const waiting:(()=>void)[]=[];
async function slot(){while(active>=LIMIT)await new Promise<void>(r=>waiting.push(r));active++;}
function release(){active--;waiting.shift()?.();}
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,ms);signal.addEventListener('abort',()=>{clearTimeout(t);reject(signal.reason);},{once:true});});

// Phrases that repeat (the ritual greeting) are kept on disk: instant, and no characters spent twice.
const CACHE=path.join(process.env.LIFE_OS_DATA_DIR||'','voz-cache');
function cached(text:string,s:typeof DEFAULTS){return path.join(CACHE,createHash('sha256').update(JSON.stringify([s,text])).digest('hex').slice(0,32)+'.mp3');}

/** One sentence as a complete MP3. Sentences are small, so the slot is held only while it downloads.
 *  Each request gets 15 s: a hung request must never freeze Alfred mid-reply. */
export async function synthesize(text:string,signal:AbortSignal,keep=false):Promise<Buffer>{
 const s=settings(),file=keep&&process.env.LIFE_OS_DATA_DIR?cached(text,s):null;
 if(file)try{const hit=fs.readFileSync(file);note(`tts caché ${text.length} car.`);return hit;}catch{}
 const started=Date.now();
 await slot();
 try{
  for(let attempt=0;attempt<6;attempt++){
   const secret=(await candidates())[0];if(!secret){note('tts sin clave ('+source+')');throw Error('sin-clave');}
   const r=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.voiceId)}/stream?output_format=mp3_44100_128`,{
    method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(15_000)]),
    headers:{'xi-api-key':secret,'Content-Type':'application/json',Accept:'audio/mpeg'},
    body:JSON.stringify({text,model_id:s.model,voice_settings:{stability:s.stability,similarity_boost:s.similarity,style:s.style,speed:s.speed}}),
   });
   if(r.status===401){note('tts 401: clave rechazada o sin caracteres');keys=keys?.filter(k=>k!==secret);continue;}
   if(r.status===429){await pause(300*(attempt+1),signal);continue;}
   if(!r.ok){note(`tts error ${r.status} ${text.length} car.`);throw Error('tts-'+r.status);}
   const audio=Buffer.from(await r.arrayBuffer());
   note(`tts ok ${text.length} car. ${Date.now()-started} ms${attempt?` (${attempt} reintentos)`:''}`);
   if(file)try{fs.mkdirSync(CACHE,{recursive:true});fs.writeFileSync(file,audio);}catch{}
   return audio;
  }
  note('tts sin hueco tras 6 intentos (límite de ElevenLabs)');throw Error('tts-reintentos');
 }catch(e:any){if(e?.name==='TimeoutError')note(`tts tiempo agotado ${text.length} car.`);throw e;}
 finally{release();}
}
