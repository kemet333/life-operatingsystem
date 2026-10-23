// The person this copy of the app belongs to. Nothing personal lives in the code: name, how Alfred addresses them and
// their private standing instructions sit in the app's data folder (<data>/perfil/), outside the repository, so the
// same code serves the owner and anyone who installs the open-source build.
//   perfil/perfil.json       {"nombre": "…", "apodo": "…", "app": "…"}
//   perfil/instrucciones.md  free text Alfred reads at the start of every session (goals, rules, context)
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

export type Profile={name:string;nickname:string;app:string;instructions:string};

export function load(dataDir=process.env.LIFE_OS_DATA_DIR):Profile{
 const dir=dataDir?join(dataDir,'perfil'):'';
 let json:any={},instructions='';
 if(dir){
  try{json=JSON.parse(readFileSync(join(dir,'perfil.json'),'utf8'))||{};}catch{}
  try{instructions=readFileSync(join(dir,'instrucciones.md'),'utf8').trim().slice(0,40_000);}catch{}
 }
 const text=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
 return {name:text(json.nombre,60)||'la persona con la que hablas',nickname:text(json.apodo,40),app:text(json.app,60)||'life.operatingsystem',instructions};
}

// What the interface may show (never the private instructions).
export function publicView(){const p=load();return {nombre:p.name==='la persona con la que hablas'?'':p.name,apodo:p.nickname,app:p.app};}
