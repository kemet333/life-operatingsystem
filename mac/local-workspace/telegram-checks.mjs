// Telegram bridge checks against a fake Telegram API: linking needs the app's code, strangers are ignored,
// team shortcuts read the engine and buttons act only for the linked chat. Alfred's brain is not called.
import http from 'node:http';
import fs from 'node:fs';
import {execFile as execFileCb} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL } from 'node:url';
import {createRequire} from 'node:module';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(process.env.LIFE_OS_DEPS_DIR?path.join(process.env.LIFE_OS_DEPS_DIR,'package.json'):path.resolve(root,'../../alfred-os/package.json'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'telegram-checks-'));
// This copy's own configuration (config.ts reads it on import): the Mac's Whisper model, when installed, and the names it must get right.
process.env.LIFE_OS_DATA_DIR=dir;
fs.writeFileSync(path.join(dir,'configuracion.json'),JSON.stringify({whisper:{modelo:path.join(process.env.HOME||'','Library/Application Support/com.lifeoperatingsystem.app/modelos/ggml-large-v3-turbo-q5_0.bin'),vocabulario:'Alfred, Beta Labs, Alfa Studio.'}}));
const bundle=path.join(dir,'telegram.mjs');
await require('esbuild').build({entryPoints:[path.join(root,'telegram.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node26',external:['@anthropic-ai/claude-agent-sdk'],logLevel:'warning'});

const TOKEN='123456:'+'a'.repeat(35),sent=[],calls=[];let pending=[],nextId=1,waiter=null;
const answers=[];let failReplyMarkup=false,failedReplyMarkups=0;
const fake=http.createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;const input=body?JSON.parse(body):{};
 const method=req.url.split('/').pop();calls.push(method);
 const reply=result=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,result}));};
 if(!req.url.startsWith('/bot'+TOKEN+'/'))return reply(null);
 if(method==='answerCallbackQuery')answers.push(input);
 if(method==='editMessageReplyMarkup'&&failReplyMarkup){
  failedReplyMarkups++;
  res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:false,description:'Cannot edit reply markup'}));
 }
 if(method==='getMe')return reply({username:'alfred_prueba_bot'});
 if(method==='getUpdates'){
  if(pending.length){const u=pending;pending=[];return reply(u);}
  return void (waiter=()=>{const u=pending;pending=[];waiter=null;reply(u);});
 }
 if(method==='sendMessage'){sent.push({...input,_id:nextId});return reply({message_id:nextId++});}
 reply(true);
});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
process.env.LIFE_OS_TELEGRAM_TEST_API=`http://127.0.0.1:${fake.address().port}/bot`;
process.env.LIFE_OS_TELEGRAM_TEST_TOKEN=TOKEN;

const engine=[];
const status={fecha:'2026-10-05',pausado:false,proyectos:{alfa:{nombre:'Alfa Studio',tareas:[{id:'a',titulo:'Hecha antes',estado:'hecha',hora:'02:14'},{id:'b',titulo:'Prueba E2E',estado:'trabajando'}],trabajando:[{titulo:'Prueba E2E'}],pendientes:[1,2],hechas:[1],bloqueadas:[],lote:{estado:'pendiente',tareas:[{titulo:'Uno'},{titulo:'Dos'}]}}},mesa:{reunion:{resumen:'Todo en orden',acuerdos:[{titulo:'Acuerdo A'}]},mensajes:[{id:'M1',de:'control',para:['owner'],tipo:'pregunta',texto:'¿Aceptas X?'},{id:'M2',de:'radar',para:['owner'],tipo:'aviso',texto:'Un aviso que no es pregunta'}],departamentos:{control:'Control'}},hermes:{tableros:[],programadas:[]}};
const tg=await import(pathToFileURL(bundle).href);
tg.start({dataDir:dir,equipo:async args=>{engine.push(args.join(' '));return JSON.stringify(status);},remember:async()=>{}});

let update=1;
const push=u=>{pending.push({update_id:update++,...u});waiter?.();};
const msg=(text,from=42,chat=42,type='private')=>push({message:{text,from:{id:from,first_name:'Ana'},chat:{id:chat,type}}});
const settle=async(ms=300)=>new Promise(r=>setTimeout(r,ms));
const ok=(cond,name)=>{console.log((cond?'PASS ':'FAIL ')+name);if(!cond)process.exitCode=1;};

await settle(500);
ok(tg.status().estado==='sin-vincular'&&/^\d{6}$/.test(tg.status().codigo),'without a link the app shows a 6-digit code');
const code=tg.status().codigo;
msg('hola');await settle();
ok(sent.at(-1)?.text.includes('código de 6 cifras')&&tg.status().estado==='sin-vincular','a stranger is told the bot is private');
msg('/vincular '+code,42,-100,'group');await settle();
ok(tg.status().estado==='sin-vincular','a group chat cannot link even with the right code');
msg('/vincular 000000');await settle();
ok(tg.status().estado==='sin-vincular','a wrong code does not link');
msg('/vincular '+code);await settle();
ok(tg.status().estado==='vinculado'&&JSON.parse(fs.readFileSync(path.join(dir,'telegram.json'),'utf8')).chatId===42,'the right code links this chat and saves it');
ok((fs.statSync(path.join(dir,'telegram.json')).mode&0o777)===0o600,'the link file is private to the user');
const before=sent.length;
msg('/equipo',99,99);await settle();
ok(sent.length===before,'once linked, any other chat is ignored without a reply');
msg('/equipo');await settle();
ok(sent.at(-1)?.text.includes('✓ Hecha antes (02:14)')&&sent.at(-1).text.includes('▶ Prueba E2E'),'/equipo lists each task as done, working or queued');
msg('/lote');await settle();
const batchMsg=sent.at(-1);
ok(batchMsg?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data==='a:alfa','/lote offers an approve button per pending batch');
push({callback_query:{id:'c1',data:'a:alfa',from:{id:99},message:{message_id:5,chat:{id:42}}}});await settle();
ok(!engine.includes('approve alfa'),'a button tap from someone else does nothing');
push({callback_query:{id:'c2',data:'a:alfa',from:{id:42},message:{message_id:5,chat:{id:42}}}});await settle();
ok(engine.includes('approve alfa'),'the owner\'s tap approves that batch');
push({callback_query:{id:'c3',data:'a:../x',from:{id:42},message:{message_id:5,chat:{id:42}}}});await settle();
status.proyectos.alfa.por_fusionar=2;status.proyectos.alfa.mejoras=['Un reel listo para publicar hoy','Contador de visitas propio'];status.proyectos.alfa.lote.estado='aprobado';
msg('/lote');await settle();
ok(sent.at(-1)?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data==='f:alfa'&&sent.at(-1).text.includes('2 mejoras terminadas'),'/lote offers a merge button when team work is ready to merge');
ok(sent.at(-1).text.includes('\n• Un reel listo para publicar hoy\n• Contador de visitas propio'),'the merge message says in plain words what each improvement is');
push({callback_query:{id:'c4',data:'f:alfa',from:{id:99},message:{message_id:6,chat:{id:42}}}});await settle();
ok(!engine.includes('fusionar alfa'),'a merge tap from someone else does nothing');
push({callback_query:{id:'c5',data:'f:alfa',from:{id:42},message:{message_id:6,chat:{id:42}}}});await settle();
ok(engine.includes('fusionar alfa'),'the owner\'s tap runs the nightly merge for that project');
status.proyectos.alfa.por_fusionar=0;status.proyectos.alfa.lote.estado='pendiente';
ok(!engine.some(a=>a.includes('../x')),'a malformed project id is rejected');
// A finished experiment nobody has launched: /lote offers «Ya lo he lanzado» and the owner's tap writes the launch down.
status.tablero=[{id:'t_036cee09',fuente:'equipo',proyecto:'alfa',titulo:'Anuncio de prueba',columna:'para-ti',lanzamiento:{que:'Un anuncio',a_quien:'Mi lista',metrica:'Clics',umbral:'10 clics'}},{id:'t_ya_lanzado',fuente:'equipo',proyecto:'alfa',titulo:'Ya en marcha',columna:'para-ti',lanzamiento:{que:'Q',a_quien:'A',metrica:'M',umbral:'U'},lanzado:'2026-10-17T10:00:00'}];
msg('/lote');await settle();
const launchMsg=sent.at(-1);
ok(launchMsg?.text.startsWith('Alfa Studio — listo para lanzar: «Anuncio de prueba»')&&launchMsg.text.includes('Umbral: 10 clics')&&launchMsg.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data==='l:t_036cee09'&&!sent.some(m=>m.text.includes('Ya en marcha')),'/lote offers a launch button for each experiment not launched yet');
push({callback_query:{id:'l1',data:'l:t_036cee09',from:{id:99},message:{message_id:7,chat:{id:42}}}});await settle();
ok(!engine.some(a=>a.startsWith('lanzado t_036cee09')),'a launch tap from someone else does nothing');
push({callback_query:{id:'l2',data:'l:t_036cee09',from:{id:42},message:{message_id:7,chat:{id:42}}}});await settle();
ok(engine.includes('lanzado t_036cee09 --via telegram'),'the owner\'s tap writes the launch down (and that it was from Telegram)');
push({callback_query:{id:'l3',data:'l:../x',from:{id:42},message:{message_id:7,chat:{id:42}}}});await settle();
ok(!engine.some(a=>a.startsWith('lanzado ')&&!a.startsWith('lanzado t_036cee09 ')),'a malformed experiment id is rejected');
// A launched experiment waiting for its result: /lote offers «Apuntar lo medido», the tap asks with force_reply and the owner's reply is written down.
status.tablero=[{id:'t_medir',fuente:'equipo',proyecto:'alfa',titulo:'Anuncio medible',columna:'hecho',lanzamiento:{que:'Un anuncio',a_quien:'Mi lista',metrica:'Clics',umbral:'10 clics'},lanzado:'2026-10-10T10:00:00',fase:'falta medir'}];
msg('/lote');await settle();
const measureMsg=sent.at(-1);
ok(measureMsg?.text.startsWith('Alfa Studio — falta medir: «Anuncio medible»')&&measureMsg.text.includes('Métrica: Clics')&&measureMsg.text.includes('Umbral: 10 clics')&&measureMsg.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data==='m:t_medir','/lote offers a measure button for each launched experiment not measured yet');
const sentBeforeAsk=sent.length;
push({callback_query:{id:'m1',data:'m:t_medir',from:{id:99},message:{message_id:8,chat:{id:42}}}});await settle();
ok(sent.length===sentBeforeAsk,'a measure tap from someone else does nothing');
push({callback_query:{id:'m2',data:'m:t_medir',from:{id:42},message:{message_id:8,chat:{id:42}}}});await settle();
const askMsg=sent.at(-1);
ok(sent.length===sentBeforeAsk+1&&askMsg.reply_markup?.force_reply===true&&askMsg.text.includes('¿Qué mediste en «Anuncio medible»?'),'the owner\'s tap asks what he measured with a forced reply');
const reply=(text,to)=>push({message:{text,from:{id:42,first_name:'Ana'},chat:{id:42,type:'private'},reply_to_message:{message_id:to}}});
reply('poco',askMsg._id);await settle();
ok(!engine.some(a=>a.startsWith('resultado ')),'a reply of fewer than 10 characters does not reach the engine');
reply('Medí 12 clics en 3 días y salió bien.',askMsg._id);await settle();
const decisionMsg=sent.at(-1),beforeDecision=engine.length;
ok(engine.includes('resultado alfa --texto Medí 12 clics en 3 días y salió bien. --experimento t_medir')&&decisionMsg?.text==='Apuntado el resultado de «Anuncio medible». ¿Qué decides?'&&JSON.stringify(decisionMsg.reply_markup?.inline_keyboard)==='[[{"text":"Seguir","callback_data":"e:seguir:t_medir"},{"text":"Cambiar","callback_data":"e:cambiar:t_medir"},{"text":"Parar","callback_data":"e:parar:t_medir"}]]','a result without a decision offers Seguir, Cambiar and Parar');
push({callback_query:{id:'d1',data:'e:seguir:t_medir',from:{id:99},message:{message_id:decisionMsg._id,chat:{id:42}}}});await settle();
ok(engine.length===beforeDecision,'a decision tap from someone else does not call the engine');
push({callback_query:{id:'d2',data:'e:seguir:t_medir',from:{id:42},message:{message_id:decisionMsg._id,chat:{id:99}}}});await settle();
ok(engine.length===beforeDecision,'a decision tap in another chat does not call the engine');
push({callback_query:{id:'d3',data:'e:seguir:t_medir',from:{id:42},message:{message_id:decisionMsg._id,chat:{id:42}}}});await settle();
ok(engine.length===beforeDecision+1&&engine.at(-1)==='decidir t_medir --decision seguir','the owner\'s decision tap records seguir for the measured experiment');
// Keep the original confirmation check for the fallback when the task id is too long for decision buttons.
const measuredId=status.tablero[0].id;
status.tablero[0].id='a'.repeat(80);
push({message:{text:'Medí 12 clics en 3 días y salió bien.',from:{id:42},chat:{id:42,type:'private'},reply_to_message:{message_id:99999,text:askMsg.text}}});await settle();
ok(engine.at(-1)==='resultado alfa --texto Medí 12 clics en 3 días y salió bien. --experimento '+'a'.repeat(80)&&!sent.at(-1)?.reply_markup,'a long task id records the result and sends the confirmation without buttons');
status.tablero[0].id=measuredId;
ok(engine.includes('resultado alfa --texto Medí 12 clics en 3 días y salió bien. --experimento t_medir')&&sent.at(-1)?.text==='Apuntado el resultado de «Anuncio medible». Si empiezas por «seguir», «cambiar» o «parar», el equipo sabrá qué hacer después.','the owner\'s reply to that message writes the result down for that experiment');
// Starting the reply with «parar» also tells the engine what the owner decides.
push({callback_query:{id:'m3',data:'m:t_medir',from:{id:42},message:{message_id:8,chat:{id:42}}}});await settle();
const askMsg2=sent.at(-1);
reply('Parar: medí 0 clics en 3 días',askMsg2._id);await settle();
ok(engine.includes('resultado alfa --texto Parar: medí 0 clics en 3 días --experimento t_medir --decision parar')&&sent.at(-1)?.text==='Apuntado el resultado de «Anuncio medible» (decisión: parar).','a reply that starts with «parar» writes the result down with that decision');
// Measured experiments waiting for a decision remain actionable from /lote.
status.tablero=[{...status.tablero[0],id:'t_decidir',medido:'2026-10-15T10:00:00',fase:'falta decidir'}];
msg('/lote');await settle();
const pendingDecisionMsg=sent.at(-1);
ok(pendingDecisionMsg?.text==='Alfa Studio — falta decidir: «Anuncio medible»\nMétrica: Clics\nUmbral: 10 clics'&&JSON.stringify(pendingDecisionMsg.reply_markup?.inline_keyboard)==='[[{"text":"Seguir","callback_data":"e:seguir:t_decidir"},{"text":"Cambiar","callback_data":"e:cambiar:t_decidir"},{"text":"Parar","callback_data":"e:parar:t_decidir"}]]','/lote offers Seguir, Cambiar and Parar for an experiment waiting for a decision');
failReplyMarkup=true;
const answersBeforeEdit=answers.length,sentBeforeEdit=sent.length;
push({callback_query:{id:'d4',data:'e:cambiar:t_decidir',from:{id:42},message:{message_id:pendingDecisionMsg._id,chat:{id:42}}}});await settle();
failReplyMarkup=false;
ok(engine.at(-1)==='decidir t_decidir --decision cambiar'&&failedReplyMarkups===1&&answers.slice(answersBeforeEdit).some(a=>a.text==='Apuntado')&&!answers.slice(answersBeforeEdit).some(a=>a.text?.includes('No se ha podido apuntar'))&&!sent.slice(sentBeforeEdit).some(m=>m.text.includes('No se ha podido apuntar')),'a reply markup failure after deciding does not report that recording the decision failed');
status.tablero[0].id='a'.repeat(56);
msg('/lote');await settle();
ok(sent.at(-1)?.text===pendingDecisionMsg.text&&!sent.at(-1)?.reply_markup,'/lote omits the whole decision keyboard if any callback exceeds the byte limit');
delete status.tablero;
msg('/a control Sí, acepto');await settle();
ok(engine.includes('mensaje control --texto Sí, acepto'),'/a sends the owner\'s message to a department');
msg('/mesa');await settle();
ok(sent.at(-2)?.text.includes('Acuerdo A')&&sent.at(-2).text.includes('Te espera 1 pregunta')&&sent.at(-1)?.text==='Control te pregunta: ¿Aceptas X?','/mesa shows the agreements, then each real question on its own (warnings are not questions)');
ok(JSON.stringify(sent.at(-1).reply_markup.inline_keyboard.flat().map(b=>b.callback_data))==='["q:M1:s","q:M1:n","q:M1:l","q:M1:r"]','a question comes with Sí / No / Más tarde / Responder');
push({callback_query:{id:'q1',data:'q:M1:s',from:{id:42},message:{message_id:20,chat:{id:42}}}});await settle();
ok(engine.includes('mensaje control --texto Sí --responde-a M1'),'Sí answers the department that asked, as a reply to its question');
push({callback_query:{id:'q2',data:'q:M1:r',from:{id:42},message:{message_id:20,chat:{id:42}}}});await settle();
const prompt=sent.at(-1);
ok(prompt?.text.startsWith('Tu respuesta a M1 (Control)')&&prompt.reply_markup?.force_reply,'Responder asks for the answer as a reply');
push({message:{text:'Sí, pero solo en paper',from:{id:42,first_name:'Ana'},chat:{id:42,type:'private'},reply_to_message:{message_id:99,text:prompt.text}}});await settle();
ok(engine.includes('mensaje control --texto Sí, pero solo en paper --responde-a M1'),'the written answer reaches the department, even after a restart (the prompt names the question)');
// A batch whose routine part is approved: each task left is one decision with Sí / No / Más tarde.
status.proyectos.tf={nombre:'Beta Labs',tareas:[],trabajando:[],pendientes:[],hechas:[],bloqueadas:[],lote:{estado:'pendiente',indices:[3,5],tareas:[{titulo:'Lanzar un solo reel',importante:'Decide si lanza primero uno'},{titulo:'Primera firma'}]}};
msg('/lote');await settle();
const decs=sent.filter(m=>m.text?.startsWith('Beta Labs · decide:'));
ok(decs.length===2&&decs[0].text.includes('Decide si lanza primero uno')&&decs[1].reply_markup.inline_keyboard[0][0].callback_data==='d:tf:5:s','/lote sends each pending decision on its own with its stable index');
push({callback_query:{id:'d1',data:'d:tf:5:n',from:{id:42},message:{message_id:21,chat:{id:42}}}});await settle();
ok(engine.includes('decidir tf --indice 5 --decision no'),'a tap decides that task only');
push({callback_query:{id:'d2',data:'d:../x:1:s',from:{id:42},message:{message_id:21,chat:{id:42}}}});await settle();
ok(!engine.some(a=>a.includes('../x')),'a malformed decision is ignored');
delete status.proyectos.tf;
// What waits for the owner, explained plainly by the engine (para_ti): one message per thing, with buttons that say what happens.
status.tablero=[{id:'t_aaaa0001',fuente:'equipo',proyecto:'alfa',titulo:'Docs 28',columna:'para-ti',lanzamiento:{que:'Q',a_quien:'A',metrica:'M',umbral:'U'}},{id:'t_aaaa0002',fuente:'equipo',proyecto:'alfa',titulo:'Docs 29',columna:'para-ti',lanzamiento:{que:'Q',a_quien:'A',metrica:'M',umbral:'U'}}];
status.para_ti=[{id:'0a1b2c3d',tipo:'lanzar',proyecto:'alfa',titulo:'Publicar 2 reels de Alfa',que_es:'Dos vídeos cortos ya montados.',tu_parte:'Subirlos a Instagram.',por_que:'Ver si atraen seguidores.',claves:['l:t_aaaa0001','l:t_aaaa0002']},
 {id:'1a1b2c3d',tipo:'pregunta',titulo:'¿Aceptas X?',que_es:'Control quiere saberlo.',claves:['q:M1']}];
const sentBefore=sent.length;msg('/lote');await settle();
const groups=sent.slice(sentBefore);
ok(groups[0]?.text.startsWith('📣 Publicar 2 reels de Alfa')&&groups[0].text.includes('Qué es: Dos vídeos cortos')&&groups[0].text.includes('Tu parte: Subirlos')&&groups[0].text.includes('(2 fichas del equipo juntas)')&&!groups.some(m=>m.text.includes('Docs 28')),'/lote explains each thing plainly, grouped, without the team\'s card names');
ok(JSON.stringify(groups[0].reply_markup.inline_keyboard.flat().map(b=>b.text))==='["✓ Hecho, ya está","Ahora no","✕ No lo haré"]'&&groups[1]?.reply_markup.inline_keyboard.flat().length===4,'the buttons say what happens: Hecho / Ahora no / No lo haré');
push({callback_query:{id:'g1',data:'g:0a1b2c3d:h',from:{id:42},message:{message_id:30,chat:{id:42}}}});await settle();
ok(engine.includes('lanzado t_aaaa0001 --via telegram')&&engine.includes('lanzado t_aaaa0002 --via telegram'),'«Hecho» marks every card of the group as launched');
push({callback_query:{id:'g2',data:'g:0a1b2c3d:x',from:{id:42},message:{message_id:30,chat:{id:42}}}});await settle();
ok(engine.some(a=>a.startsWith('descartar t_aaaa0001 --texto')),'«No lo haré» drops the cards');
push({callback_query:{id:'g3',data:'g:1a1b2c3d:n',from:{id:42},message:{message_id:31,chat:{id:42}}}});await settle();
ok(engine.includes('mensaje control --texto No --responde-a M1'),'a grouped question answers the department that asked');
const n=engine.length;push({callback_query:{id:'g4',data:'g:ffffffff:h',from:{id:42},message:{message_id:32,chat:{id:42}}}});await settle();
ok(!engine.slice(n).some(a=>!a.startsWith('status')),'a tap on something that has changed does nothing');
msg('/hoy');await settle(1500);
ok(sent.at(-1)?.text.includes('Publicar 2 reels de Alfa'),'the to-do names the plain thing to do, not the card');
delete status.para_ti;delete status.tablero;
fs.rmSync(path.join(dir,'hoy'),{recursive:true,force:true});
// Today's to-do: /hoy writes it (here without Alfred's brain, from the pending decisions) with a button per task.
msg('/hoy');await settle(1500);
const todayMsg=sent.at(-1),fecha=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
ok(/^Hoy, /.test(todayMsg?.text||'')&&todayMsg.text.includes('○ Decidir 2 cosas de Alfa Studio')&&todayMsg.text.split('\n').length<=6,'/hoy sends today\'s to-do: a header and one short line per task');
ok(todayMsg?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data===`h:${fecha}:0`,'each open task has a button to tick it');
push({callback_query:{id:'h1',data:`h:${fecha}:0`,from:{id:99},message:{message_id:todayMsg?._id||1,chat:{id:42}}}});await settle();
ok(!JSON.parse(fs.readFileSync(path.join(dir,'hoy',fecha+'.json'),'utf8')).items[0].hecho,'a tick from someone else does nothing');
push({callback_query:{id:'h2',data:`h:${fecha}:0`,from:{id:42},message:{message_id:1,chat:{id:42}}}});await settle();
const saved=JSON.parse(fs.readFileSync(path.join(dir,'hoy',fecha+'.json'),'utf8'));
ok(saved.items[0].hecho&&calls.includes('editMessageText'),'the owner\'s tap ticks the task and updates the message');
// With an experiment to launch on the board, the to-do offers it too (the day's file is rewritten, then put back for what follows).
{const file=path.join(dir,'hoy',fecha+'.json'),keep=fs.readFileSync(file,'utf8');
 fs.rmSync(file);
 status.tablero=[{id:'t_036cee09',fuente:'equipo',proyecto:'alfa',titulo:'Anuncio de prueba',columna:'para-ti',lanzamiento:{que:'Un anuncio',a_quien:'Mi lista',metrica:'Clics',umbral:'10 clics'}}];
 msg('/hoy');await settle(1500);
 ok(sent.at(-1)?.text.includes('○ Lanzar 1 experimento (/lote)'),'/hoy adds «Lanzar 1 experimento» when one is waiting to be launched');
 delete status.tablero;fs.writeFileSync(file,keep);}
// Review: due cards one at a time in one message — question, «Ver respuesta», then No / Dudé / La sabía.
fs.mkdirSync(path.join(dir,'repaso'),{recursive:true});
const card=(id,q,a)=>({id,q,a,creada:'2026-10-10',due:'2026-10-10',interval:0,ease:2.5,reps:0,fallos:0});
fs.writeFileSync(path.join(dir,'repaso','tarjetas.json'),JSON.stringify([card('aaaaaaaa','¿Qué mide el drawdown máximo?','La mayor caída desde un pico.'),card('bbbbbbbb','¿Qué es un MVP?','El producto mínimo que valida.')]));
msg('/repaso');await settle();
const rev=sent.at(-1);
ok(rev?.text.startsWith('Repaso 1/2')&&rev.reply_markup.inline_keyboard[0][0].callback_data==='r:v:aaaaaaaa','/repaso asks the first due card with a button to see the answer');
const edits=()=>calls.filter(c=>c==='editMessageText').length,e0=edits();
push({callback_query:{id:'r1',data:'r:v:aaaaaaaa',from:{id:42},message:{message_id:9,chat:{id:42}}}});await settle();
push({callback_query:{id:'r2',data:'r:g:aaaaaaaa:2',from:{id:42},message:{message_id:9,chat:{id:42}}}});await settle();
push({callback_query:{id:'r3',data:'r:g:bbbbbbbb:0',from:{id:42},message:{message_id:9,chat:{id:42}}}});await settle();
const after=JSON.parse(fs.readFileSync(path.join(dir,'repaso','tarjetas.json'),'utf8'));
ok(edits()-e0===3&&after[0].reps===1&&after[0].interval===2&&after[1].fallos===1&&after[1].interval===1,'answers move each card to its next date in the same message');
// Apple Reminders through a fake helper: /hoy creates the list's reminders, ticks on the iPhone reach Telegram,
// and a reminder the owner adds to the list becomes a task.
{const state=path.join(dir,'cal-state.json'),log=path.join(dir,'cal-log.txt'),fakeHelper=path.join(dir,'alfred-calendario');
 fs.writeFileSync(state,JSON.stringify({rems:[{id:'R-old',titulo:'Responder al equipo (1 pregunta, /mesa)',hecho:false}],events:[{titulo:'Fisio',inicio:'2026-10-17T08:30:00Z',fin:'2026-10-17T09:30:00Z',todoElDia:false,calendario:'Casa'}]}));
 fs.writeFileSync(fakeHelper,`#!${process.execPath}
const fs=require('fs'),[cmd,...a]=process.argv.slice(2),st=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));fs.appendFileSync(${JSON.stringify(log)},cmd+' '+a.join('|')+'\\n');
if(cmd==='permiso')console.log(JSON.stringify({eventos:'concedido',recordatorios:'concedido'}));
else if(cmd==='eventos')console.log(JSON.stringify(st.events));
else if(cmd==='recordatorios')console.log(JSON.stringify(st.rems));
else if(cmd==='crear'){const id='R'+(st.rems.length+1);st.rems.push({id,titulo:a[1],hecho:false});fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(st));console.log(JSON.stringify({id}));}
else if(cmd==='completar'){const r=st.rems.find(x=>x.id===a[0]);if(r)r.hecho=a[1]==='1';fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(st));console.log('{"ok":true}');}
`,{mode:0o755});
 process.env.LIFE_OS_CALENDAR_HELPER=fakeHelper;
 msg('/hoy');await settle(1500);await tg.syncNow(); // the reminders are created in the background chain: wait for it
 const st=()=>JSON.parse(fs.readFileSync(state,'utf8')),dayFile=()=>JSON.parse(fs.readFileSync(path.join(dir,'hoy',fecha+'.json'),'utf8'));
 const open=dayFile().items.filter(i=>!i.hecho);
 ok(open.every(i=>i.rid)&&dayFile().items.find(i=>i.t.startsWith('Responder al equipo'))?.rid==='R-old','/hoy puts every open task in the «Alfred» reminders list, reusing an open reminder with the same title');
 const target=open[0];st();const s1=st();s1.rems.find(r=>r.id===target.rid).hecho=true;s1.rems.push({id:'R-mine',titulo:'Comprar regalo para Ana',hecho:false});fs.writeFileSync(state,JSON.stringify(s1));
 await tg.syncNow();await settle(800);
 ok(dayFile().items.find(i=>i.rid===target.rid)?.hecho&&dayFile().items.some(i=>i.t==='Comprar regalo para Ana'&&i.rid==='R-mine'),'a tick in Reminders reaches today\'s list and a reminder the owner adds becomes a task');
 delete process.env.LIFE_OS_CALENDAR_HELPER;}
tg.control('desvincular');
ok(tg.status().estado==='sin-vincular'&&!fs.existsSync(path.join(dir,'telegram.json'))&&tg.status().codigo!==code,'unlinking forgets the chat and issues a new code');
ok(!JSON.stringify(sent).includes(TOKEN),'the bot token never appears in a message');

// Voice notes are transcribed on the Mac; only checked where whisper.cpp and its model are installed.
{const model=path.join(process.env.HOME||'','Library/Application Support/com.lifeoperatingsystem.app/modelos/ggml-large-v3-turbo-q5_0.bin');
 if(fs.existsSync(model)&&fs.existsSync('/opt/homebrew/bin/whisper-cli')&&fs.existsSync('/usr/bin/say')){
  const aiff=path.join(dir,'nota.aiff');
  await new Promise((res,rej)=>execFileCb('/usr/bin/say',['-v','Jorge','-o',aiff,'Alfred, revisa el comparador de Beta Labs.'],e=>e?rej(e):res()));
  const heard=await tg.transcribeFile(aiff);
  ok(/Beta Labs/.test(heard)&&/comparador/i.test(heard),'a voice note is transcribed on the Mac: '+heard);
 }}
// The to-do's pure pieces: Alfred's reply → five short lines; directives add or tick and never reach the owner.
{const hb=path.join(dir,'hoy.mjs');await require('esbuild').build({entryPoints:[path.join(root,'hoy.ts')],outfile:hb,bundle:true,platform:'node',format:'esm',target:'node26',logLevel:'warning'});
 const h=await import(pathToFileURL(hb).href);
 const lines=h.parse('Claro, aquí va:\n- **Aprobar** el lote de TF.\n- Sol 10 min\n- Sol 10 min\n1. Llamar al gestor por el IVA del tercer trimestre y cerrar lo pendiente con él hoy\n- a\n- b\n- c');
 ok(lines.length===5&&lines[0]==='Aprobar el lote de TF'&&lines[2].length<=70&&!lines.includes('Claro, aquí va:'),'Alfred\'s reply becomes at most five short, unique lines');
 const day={fecha:'2026-10-17',items:[{t:'Aprobar el lote de TF',hecho:false}]};
 const r=h.applyDirectives('Apuntado. <<hoy:+Comprar creatina>> Y lo del lote, hecho. <<hoy:hecho:1>>',day);
 ok(r.text==='Apuntado. Y lo del lote, hecho.'&&day.items[0].hecho&&day.items[1].t==='Comprar creatina','<<hoy:+…>> adds a task, <<hoy:hecho:N>> ticks one, and neither reaches the owner');
 ok(h.render(day)==='Hoy, sáb 17\n✓ Aprobar el lote de TF\n○ Comprar creatina'&&h.keyboard(day).inline_keyboard.length===1,'the message ticks what is done and only offers buttons for what is open');
 ok(JSON.stringify(h.parse('- Aprobar el lote de TF - Sol 10 minutos - Llamar al gestor'))==='["Aprobar el lote de TF","Sol 10 minutos","Llamar al gestor"]'&&h.parse('Aprobar lote | Sol 10 min').length===2,'a list squeezed into one line is still split into tasks');
 ok(h.prompt({yesterday:{fecha:'2026-10-16',items:[{t:'Llamar al gestor',hecho:false}]},decisions:['aprobar el lote de TF (/lote)']}).includes('De ayer quedó sin hacer: Llamar al gestor'),'yesterday\'s undone tasks reach the morning prompt');}
// Spaced repetition: a miss comes back tomorrow, good answers wait longer each time; Alfred's directives become cards.
{const rb=path.join(dir,'repaso.mjs');await require('esbuild').build({entryPoints:[path.join(root,'repaso.ts')],outfile:rb,bundle:true,platform:'node',format:'esm',target:'node26',logLevel:'warning'});
 const r=await import(pathToFileURL(rb).href),d=new Date('2026-10-17T10:00:00'),cards=[];
 const out=r.applyDirectives('Guardado para repasar. <<repaso:Trading|¿Qué es el apalancamiento?||Operar con más capital del que pones.>> <<repaso:¿Qué es el apalancamiento?||duplicada>>',cards,d);
 ok(out.text==='Guardado para repasar.'&&cards.length===1&&cards[0].tema==='Trading'&&cards[0].due==='2026-10-17','a directive saves one card (with its topic, due today) and repeated questions are ignored');
 const c=cards[0];r.grade(c,2,d);const i1=c.interval;r.grade(c,2,d);const i2=c.interval;r.grade(c,2,d);const i3=c.interval;r.grade(c,0,d);
 ok(i1===2&&i2===6&&i3>=15&&c.interval===1&&c.due==='2026-10-18','intervals grow 2 → 6 → ~15 days and a miss brings it back tomorrow');
 ok(r.due([...cards,{...c,id:'x',q:'otra',due:'2026-12-01'}],d).length===0||r.due(cards,d).every(x=>x.due<='2026-10-17'),'only cards due today are asked');}
{const cb=path.join(dir,'cal.mjs');await require('esbuild').build({entryPoints:[path.join(root,'calendario.ts')],outfile:cb,bundle:true,platform:'node',format:'esm',target:'node26',logLevel:'warning'});
 const c=await import(pathToFileURL(cb).href),line=c.agenda([{titulo:'Gym',inicio:'2026-10-17T16:30:00Z',fin:'',todoElDia:false,calendario:''},{titulo:'Cumpleaños de Ana',inicio:'2026-10-17T00:00:00Z',fin:'',todoElDia:true,calendario:''}]);
 ok(/^\d{2}:\d{2} Gym · Cumpleaños de Ana$/.test(line),'today\'s events become one agenda line: '+line);}
// Links the owner sends are read without asking; others still need his yes.
{const vb=path.join(dir,'voice.mjs');await require('esbuild').build({entryPoints:[path.join(root,'voice.ts')],outfile:vb,bundle:true,platform:'node',format:'esm',target:'node26',external:['@anthropic-ai/claude-agent-sdk'],logLevel:'warning'});
 const v=await import(pathToFileURL(vb).href);
 ok(JSON.stringify(v.linksIn('Mira esto: https://example.com/a?b=1, y (https://x.io/post).'))==='["https://example.com/a?b=1","https://x.io/post"]','the links in a message are found without trailing punctuation');}
tg.stop();waiter?.();fake.close();fs.rmSync(dir,{recursive:true,force:true});
console.log(process.exitCode?'TELEGRAM CHECKS FAILED':'TELEGRAM CHECKS PASSED');
setTimeout(()=>process.exit(process.exitCode||0),100);
