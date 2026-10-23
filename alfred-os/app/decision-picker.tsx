'use client';
// What the owner decides with a measured result: Seguir, Cambiar or Parar. Shared by Entregas and Proyectos so both screens offer the same three choices.
import {DECISIONES,type Decision} from '../lib/office-limits';

const LABELS:Record<Decision,string>={seguir:'Seguir',cambiar:'Cambiar',parar:'Parar'};

export function decisionLabel(d:unknown):string|null{
 return typeof d==='string'&&(DECISIONES as readonly string[]).includes(d)?LABELS[d as Decision]:null;
}

export function embudoExperimentos(lanz:unknown):string|null{
 const datos=lanz&&typeof lanz==='object'?lanz as Record<string,unknown>:{};
 const numero=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const avisados=numero(datos.avisados)??0,lanzados=numero(datos.lanzados),horas=numero(datos.horas_hasta_lanzar);
 const decisiones=datos.decisiones&&typeof datos.decisiones==='object'?datos.decisiones as Record<string,unknown>:{};
 const medidos=['seguir','cambiar','parar','sin_decision'].reduce((total,clave)=>total+(numero(decisiones[clave])??0),0);
 if(avisados<=0&&medidos<=0)return null;
 return [
  avisados>0?`${avisados} listos`:null,
  lanzados!==null?`${lanzados} lanzados`:null,
  horas!==null?`~${String(horas).replace('.',',')} h hasta lanzar`:null,
  medidos>0?`${medidos} medidos`:null,
  medidos>0?`${medidos-(numero(decisiones.sin_decision)??0)} con decisión`:null,
 ].filter((parte):parte is string=>parte!==null).join(' · ');
}

// Optional: tapping the chosen one again clears it.
export function DecisionPicker({value,onChange,disabled,className}:{value:Decision|null;onChange:(d:Decision|null)=>void;disabled?:boolean;className?:string}){
 return <div role="group" aria-label="Qué decides con este resultado" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:'4px 10px'}}>
  {DECISIONES.map(d=><button key={d} type="button" className={className} aria-pressed={value===d} disabled={disabled}
   style={value===d?{fontWeight:700,textDecoration:'underline'}:undefined} onClick={()=>onChange(value===d?null:d)}>{LABELS[d]}</button>)}
 </div>;
}
