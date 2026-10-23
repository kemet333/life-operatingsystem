// Recorrido de un encargo a Alfred: lo comparten el detalle (alfred.tsx) y el inspector de Entregas (board.tsx).
export const REQUEST_STEPS=['Preparado','En el equipo','Resultado','Aceptado'] as const;

export function requestStep(status:string):{at:number;stuck:boolean}{
 if(status==='accepted')return {at:3,stuck:false};
 if(status==='review')return {at:2,stuck:false};
 if(status==='dispatching'||status==='linked')return {at:1,stuck:false};
 if(status==='blocked')return {at:1,stuck:true};
 if(status==='cancelled')return {at:-1,stuck:false};
 return {at:0,stuck:false};
}

export function requestResultLabel(status:string){
 if(status==='blocked')return 'Motivo del bloqueo';
 if(status==='review'||status==='accepted')return 'Resultado';
 return 'Última respuesta del equipo';
}

// Texto que se enseña de un encargo y su título: el resultado si ya lo hay, si no el encargo original.
export function requestText(e:{status:string;result?:string;body?:string}):{text:string;label?:string}{
 if((e.status==='review'||e.status==='blocked'||e.status==='accepted')&&e.result)return {text:e.result,label:requestResultLabel(e.status)};
 return {text:e.body||''};
}
