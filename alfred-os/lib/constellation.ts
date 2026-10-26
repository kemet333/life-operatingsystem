import {projects,roles,type OfficeState} from './alfred-data';
import {requestText} from './request-path';
export type MapNode={id:string;name:string;x:number;y:number;parent:string;role:string;kind:'function'|'project'|'task';description:string;data?:any};
const coordinate=(n:number)=>Math.round(n*100)/100;
export function getDepartments(compact=false,focus?:string|null){return roles.map((r,i)=>{const angle=(i*60-90)*Math.PI/180;const focused=focus===r.id;return {...r,color:['#77c9bc','#89a8df','#d49db8','#b19edc','#dca17c','#c8bf7c'][i],label:['OPERACIONES','INTELIGENCIA','PRODUCTO','CREATIVO','NEGOCIO','CONTROL'][i],angle,x:coordinate(focused?650:800+(compact?260:490)*Math.cos(angle)),y:coordinate(focused?380:380+(compact?240:210)*Math.sin(angle))};});}
export const departments=getDepartments();
const families:Record<string,string[][]>={
 alfred:[['Dirección','Foco','Ciclo semanal','Siguiente paso'],['Memoria','Ideas','Contexto','Archivo'],['Operaciones','Admisión','Dependencias','Seguimiento']],
 radar:[['Fuentes','Documentación','Repositorios','Fechas'],['Investigación','Hipótesis','Comparativas','Hallazgos'],['Contexto','Preguntas','Límites','Necesidades']],
 product:[['Producto','Alcance','Recorrido','Entrega'],['Ingeniería','Implementación','Integraciones','Correcciones'],['Validación','Pruebas','Errores','Criterios']],
 studio:[['Identidad','Dirección visual','Diseño','Marca'],['Contenido','Guiones','Textos','Piezas'],['Producción','Formato','Versión','Materiales']],
 business:[['Oferta','Comprador','Necesidad','Piloto'],['Distribución','Canales','Afiliación','Conversión'],['Negocio','Costes','Margen','Siguiente prueba']],
 control:[['Revisión','Trazabilidad','Evidencia','Veredicto'],['Calidad','Criterios','Contradicciones','Correcciones'],['Alcance','Autorización','Límites','Aceptación']],
};
export function constellation(state:OfficeState|null,compact=false,focus?:string|null){
 const departments=getDepartments(compact,focus);
 const nodes:MapNode[]=[];
 for(const d of departments){
  const focused=focus===d.id;
  const groups=families[d.id];
  groups.forEach((names,j)=>{
   const seed=d.id.split('').reduce((a,c)=>a+c.charCodeAt(0),0)+j*17;
   const a=d.angle+(j-1)*.74+((seed%7)-3)*.025;
   // In a focused department the old radial positions were compressed into one
   // small wedge. Give each family its own lane and keep the chain horizontal so
   // labels and hit targets have predictable room around them.
   // In a focused branch, fan the three families around the department hub.
   // This keeps the branch readable as a network instead of collapsing every
   // family into three parallel rows behind the detail panel.
   const focusedAngle=Math.PI+(j-1)*.72;
   const lane=focused?{x:d.x+154*Math.cos(focusedAngle),y:d.y+116*Math.sin(focusedAngle)}:{x:d.x+(61+j*9)*Math.cos(a),y:d.y+(44+j*3)*Math.sin(a)};
   let x=lane.x,y=lane.y,parent=d.id;
   names.forEach((name,k)=>{
    const id=d.id+'-group-'+j+(k?'-'+(k-1):'');
    if(k){if(focused){const length=47+((seed+k*13)%17);x+=length*Math.cos(focusedAngle);y+=length*.72*Math.sin(focusedAngle);}else{const b=a+Math.sin(seed+k*2.3)*.42;const length=40+((seed+k*13)%27);x+=length*Math.cos(b);y+=length*.65*Math.sin(b);}}
    nodes.push({id,name,x,y,parent,role:d.id,kind:'function',description:k?`${name} forma parte de ${d.name}. ${d.deliverable}`:d.description});
    parent=id;
   });
  });
  // A fresh or imported portfolio has its own IDs. Unassigned projects stay with
  // coordination; an explicit valid team can place them under another department.
  const owned=projects.filter(p=>(roles.some(r=>r.id===p.team)?p.team:'alfred')===d.id);
  owned.forEach((p,j)=>{
   const pid=p.id,a=d.angle,r=150,offset=(j-(owned.length-1)/2)*42;
   const projectCount=owned.length;
   const x=focused?d.x+260:d.x+r*Math.cos(a)-offset*.28*Math.sin(a);
   const y=focused?d.y+(j-(projectCount-1)/2)*62:d.y+r*.55*Math.sin(a)+offset;
   nodes.push({id:'project-'+pid,name:p.name,x,y,parent:focused?d.id:d.id+'-group-'+j%3+'-1',role:d.id,kind:'project',description:p.next,data:p});
  });
  const jobs=(state?.entries||[]).filter(e=>e.role===d.id&&e.kind==='request'&&!['parked','cancelled'].includes(e.status)).slice(0,3);
  jobs.forEach((job,j)=>{
   const a=d.angle+(j-1)*.22,r=213;
   nodes.push({id:'job-'+job.id,name:job.title,x:focused?d.x+260:d.x+r*Math.cos(a),y:focused?d.y+250+j*45:d.y+r*.5*Math.sin(a),parent:focused?d.id:d.id+'-group-2',role:d.id,kind:'task',description:requestText(job).text,data:job});
  });
 }
 // Stable SVG attributes across the Worker and browser math implementations.
 return nodes.map(n=>({...n,x:coordinate(n.x),y:coordinate(n.y)}));
}
