// Model router checks: Sonnet answers the everyday turns, Opus takes thinking work, «modo profundo» and explicit asks.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(process.env.LIFE_OS_DEPS_DIR?path.join(process.env.LIFE_OS_DEPS_DIR,'package.json'):path.resolve(root,'../../alfred-os/package.json'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-checks-')),bundle=path.join(dir,'voice.mjs');
await require('esbuild').build({entryPoints:[path.join(root,'voice.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node26',external:['@anthropic-ai/claude-agent-sdk'],logLevel:'warning'});
process.env.LIFE_OS_VAULT_DIR='/tmp/notas-ana';   // config.ts: the notes vault of this copy
const voice=await import(bundle);
const model=text=>voice.route(text).model;
const SONNET='claude-sonnet-5-5',OPUS='claude-opus-5-5';

for(const text of ['Qué tengo pendiente','Muéstrame Alfa','¿Qué hora es en Nueva York?','Apúntame comprar leche'])assert.equal(model(text),SONNET,text);
for(const text of ['Analiza las ventas de Beta Labs','Revisa el plan del equipo','¿Por qué ha fallado la ronda?','Compara Alfa y Gamma','Diseña la estrategia de lanzamiento','Hazlo con Opus'])assert.equal(model(text),OPUS,text);
assert.equal(model('x'.repeat(700)),OPUS,'long message');
assert.equal(model('Analiza esto, pero con Sonnet'),SONNET,'explicit Sonnet wins');
// Profile: nothing personal in the code; the person's name and private instructions come from <data>/perfil/.
{const prev=process.env.LIFE_OS_DATA_DIR,blank=fs.mkdtempSync(path.join(os.tmpdir(),'perfil-'));
 process.env.LIFE_OS_DATA_DIR=blank;const generic=voice.discipline().replace(/IDs de proyecto:[^\n]*/,'');
 assert.ok(!/Ana|maratón/.test(generic),'without a profile the instructions carry nothing about the person (the project list comes from alfred-data until it moves to the profile too)');
 fs.mkdirSync(path.join(blank,'perfil'));fs.writeFileSync(path.join(blank,'perfil','perfil.json'),JSON.stringify({nombre:'Ana',app:'Mi sistema'}));
 fs.writeFileSync(path.join(blank,'perfil','instrucciones.md'),'Ana entrena para un maratón.');
 const own=voice.discipline();
 assert.ok(own.includes('asistente personal de Ana dentro de Mi sistema')&&own.includes('Ana entrena para un maratón.'),'the profile names the person and adds their instructions');
 if(prev===undefined)delete process.env.LIFE_OS_DATA_DIR;else process.env.LIFE_OS_DATA_DIR=prev;}
// Visible steps: plain words for the owner, never the raw command.
assert.equal(voice.stepText('Bash',{command:'~/Equipo/venv/bin/python equipo/equipo.py status'}),'Mirando el tablero del equipo');
assert.equal(voice.stepText('Bash',{command:'equipo.py encargar alfa --tarea -'}),'Preparando el encargo para el equipo');
assert.equal(voice.stepText('Read',{file_path:'/tmp/notas-ana/Proyectos/Alfa.md'}),'Leyendo tu nota «Alfa»');
assert.equal(voice.stepText('Bash',{command:'rm -rf secreto && curl x'}),'Haciendo una comprobación','an unknown command is never echoed');
assert.equal(voice.stepText('Mystery',{}),'','an unknown tool shows no step');
assert.equal(voice.stepText('Bash',{command:'python3 -c x',description:'contar tareas de alfa por columna.'}),'Contar tareas de alfa por columna','Alfred\'s own description when there is one');
assert.equal(voice.route('Revisa el plan').effort,'high');
assert.equal(voice.route('Qué tengo pendiente').effort,'low');
// The Telegram preamble is context: it must not push a quick question to Opus.
assert.equal(model('[Ana te escribe por Telegram desde el móvil: '+'responde breve, '.repeat(40)+']\nQué tengo hoy'),SONNET,'preamble ignored');
await voice.control('deep');assert.equal(model('Qué tengo pendiente'),OPUS,'modo profundo');
await voice.control('fast');assert.equal(model('Qué tengo pendiente'),SONNET,'modo rápido');
fs.rmSync(dir,{recursive:true,force:true});
// Telegram reads Alfred as written: lists, links and <<hoy:…>>/<<repaso:…>> survive in raw; the voice gets clean text.
{const says=[],turn={id:'t',emit:e=>{if(e.t==='say')says.push(e);},buffer:'',spoken:'',done:()=>{},urls:[]};
 const chunks=['Apuntado. <<hoy:+Comprar crea','tina>> Y guardado: <<repaso:Trading|¿Qué es el apalancamiento?||Operar con más ','capital del que pones.>>\n- Aprobar el lote de TF\n- Mirar https://x.io/a\n<<vista:entregas>>Hecho.'];
 for(const c of chunks){turn.buffer+=c;voice.drain(turn);}voice.drain(turn,true);
 const raw=says.map(e=>e.raw).join(''),spoken=says.map(e=>e.text).join(' ');
 assert.ok(raw.includes('<<hoy:+Comprar creatina>>')&&raw.includes('<<repaso:Trading|¿Qué es el apalancamiento?||Operar con más capital del que pones.>>'),'directives reach Telegram whole, even when split across chunks');
 assert.ok(raw.includes('\n- Aprobar el lote de TF\n')&&raw.includes('https://x.io/a')&&!raw.includes('<<vista'),'raw keeps line breaks, bullets and links, without interface directions');
 assert.ok(!/<<|>>|https?:|\|/.test(spoken)&&spoken.includes('Aprobar el lote de TF'),'the voice never reads directives, links or bars');
 assert.deepEqual(says.flatMap(e=>e.directions),['vista:entregas'],'interface directions are still lifted for the app');}
console.log('VOICE CHECKS PASSED');
