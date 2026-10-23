// Pure argument builders for the actions of /api/equipo that the app relays to equipo.py (no node imports, no effects).
export const PROJECT=/^[a-z0-9-]{2,30}$/;
// same prefix as BOTON_FUSIONAR in equipo/equipo.py
export const BOTON_FUSIONAR='f:';
export function fusionarBoton(data:string):string|null{
 if(!data.startsWith(BOTON_FUSIONAR))return null;
 const pid=data.slice(BOTON_FUSIONAR.length);
 return PROJECT.test(pid)?pid:null;
}
const TAREA=/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
// Same limits as registrar_resultado() in equipo/equipo.py.
import {RESULTADO_MIN,RESULTADO_MAX,DECISIONES,FASE_FALTA_FUSIONAR} from '../../alfred-os/lib/office-limits';
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
// The owner can start a reply with «seguir», «cambiar» or «parar» to say what to do next; the whole message is still the result.
export function decisionDeTexto(texto:unknown):string|null{
 const m=typeof texto==='string'?/^(seguir|cambiar|parar)(?=$|[\s:.,;-])/i.exec(texto.trimStart()):null;
 return m?m[1].toLowerCase():null;
}
export function experimentoArgs(input:any):{args:string[]}|{error:string}{
 const tarea=text(input?.tarea);
 if(input?.action==='lanzado')return TAREA.test(tarea)?{args:['lanzado',tarea,'--via','app']}:{error:'Tarea no válida.'};
 if(input?.action==='decidir'){
  if(!TAREA.test(tarea))return {error:'Tarea no válida.'};
  const decision=text(input.decision);
  if(!(DECISIONES as readonly string[]).includes(decision))return {error:'Decisión no válida.'};
  return {args:['decidir',tarea,'--decision',decision]};
 }
 if(input?.action==='resultado'){
  const project=text(input.project),texto=text(input.texto);
  if(!PROJECT.test(project))return {error:'Proyecto no válido.'};
  if(tarea&&!TAREA.test(tarea))return {error:'Tarea no válida.'};
  if(texto.length<RESULTADO_MIN)return {error:`Cuenta qué mediste y qué salió (mínimo ${RESULTADO_MIN} caracteres).`};
  const decision=text(input.decision);
  if(decision&&!(DECISIONES as readonly string[]).includes(decision))return {error:'Decisión no válida.'};
  return {args:['resultado',project,'--texto',texto.slice(0,RESULTADO_MAX),...(tarea?['--experimento',tarea]:[]),...(decision?['--decision',decision]:[])]};
 }
 if(input?.action==='descartar'){
  const texto=text(input.texto);
  if(!TAREA.test(tarea))return {error:'Tarea no válida.'};
  if(texto.length<RESULTADO_MIN)return {error:`Cuenta por qué no lo lanzas (mínimo ${RESULTADO_MIN} caracteres).`};
  return {args:['descartar',tarea,'--texto',texto.slice(0,RESULTADO_MAX)]};
 }
 return {error:'Acción del equipo no válida.'};
}
// Telegram's «Ya lo he lanzado» button: callback_data is BOTON_LANZADO + task id (same prefix as BOTON_LANZADO in equipo/equipo.py).
export const BOTON_LANZADO='l:';
export function lanzadoBoton(data:string):{args:string[]}|null{
 if(!data.startsWith(BOTON_LANZADO))return null;
 const r=experimentoArgs({action:'lanzado',tarea:data.slice(BOTON_LANZADO.length)});
 return 'args' in r?{args:['lanzado',r.args[1],'--via','telegram']}:null;
}
// «Apuntar lo medido»: same shape, a different prefix. Telegram caps callback_data at 64 bytes.
export const BOTON_MEDIDO='m:';
// Same prefix as BOTON_NO_LANZO in equipo/equipo.py.
export const BOTON_NO_LANZO='n:';
// «Seguir / Cambiar / Parar» on a measured experiment. «d:» is the batch's Sí / No / Más tarde (decidirBoton below).
export const BOTON_DECIDIR='e:';
export function decisionExperimentoBoton(data:string):string[]|null{
 if(!data.startsWith(BOTON_DECIDIR))return null;
 const [decision,...tarea]=data.slice(BOTON_DECIDIR.length).split(':');
 const r=experimentoArgs({action:'decidir',decision,tarea:tarea.join(':')});
 return 'args' in r?r.args:null;
}
export function boton(prefijo:string,tarea:string):string|null{
 return TAREA.test(tarea)&&new TextEncoder().encode(prefijo+tarea).length<=64?prefijo+tarea:null;
}
export function medidoBoton(data:string):string|null{
 if(!data.startsWith(BOTON_MEDIDO))return null;
 const tarea=data.slice(BOTON_MEDIDO.length);
 return TAREA.test(tarea)?tarea:null;
}
export function noLanzoBoton(data:string):string|null{
 if(!data.startsWith(BOTON_NO_LANZO))return null;
 const tarea=data.slice(BOTON_NO_LANZO.length);
 return TAREA.test(tarea)?tarea:null;
}
// The «¿Qué mediste…?» question and its way back: the owner's reply carries the quoted text, so the experiment is found again even after a restart.
export const PREGUNTA_MEDIDO_INICIO='¿Qué mediste en «';
const PREGUNTA_MEDIDO_FIN='»? Respóndeme a este mensaje.';
export function preguntaMedido(titulo:string):string{
 return PREGUNTA_MEDIDO_INICIO+titulo+PREGUNTA_MEDIDO_FIN;
}
export function experimentoDeRespuesta(texto:unknown,faltaMedir:any[]):any|null{
 if(typeof texto!=='string'||!texto.startsWith(PREGUNTA_MEDIDO_INICIO)||!texto.endsWith(PREGUNTA_MEDIDO_FIN))return null;
 if(texto.length<PREGUNTA_MEDIDO_INICIO.length+PREGUNTA_MEDIDO_FIN.length)return null;
 const titulo=texto.slice(PREGUNTA_MEDIDO_INICIO.length,texto.length-PREGUNTA_MEDIDO_FIN.length);
 const found=(Array.isArray(faltaMedir)?faltaMedir:[]).filter(it=>it?.titulo===titulo);
 return found.length===1?found[0]:null;
}
export const PREGUNTA_FRENO_INICIO='¿Qué te frena para lanzar «';
const PREGUNTA_FRENO_FIN='»? Respóndeme a este mensaje.';
export function preguntaFreno(titulo:string):string{
 return PREGUNTA_FRENO_INICIO+titulo+PREGUNTA_FRENO_FIN;
}
export function experimentoDeFreno(texto:unknown,porLanzar:any[]):any|null{
 if(typeof texto!=='string'||!texto.startsWith(PREGUNTA_FRENO_INICIO)||!texto.endsWith(PREGUNTA_FRENO_FIN))return null;
 if(texto.length<PREGUNTA_FRENO_INICIO.length+PREGUNTA_FRENO_FIN.length)return null;
 const titulo=texto.slice(PREGUNTA_FRENO_INICIO.length,texto.length-PREGUNTA_FRENO_FIN.length);
 const found=(Array.isArray(porLanzar)?porLanzar:[]).filter(it=>it?.titulo===titulo);
 return found.length===1?found[0]:null;
}
// What /lote offers about experiments, from the team board: not launched yet, waiting for a measurement or waiting for a decision.
export function experimentosPendientes(tablero:any[]):{porLanzar:any[];faltaMedir:any[];faltaDecidir:any[]}{
 const items=Array.isArray(tablero)?tablero:[];
 return {
  porLanzar:items.filter(it=>it.fuente==='equipo'&&it.columna==='para-ti'&&it.lanzamiento&&!it.lanzado),
  faltaMedir:items.filter(it=>it.fuente==='equipo'&&it.lanzamiento&&it.lanzado&&!it.medido&&it.fase==='falta medir'),
  faltaDecidir:items.filter(it=>it.fuente==='equipo'&&it.lanzamiento&&it.lanzado&&it.medido&&!it.decision&&it.fase==='falta decidir'),
 };
}
export function mensajesFaltaDecidir(s:any):{texto:string;reply_markup?:any}[]{
 return experimentosPendientes(s?.tablero||[]).faltaDecidir.map(it=>{
  const l=it.lanzamiento,botones=['seguir','cambiar','parar'].map(d=>({text:d[0].toUpperCase()+d.slice(1),callback_data:boton(BOTON_DECIDIR+d+':',it.id)}));
  const texto=(s.proyectos?.[it.proyecto]?.nombre||it.proyecto)+' — falta decidir: «'+it.titulo+'»\nMétrica: '+l.metrica+'\nUmbral: '+l.umbral;
  return {texto,...(botones.every(b=>b.callback_data)?{reply_markup:{inline_keyboard:[botones]}}:{})};
 });
}
// The experiment lines of the morning to-do (lowercase like the other decisions), so they show up where the owner plans his day.
export function decisionesExperimentos(tablero:any[]):string[]{
 const {porLanzar,faltaMedir,faltaDecidir}=experimentosPendientes(tablero),out:string[]=[];
 if(porLanzar.length)out.push(`lanzar ${porLanzar.length===1?'1 experimento':`${porLanzar.length} experimentos`} (/lote)`);
 if(faltaMedir.length)out.push(`apuntar lo medido de ${faltaMedir.length===1?'1 experimento':`${faltaMedir.length} experimentos`} (/lote)`);
 if(faltaDecidir.length)out.push(`decidir ${faltaDecidir.length===1?'1 experimento':`${faltaDecidir.length} experimentos`} (/lote)`);
 return out;
}
// Everything the morning to-do asks of the owner, in the order he should do it: experiments first, then batches and merges, then the team's questions.
export function decisionesDelEquipo(s:any):string[]{
 // The plain words, grouped (equipo.py para_ti): what the owner reads in /lote, the same titles in the to-do.
 const grupos:any[]=Array.isArray(s?.para_ti)?s.para_ti:[];
 if(grupos.length){
  const out=grupos.filter(g=>g.tipo!=='pregunta'&&g.titulo).map(g=>g.titulo[0].toLowerCase()+g.titulo.slice(1)+' (/lote)');
  const {faltaDecidir}=experimentosPendientes(s?.tablero||[]);
  if(faltaDecidir.length)out.unshift(`decidir ${faltaDecidir.length===1?'1 experimento':`${faltaDecidir.length} experimentos`} (/lote)`);
  for(const p of Object.values<any>(s?.proyectos||{})){const k=Number(p?.por_fusionar)||0;if(k)out.push(`juntar ${k} ${k===1?'mejora':'mejoras'} de ${p.nombre} ya ${k===1?"revisada":"revisadas"} (/lote)`);}
  const n=grupos.filter(g=>g.tipo==='pregunta').reduce((a,g)=>a+(g.claves?.length||1),0);
  if(n)out.push(`responder ${n} ${n===1?'pregunta':'preguntas'} del equipo (/mesa)`);
  return out;
 }
 const out:string[]=[...decisionesExperimentos(s?.tablero||[])];
 for(const p of Object.values<any>(s?.proyectos||{})){const n=p?.lote?.tareas?.length||0;if(p?.lote?.estado==='pendiente'&&n)out.push(`decidir ${n} ${n===1?'cosa':'cosas'} de ${p.nombre} (/lote)`);if(Number(p?.por_fusionar))out.push(`${p.nombre}: ${p.por_fusionar} cambios por fusionar`);}
 const asked=preguntasPendientes(s?.mesa,99).length;
 if(asked)out.push(`responder ${asked} ${asked===1?'pregunta':'preguntas'} del equipo (/mesa)`);
 return out;
}

// ---------- decisions one at a time (19/10: «Aprobar las 4» sat untouched for days) ----------
// A pending task of a batch: callback 'd:<project>:<index>:<s|n|l>' → equipo.py decidir (the index is stable within the batch).
const DECIDE:Record<string,{decision:string;label:string}>={s:{decision:'si',label:'✓ Sí'},n:{decision:'no',label:'✕ No'},l:{decision:'luego',label:'⏸ Más tarde'}};
export const decidirBotones=(pid:string,i:number)=>({inline_keyboard:[[{text:'Sí',callback_data:`d:${pid}:${i}:s`},{text:'No',callback_data:`d:${pid}:${i}:n`},{text:'Más tarde',callback_data:`d:${pid}:${i}:l`}]]});
export function decidirBoton(data:string):{args:string[];label:string}|null{
 const m=data.match(/^d:([a-z0-9-]{2,30}):(\d{1,3}):([snl])$/);if(!m)return null;
 return {args:['decidir',m[1],'--indice',m[2],'--decision',DECIDE[m[3]].decision],label:DECIDE[m[3]].label};
}
// A question from the team: 'q:<M id>:<s|n|l|r>' — Sí / No / Más tarde, or Responder to write the answer.
export const preguntaBotones=(id:string)=>({inline_keyboard:[[{text:'Sí',callback_data:`q:${id}:s`},{text:'No',callback_data:`q:${id}:n`},{text:'Más tarde',callback_data:`q:${id}:l`}],[{text:'Responder',callback_data:`q:${id}:r`}]]});
export function preguntaBoton(data:string):{id:string;accion:'s'|'n'|'l'|'r'}|null{
 const m=data.match(/^q:(M\d{1,6}):([snlr])$/);return m?{id:m[1],accion:m[2] as any}:null;
}
/** The questions still waiting for the owner (a real question, to him, not answered), newest last. */
export function preguntasPendientes(mesa:any,max=3):any[]{
 const m=mesa?.mensajes||[];
 return m.filter((x:any)=>x.tipo==='pregunta'&&(x.para||[]).includes('owner')&&x.de!=='owner'&&!m.some((r:any)=>r.de==='owner'&&r.responde_a===x.id)).slice(-max);
}
// «Responder»: a force-reply prompt that names the question, so the answer finds its way even after a restart.
export const RESPUESTA_INICIO='Tu respuesta a ';
export const pedirRespuesta=(id:string,quien:string)=>`${RESPUESTA_INICIO}${id} (${quien}): escríbela respondiendo a este mensaje.`;
export function respuestaA(text:string):string|null{const m=String(text||'').match(/^Tu respuesta a (M\d{1,6}) /);return m?m[1]:null;}

// ---------- what waits for the owner, in plain words (equipo.py para_ti, 19/10: «¿lanzar el qué?») ----------
// One message per group: a title, what it is, his part, why; buttons by kind. callback 'g:<group id>:<action>'.
const ICONO:Record<string,string>={lanzar:'📣',medir:'📏',decidir:'✋',pregunta:'❓'};
export function fusionPendienteDeGrupo(g:any,tablero:any):string|null{
 if(g?.tipo!=='lanzar'||!Array.isArray(tablero))return null;
 const claves=Array.isArray(g.claves)?g.claves:[];
 const item=tablero.find(it=>it?.fuente==='equipo'&&it.fase===FASE_FALTA_FUSIONAR&&claves.some((c:any)=>typeof c==='string'&&c.startsWith('l:')&&it.id===c.slice(2)));
 return typeof item?.proyecto==='string'&&PROJECT.test(item.proyecto)?item.proyecto:null;
}
export function mensajesFusion(s:any,omitir:string[]=[]):{texto:string;reply_markup:any}[]{
 const omitidos=new Set(omitir);
 return Object.entries<any>(s?.proyectos||{}).flatMap(([pid,p])=>{
  const n=Number(p?.por_fusionar)||0;if(!n||omitidos.has(pid))return [];
  const lineas:string[]=Array.isArray(p.mejoras)?p.mejoras:[];
  return [{texto:`🔗 ${p.nombre}: ${n===1?'una mejora terminada y revisada':`${n} mejoras terminadas y revisadas`} por el equipo.${lineas.length?'\n'+lineas.map(l=>'• '+l).join('\n'):''}\nTu parte: decir si ${n===1?'la junto':'las junto'} a tu proyecto. Antes lo pruebo y solo lo junto si todo sigue funcionando.`,reply_markup:{inline_keyboard:[[{text:n===1?'Sí, júntala':'Sí, júntalas',callback_data:BOTON_FUSIONAR+pid}]]}}];
 });
}
export function textoGrupo(g:any,tablero?:any):string{
 const n=g.claves?.length||1;
 return [`${ICONO[g.tipo]||'•'} ${g.titulo}`,g.que_es&&`Qué es: ${g.que_es}`,g.tu_parte&&`Tu parte: ${g.tu_parte}`,g.por_que&&`Por qué: ${g.por_que}`,
  g.tipo==='decidir'&&g.si_dices_que_si&&`Si dices que sí: ${g.si_dices_que_si}`,n>1&&g.tipo!=='pregunta'&&`(${n} fichas del equipo juntas)`,fusionPendienteDeGrupo(g,tablero)&&'Antes de lanzarlo: aún no está en la versión principal. Pulsa «Fusionar ahora» o espera a la fusión de esta noche.'].filter(Boolean).join('\n');
}
const ACCIONES:Record<string,[string,string][]>={lanzar:[['h','✓ Hecho, ya está'],['l','Ahora no'],['x','✕ No lo haré']],medir:[['m','Contar qué salió']],
 decidir:[['s','Sí, adelante'],['n','No'],['l','Más tarde']],pregunta:[['s','Sí'],['n','No'],['l','Más tarde'],['r','Responder']]};
export function botonesGrupo(g:any,tablero?:any){
 const b=(ACCIONES[g.tipo]||[]).map(([a,text])=>({text,callback_data:`g:${g.id}:${a}`}));
 const inline_keyboard=b.length>3?[b.slice(0,3),b.slice(3)]:[b];
 const pid=fusionPendienteDeGrupo(g,tablero);
 if(pid&&new TextEncoder().encode(BOTON_FUSIONAR+pid).length<=64)inline_keyboard.push([{text:'Fusionar ahora',callback_data:BOTON_FUSIONAR+pid}]);
 return {inline_keyboard};
}
export function grupoBoton(data:string):{id:string;accion:string}|null{const m=data.match(/^g:([0-9a-f]{8}):([hlxmsnr])$/);return m?{id:m[1],accion:m[2]}:null;}
export const etiquetaAccion=(tipo:string,accion:string)=>({h:'✓ Hecho',l:'⏸ Ahora no',x:'✕ No lo haré',s:tipo==='decidir'?'✓ Adelante':'✓ Sí',n:'✕ No',m:'Contando…',r:'Respondiendo…'} as Record<string,string>)[accion]||'✓';
/** The engine commands for one tap on a group: every key of the group gets the same answer. */
export function ordenesGrupo(g:any,accion:string,mesa:any):string[][]{
 const out:string[][]=[];
 for(const c of g.claves||[]){
  const [k,a,b]=String(c).split(':');
  if(k==='l'&&TAREA.test(a)){if(accion==='h')out.push(['lanzado',a,'--via','telegram']);else if(accion==='x')out.push(['descartar',a,'--texto','No se va a hacer (decidido desde Telegram).']);}
  else if(k==='d'&&PROJECT.test(a)&&/^\d{1,3}$/.test(b)&&(accion==='s'||accion==='n'))out.push(['decidir',a,'--indice',b,'--decision',accion==='s'?'si':'no']);
  else if(k==='q'&&/^M\d{1,6}$/.test(a)&&(accion==='s'||accion==='n')){const m=(mesa?.mensajes||[]).find((x:any)=>x.id===a);if(m)out.push(['mensaje',m.de,'--texto',accion==='s'?'Sí':'No','--responde-a',a]);}
 }
 return out;
}
