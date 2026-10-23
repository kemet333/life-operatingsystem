// Active recall with spaced repetition. Cards come from what the person sends or studies: in a conversation Alfred
// writes <<repaso:pregunta||respuesta>> for each key idea worth keeping (a link, a photo, a voice note, a book chapter,
// a vault note, a lesson from the projects) and the card is saved here. Every morning the cards that are due are asked
// on Telegram one at a time: the question, «Ver respuesta», then «No / Dudé / La sabía», which sets the next date
// (SM-2: a miss comes back tomorrow, a good answer waits longer each time). Pure functions and file helpers only.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export type Card={id:string;q:string;a:string;tema?:string;creada:string;due:string;interval:number;ease:number;reps:number;fallos:number};
export const PER_DAY=10;
const FILE=(dataDir:string)=>path.join(dataDir,'repaso','tarjetas.json');
/** Every answer, one line each (repaso/registro.jsonl): the Sunday review counts how much was right the first time. */
export function logAnswer(dataDir:string,id:string,g:number,today:Date){try{fs.mkdirSync(path.dirname(FILE(dataDir)),{recursive:true});fs.appendFileSync(path.join(path.dirname(FILE(dataDir)),'registro.jsonl'),JSON.stringify({fecha:day(today),id,g})+'\n');}catch{}}
export function load(dataDir:string):Card[]{try{const c=JSON.parse(fs.readFileSync(FILE(dataDir),'utf8'));return Array.isArray(c)?c:[];}catch{return [];}}
export function save(dataDir:string,cards:Card[]){fs.mkdirSync(path.dirname(FILE(dataDir)),{recursive:true});fs.writeFileSync(FILE(dataDir),JSON.stringify(cards,null,1));}

const day=(d:Date)=>{const p=(n:number)=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;};
const addDays=(fecha:string,n:number)=>{const d=new Date(fecha+'T12:00:00');d.setDate(d.getDate()+n);return day(d);};
const norm=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();

/** A new card, due today so the first recall happens while it is fresh. Duplicate questions are ignored. */
export function add(cards:Card[],q:string,a:string,today:Date,tema?:string):Card|null{
 q=q.replace(/\s+/g,' ').trim().slice(0,300);a=a.replace(/\s+/g,' ').trim().slice(0,600);
 if(q.length<4||!a)return null;
 if(cards.some(c=>norm(c.q)===norm(q)))return null;
 const c:Card={id:randomBytes(4).toString('hex'),q,a,...(tema?{tema:tema.slice(0,40)}:{}),creada:day(today),due:day(today),interval:0,ease:2.5,reps:0,fallos:0};
 cards.push(c);return c;
}
/** The cards to ask today: the most overdue first, at most PER_DAY. */
export function due(cards:Card[],today:Date):Card[]{const t=day(today);return cards.filter(c=>c.due<=t).sort((a,b)=>a.due.localeCompare(b.due)||a.reps-b.reps).slice(0,PER_DAY);}

/** 0 = no la sabía, 1 = dudé, 2 = la sabía. SM-2 with three answers. */
export function grade(c:Card,g:0|1|2,today:Date){
 const t=day(today);
 if(g===0){c.fallos++;c.reps=0;c.interval=1;c.ease=Math.max(1.3,c.ease-.2);}
 else{
  c.reps++;
  if(c.reps===1)c.interval=g===2?2:1;
  else if(c.reps===2)c.interval=g===2?6:3;
  else c.interval=Math.max(c.interval+1,Math.round(c.interval*(g===2?c.ease:1.2)));
  c.ease=Math.max(1.3,c.ease+(g===2?.05:-.15));
 }
 c.due=addDays(t,c.interval);return c;
}

/** <<repaso:pregunta||respuesta>> (optionally <<repaso:tema|pregunta||respuesta>>) → saved cards; the text without them. */
export function applyDirectives(reply:string,cards:Card[],today:Date):{text:string;added:Card[]}{
 const added:Card[]=[];
 const text=reply.replace(/<<repaso:([\s\S]{3,1000}?)>>/g,(_,body:string)=>{
  const [left,a]=body.split('||');if(!a)return '';
  const bar=left.indexOf('|'),tema=bar>0&&bar<40?left.slice(0,bar):undefined,q=bar>0&&bar<40?left.slice(bar+1):left;
  const c=add(cards,q,a,today,tema?.trim());if(c)added.push(c);return '';
 }).replace(/[ \t]{2,}/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {text,added};
}

// ---------- the Telegram session: one message edited in place ----------
export const question=(c:Card,n:number,total:number)=>`Repaso ${n}/${total}${c.tema?' · '+c.tema:''}\n\n${c.q}`;
export const answer=(c:Card,n:number,total:number)=>`${question(c,n,total)}\n\n→ ${c.a}`;
export const showButton=(c:Card)=>({inline_keyboard:[[{text:'Ver respuesta',callback_data:'r:v:'+c.id}]]});
export const gradeButtons=(c:Card)=>({inline_keyboard:[[{text:'No',callback_data:'r:g:'+c.id+':0'},{text:'Dudé',callback_data:'r:g:'+c.id+':1'},{text:'La sabía',callback_data:'r:g:'+c.id+':2'}]]});
export const startButton=()=>({inline_keyboard:[[{text:'Empezar',callback_data:'r:s'}]]});
export function invite(n:number){return n?`Repaso de hoy: ${n} ${n===1?'tarjeta':'tarjetas'} (2 min).`:'';}
export function summary(right:number,total:number,cards:Card[],today:Date){
 const next=cards.map(c=>c.due).filter(d=>d>day(today)).sort()[0];
 return `Repaso hecho: ${right}/${total} a la primera.`+(next?` Próximo: ${next.slice(8,10)}/${next.slice(5,7)}.`:'');
}
export function context(cards:Card[],today:Date){
 const n=due(cards,today).length;
 return `Repaso: ${cards.length} tarjetas guardadas, ${n} para hoy. Cuando te mande algo que merezca recordarse (un enlace, una foto, una nota de voz, un libro o capítulo, una nota de su vault, una lección de sus proyectos), crea de 1 a 3 tarjetas sin preguntar con <<repaso:tema|pregunta||respuesta>>: preguntas cortas que obliguen a recordar, respuestas de una frase. Díselo en dos palabras ("Guardado para repasar").`;
}
