export type FocusSession={id:string;revision:number;project:string;title:string;doneWhen:string;minutes:number;status:'ready'|'active'|'paused'|'completed';note:string;elapsed:number;startedAt:number|null;completedAt:number|null;updatedAt:number};
const steps:Record<string,[string,string,string]>={
 trabajo:['Aclara qué haces y para quién.','Una frase: a quién ayudas y con qué.','Escribe el nombre de un cliente o de tu puesto.'],
 proyecto:['Define el primer resultado.','Algo que puedas enseñar a una persona esta semana.','Escribe qué quieres enseñar primero.'],
 aprender:['Elige qué practicar hoy.','Una habilidad y 20 minutos de práctica.','Escribe la habilidad.'],
 salud:['Elige un hábito pequeño.','Un hábito, un momento del día y cómo sabrás que lo hiciste.','Escribe el hábito.'],
};
// Any project without its own steps (a new one in the notes) gets the generic three.
const generic:[string,string,string]=['Elige el siguiente paso.','Un resultado pequeño que puedas comprobar hoy.','Escribe una frase sobre el siguiente paso.'];
export const firstSteps:Record<string,[string,string,string]>=new Proxy(steps,{get:(t,k)=>typeof k==='string'?t[k]||generic:undefined});
