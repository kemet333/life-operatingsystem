// Assembles escritorio/recursos for this operating system before electron-builder packages it (macOS or Windows):
//   runtime/node[.exe]  the Node that runs this script (the official build: CI installs it with setup-node)
//   workspace/          server.mjs, the built interface, the team engine and Alfred's Agent SDK for this platform
// Run from the repository with dependencies installed: alfred-os (npm ci) and mac/local-workspace (npm ci).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'..');
const site=path.join(repo,'alfred-os'),local=path.join(repo,'mac','local-workspace'),engine=path.join(repo,'equipo');
const out=path.join(here,'recursos'),workspace=path.join(out,'workspace'),runtime=path.join(out,'runtime');
const node=process.execPath,win=process.platform==='win32';
const sdk=`claude-agent-sdk-${process.platform}-${process.arch}`;

const step=(what,fn)=>{process.stdout.write(what+'… ');fn();console.log('hecho');};
const copy=(from,to)=>fs.cpSync(from,to,{recursive:true,dereference:true});

step('Interfaz',()=>execFileSync(node,[path.join(site,'node_modules','vite','bin','vite.js'),'build','--config',path.join(local,'vite.config.ts')],{stdio:'inherit'}));
step('Servidor local',()=>execFileSync(node,[path.join(local,'build-server.mjs')],{stdio:'inherit'}));
step('Recursos',()=>{
 fs.rmSync(out,{recursive:true,force:true});
 fs.mkdirSync(path.join(workspace,'node_modules','@anthropic-ai'),{recursive:true});fs.mkdirSync(runtime,{recursive:true});
 fs.copyFileSync(path.join(local,'dist','server.mjs'),path.join(workspace,'server.mjs'));
 copy(path.join(local,'dist','client'),path.join(workspace,'client'));
 fs.mkdirSync(path.join(workspace,'equipo'));
 for(const f of ['equipo.py','tablero.py','plataforma.py','servicio.py','modelos.json','departments.json'])fs.copyFileSync(path.join(engine,f),path.join(workspace,'equipo',f));
 const mods=path.join(local,'node_modules','@anthropic-ai');
 if(!fs.existsSync(path.join(mods,sdk)))throw Error(`Falta ${sdk}: ejecuta npm ci en local-workspace en este sistema.`);
 for(const m of ['claude-agent-sdk',sdk])copy(path.join(mods,m),path.join(workspace,'node_modules','@anthropic-ai',m));
 fs.copyFileSync(node,path.join(runtime,win?'node.exe':'node'));
 const license=[path.join(path.dirname(node),'LICENSE'),path.join(path.dirname(node),'..','LICENSE')].find(f=>fs.existsSync(f));
 if(license)fs.copyFileSync(license,path.join(runtime,'Node-LICENSE'));
});
console.log('Listo en',out);
