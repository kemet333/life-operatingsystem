// Fecha relativa y breve de una entrada (es-ES, 24 h). Sin fecha válida devuelve ''.
export function since(ms:number|null|undefined,now=Date.now()):string{
 if(typeof ms!=='number'||!Number.isFinite(ms)||ms<=0)return '';
 const diff=now-ms;
 if(diff<60_000)return 'ahora mismo';
 if(diff<3_600_000)return 'hace '+Math.floor(diff/60_000)+' min';
 const d=new Date(ms),today=new Date(now);
 const hour=d.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',hour12:false});
 const day=(x:Date)=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
 const yesterday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1).getTime();
 if(day(d)===day(today))return 'hoy '+hour;
 if(day(d)===yesterday)return 'ayer '+hour;
 return d.toLocaleDateString('es-ES',{day:'numeric',month:'short'}).replace('.','');
}
