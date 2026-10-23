import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
// Manual smoke test of Alfred's voice brain. It talks to Claude for real, so it uses plan usage:
//   node build-server.mjs && node voice-smoke.mjs
const server=new URL('./dist/server.mjs',import.meta.url).pathname;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alfred-voice-'));
const child=spawn(process.execPath,[server],{env:{...process.env,LIFE_OS_DATA_DIR:dir,LIFE_OS_DISABLE_BRIDGE:'1'},stdio:['pipe','pipe','inherit']});
const ready=await new Promise((res,rej)=>{let b='';child.stdout.on('data',d=>{b+=d;const m=b.match(/^READY (.+)$/m);if(m)res(JSON.parse(m[1]));});child.on('exit',()=>rej(Error('exit')));});
const boot=await fetch(ready.origin+'/?native=1',{headers:{'X-Life-Launch':ready.bootstrapToken}});const cookie=boot.headers.get('set-cookie').split(';')[0];
const H={Cookie:cookie,Origin:ready.origin,'Content-Type':'application/json'};
const t0=Date.now();const ts=()=>((Date.now()-t0)/1000).toFixed(1)+'s';
async function talk(text,onPermission){
  const r=await fetch(ready.origin+'/api/voice',{method:'POST',headers:H,body:JSON.stringify({id:'test-'+Math.random().toString(36).slice(2,10),text})});
  const reader=r.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {value,done}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const e=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);
    if(e.t==='say')console.log(ts(),'SAY',JSON.stringify(e.text),e.directions.length?e.directions:'');
    else if(e.t==='permission'){console.log(ts(),'PERMISSION',e.what,'|',e.detail.slice(0,80));await onPermission?.(e);}
    else if(e.t==='usage')console.log(ts(),'USAGE',JSON.stringify(e.usage));
    else console.log(ts(),e.t.toUpperCase(),(e.v||(e.allowed??'')),e.message||'');}}
}
console.log('--- 1: dirección de interfaz');
await talk('Enséñame mi proyecto principal y dime en una frase cuál es su siguiente paso.');
console.log('--- 2: acción con permiso (se deniega)');
await talk('Crea un archivo de texto llamado alfred-prueba.txt en '+dir+' que diga hola.',async e=>{const a=await fetch(ready.origin+'/api/voice/permission',{method:'POST',headers:H,body:JSON.stringify({id:e.id,allow:false,reason:'no, mejor no lo crees'})});console.log(ts(),'answered',(await a.json()).ok);});
console.log('file exists?',fs.existsSync(path.join(dir,'alfred-prueba.txt')));
const office=await (await fetch(ready.origin+'/api/office',{headers:{Cookie:cookie}})).json();
console.log('messages stored:',office.messages.map(m=>m.author+':'+m.source+':'+m.text.slice(0,40)));
child.stdin.end();setTimeout(()=>process.exit(0),500);
