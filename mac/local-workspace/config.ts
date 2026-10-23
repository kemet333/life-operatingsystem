// Where things live on this computer. Nothing machine-specific is written in the code: the paths of the notes vault,
// the agent team, the content machine, the voice key files and the like sit in <data>/configuracion.json, outside the
// repository, so the same build serves its owner and anyone who installs the open-source version. A fresh install
// starts with no file: every feature whose path is empty simply stays off until it is set up.
// Precedence for each value: its LIFE_OS_* environment variable (tests, overrides), then the file, then the default.
//   configuracion.json {
//     "vault": "~/notas",                        the notes folder Alfred and Memoria read (Obsidian works)
//     "cartera": "~/notas/Proyectos",             the project notes that make up the portfolio
//     "equipo": {"python": "…", "motor": "…/equipo.py", "consumo": "…/state/consumo"},
//     "puente": {"python": "…"},                 optional bridge with Hermes
//     "alfred": {"carpeta": "~/…", "puedeLeer": ["~/proyecto-1", "~/proyecto-2"]},
//     "contenido": {"maquina": "…/machine.db", "fullVisual": "…/output", "reelsCurso": "…", "reelsDia": "…", "plan": "<vault-relative folder>"},
//     "voz": {"id": "<ElevenLabs voice id>", "modelo": "eleven_v3", "archivosClave": ["…/.env.local"]},
//     "whisper": {"modelo": "…/ggml-….bin", "vocabulario": "names the transcription should get right"}
//   }
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA=process.env.LIFE_OS_DATA_DIR||'';
let raw:any={};
try{raw=JSON.parse(fs.readFileSync(path.join(DATA,'configuracion.json'),'utf8'))||{};}catch{}

/** «~/x» → the home folder; anything else as written. */
export const expand=(p:string)=>p==='~'?os.homedir():p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p;
const pick=(obj:any,key:string)=>key.split('.').reduce((o,k)=>o&&typeof o==='object'?o[k]:undefined,obj);
/** A path setting: env var, then the file, then the default (already absolute or empty). */
export function ruta(key:string,env?:string,def=''):string{
 const e=env?process.env[env]:undefined;if(e)return e;
 const v=pick(raw,key);return typeof v==='string'&&v.trim()?expand(v.trim()):def;
}
/** A plain text setting. */
export function texto(key:string,def='',env?:string):string{const e=env?process.env[env]:undefined;if(e)return e;const v=pick(raw,key);return typeof v==='string'&&v.trim()?v.trim():def;}
/** A list of paths. */
export function rutas(key:string,def:string[]=[]):string[]{const v=pick(raw,key);return Array.isArray(v)?v.filter(x=>typeof x==='string'&&x.trim()).map(x=>expand(x.trim())):def;}
/** A list of objects as written in the file (each consumer checks its fields). */
export function lista(key:string):any[]{const v=pick(raw,key);return Array.isArray(v)?v:[];}
/** The app's own support folder (the parent of the data folder), for downloaded models and the like. */
export const soporte=DATA?path.dirname(DATA):'';
