// Client side of Alfred's voice brain (local Mac app only; the web copy has no /api/voice).
export type VoiceUsage={status:string;fiveHour?:number;sevenDay?:number;resetsAt?:number};
export type VoiceStatus={available:boolean;deep:boolean;warm:boolean;usage:VoiceUsage|null;tts?:boolean;model?:string};
export type VoiceEvent=
 |{t:'state';v:'thinking'|'tool'}
 |{t:'step';text:string}
 |{t:'model';model:string;deep:boolean}
 |{t:'say';text:string;directions:string[]}
 |{t:'permission';id:string;what:string;detail:string}
 |{t:'permission-closed';id:string;allowed:boolean}
 |{t:'usage';usage:VoiceUsage}
 |{t:'done';text:string}
 |{t:'error';message:string};

const json={'Content-Type':'application/json'};
export async function voiceStatus():Promise<VoiceStatus|null>{try{const r=await fetch('/api/voice/status',{cache:'no-store'});if(!r.ok)return null;const j=await r.json() as VoiceStatus;return j?.available?j:null;}catch{return null;}}
export async function voiceControl(action:'warm'|'interrupt'|'clear'|'deep'|'fast'):Promise<VoiceStatus|null>{try{const r=await fetch('/api/voice/control',{method:'POST',headers:json,body:JSON.stringify({action})});return r.ok?await r.json() as VoiceStatus:null;}catch{return null;}}
export async function voiceAnswer(id:string,allow:boolean,reason?:string){try{await fetch('/api/voice/permission',{method:'POST',headers:json,body:JSON.stringify({id,allow,reason})});}catch{}}

export async function voiceTurn(id:string,text:string,signal:AbortSignal,onEvent:(e:VoiceEvent)=>void){
 const r=await fetch('/api/voice',{method:'POST',headers:json,body:JSON.stringify({id,text}),signal});
 if(!r.ok||!r.body){const j:any=await r.json().catch(()=>({}));throw new Error(j.error||'Alfred no está disponible ahora.');}
 const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';
 for(;;){
  const {value,done}=await reader.read();if(done)break;
  buffer+=decoder.decode(value,{stream:true});let line;
  while((line=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,line).trim();buffer=buffer.slice(line+1);if(raw)onEvent(JSON.parse(raw));}
 }
}

// Exact spoken phrases, compared without accents or punctuation.
const norm=(t:string)=>t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9ñ ]/g,' ').replace(/\s+/g,' ').trim();
const CONSOLE:Record<'deep'|'fast'|'clear'|'usage',string[]>={
 deep:['modo profundo','piensa a fondo'],
 fast:['modo rapido','vuelve al modo rapido'],
 clear:['nueva conversacion','limpia la conversacion','empieza de cero'],
 usage:['informe de uso','cuanto plan me queda','uso del plan'],
};
export function consoleVerb(text:string){const n=norm(text);return (Object.keys(CONSOLE) as (keyof typeof CONSOLE)[]).find(v=>CONSOLE[v].includes(n))||null;}
const YES=['si','vale','adelante','hazlo','dale','claro','venga','ok','okay','confirmo','si adelante','si hazlo','si claro','si dale','si por favor'];
export function isYes(text:string){return YES.includes(norm(text));}
export function wantsDetails(text:string){return ['detalles','detalle','dime los detalles','que comando'].includes(norm(text));}
export function spokenUsage(u:VoiceUsage|null|undefined){
 if(!u||u.fiveHour===undefined)return 'Todavía no tengo datos de uso de esta sesión. Pregúntamelo después de la primera respuesta.';
 const pct=(v?:number)=>Math.round((v||0)*100);
 return `Llevas un ${pct(u.fiveHour)} por ciento de tu límite de cinco horas${u.sevenDay!==undefined?` y un ${pct(u.sevenDay)} por ciento del semanal`:''}.`;
}

// Neural voice player: every sentence is fetched as soon as it lands (prefetch) and played in order,
// so the next one is ready when the current one ends. The orb follows the real loudness.
type PlayerHooks={state:(s:'speaking'|'idle')=>void;level:(v:number)=>void;fail:(text:string,why:string)=>void};
/** One line in the Mac's voice log (Workspace/voz.log): what went wrong, never what was said. */
export function voiceLog(event:string){void fetch('/api/voice/log',{method:'POST',headers:json,body:JSON.stringify({event})}).catch(()=>{});}
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class VoicePlayer{
 private ctx:AudioContext|null=null;private analyser:AnalyserNode|null=null;private input:AudioNode|null=null;private current:AudioBufferSourceNode|null=null;
 private items:{text:string;audio:Promise<AudioBuffer|null>;ctrl:AbortController;why:{v:string}}[]=[];
 private watchdog=0;
 private playing=false;private frame=0;private generation=0;
 constructor(private hooks:PlayerHooks){}
 private context(){
  if(!this.ctx){
   const Context=window.AudioContext||(window as any).webkitAudioContext,ctx:AudioContext=new Context();this.ctx=ctx;
   this.analyser=ctx.createAnalyser();this.analyser.fftSize=512;this.analyser.connect(ctx.destination);
   // Jarvis finish: trim the low end, a touch of digital presence and an 18 ms room slap, all subtle.
   const low=ctx.createBiquadFilter();low.type='highpass';low.frequency.value=140;
   const presence=ctx.createBiquadFilter();presence.type='peaking';presence.frequency.value=4200;presence.Q.value=1.4;presence.gain.value=2;
   const slap=ctx.createDelay(0.1);slap.delayTime.value=0.018;const slapLevel=ctx.createGain();slapLevel.gain.value=0.08;
   low.connect(presence);presence.connect(this.analyser);presence.connect(slap);slap.connect(slapLevel);slapLevel.connect(this.analyser);
   this.input=low;
  }
  if(this.ctx.state==='suspended')void this.ctx.resume();
  return this.ctx;
 }
 /** Call from a user gesture (talk key, send) so the audio context may start. */
 unlock(){this.context();}
 get busy(){return this.playing;}
 /** A sentence that fails is asked for once more before the reply falls back to the Mac's voice;
  *  each try gets 20 s, so a hung request can never freeze Alfred. `cache` keeps repeated phrases (the ritual). */
 enqueue(text:string,cache=false){
  const ctx=this.context(),ctrl=new AbortController(),why={v:''};
  const once=async()=>{const timer=setTimeout(()=>ctrl.abort(),20_000);
   try{const r=await fetch('/api/voice/tts',{method:'POST',headers:json,body:JSON.stringify({text,cache}),signal:ctrl.signal});
    if(!r.ok){why.v='tts '+r.status+' '+((await r.json().catch(()=>({}))) as any).error;return null;}
    return await ctx.decodeAudioData(await r.arrayBuffer());}
   catch(e){why.v=ctrl.signal.aborted?'tiempo agotado o cancelada':'audio no decodificable';return null;}
   finally{clearTimeout(timer);}};
  const audio=once().then(b=>(b||ctrl.signal.aborted)?b:once());
  this.items.push({text,audio,ctrl,why});if(!this.playing)void this.next();
 }
 private async next(){
  const generation=this.generation,item=this.items.shift();
  if(!item){this.playing=false;cancelAnimationFrame(this.frame);this.hooks.level(0);this.hooks.state('idle');return;}
  this.playing=true;
  const buffer=await item.audio;if(generation!==this.generation)return;
  // A suspended audio context plays nothing and never ends: wake it, or hand the reply to the Mac's voice.
  const ctx=this.context();if(buffer&&ctx.state!=='running'){await Promise.race([ctx.resume().catch(()=>{}),wait(1500)]);if(generation!==this.generation)return;}
  if(!buffer||ctx.state!=='running'){const why=buffer?'audio del navegador bloqueado ('+ctx.state+')':item.why.v||'sin audio';
   const rest=[item.text,...this.items.map(i=>i.text)].join(' ');this.items.forEach(i=>i.ctrl.abort());this.items=[];this.playing=false;this.hooks.state('idle');this.hooks.fail(rest,why);return;}
  const source=ctx.createBufferSource();source.buffer=buffer;source.connect(this.input!);this.current=source;
  const ended=()=>{clearTimeout(this.watchdog);if(this.current===source){this.current=null;void this.next();}};
  source.onended=ended;
  // If the system never reports the end (device change, sleep), move on a moment after it should have finished.
  clearTimeout(this.watchdog);this.watchdog=window.setTimeout(()=>{if(this.current===source){voiceLog('frase sin final; sigo con la siguiente');try{source.stop();}catch{}ended();}},buffer.duration*1000+1500);
  this.hooks.state('speaking');source.start();this.meter();
 }
 private meter(){
  cancelAnimationFrame(this.frame);const analyser=this.analyser;if(!analyser)return;const data=new Uint8Array(analyser.fftSize);
  const tick=()=>{analyser.getByteTimeDomainData(data);let sum=0;for(const v of data){const x=(v-128)/128;sum+=x*x;}this.hooks.level(Math.min(1,Math.sqrt(sum/data.length)*3.2));if(this.playing)this.frame=requestAnimationFrame(tick);};
  tick();
 }
 stop(){
  this.generation++;clearTimeout(this.watchdog);this.items.forEach(i=>i.ctrl.abort());this.items=[];
  const source=this.current;this.current=null;try{source?.stop();}catch{}
  const was=this.playing;this.playing=false;cancelAnimationFrame(this.frame);this.hooks.level(0);if(was)this.hooks.state('idle');
 }
}
