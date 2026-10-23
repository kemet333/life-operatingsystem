// The page's native bridge, as the Mac app offers it (window.webkit.messageHandlers.*), so the interface runs unchanged:
//   nativeSpeech        {action:'speak',id,text} | {action:'stop',id}  → alfred:native-speech {state,id[,reason]}
//   nativeDictation     {action:'start'|'stop'|'cancel'}               → alfred:native-dictation {state[,text,reason]}, alfred:native-mic {level}
//   nativeVoiceActivity {active}                                        (nothing to do here: no clap detector)
// Speech uses the system voices; push-to-talk records 16 kHz mono WAV in memory and the local server transcribes it with
// Whisper on this computer (/api/dictado). Events are dispatched in the page's own world, so their detail reaches it.
const {contextBridge,ipcRenderer,webFrame}=require('electron');

const local=()=>location.protocol==='http:'&&(location.hostname==='127.0.0.1'||location.hostname==='localhost');
function emit(name,detail){
 if(!local())return;
 webFrame.executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(name)},{detail:${JSON.stringify(detail)}}))`);
}

// ---------- speech ----------

let speakingId=null;
function pickVoice(){
 const voices=speechSynthesis.getVoices();
 return voices.find(v=>v.lang==='es-ES'&&/jorge|pablo|alvaro|enrique/i.test(v.name))||voices.find(v=>v.lang==='es-ES')||voices.find(v=>v.lang.startsWith('es'))||null;
}
const nativeSpeech={postMessage(m){
 if(!m||typeof m.id!=='string'||!/^[\w-]{1,80}$/.test(m.id))return;
 if(m.action==='stop'){if(speakingId===m.id){speechSynthesis.cancel();}return;}
 if(m.action!=='speak'||typeof m.text!=='string'||!m.text.trim())return emit('alfred:native-speech',{state:'unavailable',id:m.id,reason:'invalid-request'});
 speechSynthesis.cancel();
 const u=new SpeechSynthesisUtterance(m.text.slice(0,4000));u.lang='es-ES';u.rate=1;const v=pickVoice();if(v)u.voice=v;
 const id=m.id;speakingId=id;
 u.onstart=()=>emit('alfred:native-speech',{state:'speaking',id});
 u.onend=()=>{if(speakingId===id)speakingId=null;emit('alfred:native-speech',{state:'idle',id});};
 u.onerror=e=>{if(speakingId===id)speakingId=null;emit('alfred:native-speech',e.error==='interrupted'||e.error==='canceled'?{state:'idle',id}:{state:'unavailable',id,reason:String(e.error||'error')});};
 speechSynthesis.speak(u);
}};

// ---------- push-to-talk ----------

let rec=null;   // {stream, ctx, node, chunks, rate, timer}
function wav(chunks,rate){
 const len=chunks.reduce((n,c)=>n+c.length,0),ratio=rate/16000,out=new Int16Array(Math.floor(len/ratio));
 let idx=0;const all=new Float32Array(len);for(const c of chunks){all.set(c,idx);idx+=c.length;}
 for(let o=0;o<out.length;o++){const s=all[Math.min(len-1,Math.floor(o*ratio))];out[o]=Math.max(-1,Math.min(1,s))*0x7fff;}
 const buf=new ArrayBuffer(44+out.length*2),d=new DataView(buf);
 const w=(off,str)=>{for(let k=0;k<str.length;k++)d.setUint8(off+k,str.charCodeAt(k));};
 w(0,'RIFF');d.setUint32(4,36+out.length*2,true);w(8,'WAVE');w(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
 d.setUint32(24,16000,true);d.setUint32(28,32000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,'data');d.setUint32(40,out.length*2,true);
 new Int16Array(buf,44).set(out);
 return buf;
}
async function start(){
 if(rec)return;
 try{
  const info=await fetch('/api/dictado',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
  if(!info.disponible)return emit('alfred:native-dictation',{state:'unavailable',reason:'Para dictar hace falta Whisper en este ordenador. Mientras, escribe.'});
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  const ctx=new AudioContext(),src=ctx.createMediaStreamSource(stream),node=ctx.createScriptProcessor(4096,1,1),chunks=[];
  node.onaudioprocess=e=>{const c=e.inputBuffer.getChannelData(0);chunks.push(new Float32Array(c));let s=0;for(const x of c)s+=x*x;emit('alfred:native-mic',{level:Math.min(1,Math.sqrt(s/c.length)*4)});};
  src.connect(node);node.connect(ctx.destination);
  rec={stream,ctx,node,chunks,rate:ctx.sampleRate,timer:setTimeout(stop,120000)};
  emit('alfred:native-dictation',{state:'listening'});
 }catch(e){rec=null;emit('alfred:native-dictation',{state:'unavailable',reason:'No puedo usar el micrófono.'});}
}
function close(){const r=rec;rec=null;if(!r)return null;clearTimeout(r.timer);try{r.node.disconnect();r.stream.getTracks().forEach(t=>t.stop());r.ctx.close();}catch{}return r;}
async function stop(){
 const r=close();if(!r)return;
 if(r.chunks.length<3)return emit('alfred:native-dictation',{state:'idle'});
 emit('alfred:native-dictation',{state:'partial',text:'…'});
 try{
  const res=await fetch('/api/dictado',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav(r.chunks,r.rate)});
  const j=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(j.error||'No he podido transcribirlo.');
  emit('alfred:native-dictation',j.texto?{state:'final',text:j.texto}:{state:'idle'});
 }catch(e){emit('alfred:native-dictation',{state:'unavailable',reason:e.message});}
}
const nativeDictation={postMessage(m){
 const a=m&&m.action;
 if(a==='start')start();else if(a==='stop')stop();else if(a==='cancel'){close();emit('alfred:native-dictation',{state:'idle'});}
}};

contextBridge.exposeInMainWorld('webkit',{messageHandlers:{nativeSpeech,nativeDictation,nativeVoiceActivity:{postMessage(){}}}});
contextBridge.exposeInMainWorld('alfredEscritorio',{plataforma:process.platform,elegirCarpeta:titulo=>ipcRenderer.invoke('elegir-carpeta',titulo)});
