'use client';
// Who this copy of the app belongs to (name and nickname), from the private profile in the Mac app's data folder.
// Nothing personal is written in the interface code; without a profile it simply greets without a name.
import {useEffect,useState} from 'react';

export type Perfil={nombre:string;apodo:string};
let cached:Perfil|null=null,pending:Promise<Perfil>|null=null;
const empty:Perfil={nombre:'',apodo:''};

export function usePerfil():Perfil{
 const [p,setP]=useState<Perfil>(cached||empty);
 useEffect(()=>{if(cached)return;
  pending??=fetch('/api/perfil',{cache:'no-store'}).then(r=>r.ok?r.json():empty).then((j:any)=>(cached={nombre:String(j?.nombre||''),apodo:String(j?.apodo||'')})).catch(()=>empty);
  let alive=true;pending.then(v=>{if(alive)setP(v);});return()=>{alive=false;};},[]);
 return p;
}
// «Qué pasa, <apodo>.» with a nickname; a plain greeting without one.
export const llamar=(p:Perfil)=>p.apodo||p.nombre;
