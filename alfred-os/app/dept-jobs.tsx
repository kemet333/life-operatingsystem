'use client';
import {ChevronRight} from 'lucide-react';
import {ACCEPTED_VISIBLE_MS,statusNames,type Entry} from '../lib/alfred-data';
import {since} from '../lib/entry-time';
import {useNow} from '../lib/use-now';
export function DeptJobs({entries,role}:{entries:Entry[];role:string}){
 const mine=entries.filter(e=>e.role===role),counts=[['En curso',mine.filter(e=>['dispatching','linked'].includes(e.status)).length],['En cola',mine.filter(e=>e.status==='queued').length],['Para ti',mine.filter(e=>e.status==='review').length],['Bloqueados',mine.filter(e=>e.status==='blocked').length]] as const,shown=counts.filter(([,n])=>n>0);
 return shown.length?<div className="j-dept-counts">{shown.map(([label,n])=><span key={label} className={label==='Para ti'?'is-review':undefined}><b>{n}</b> {label}</span>)}</div>:null;
}
export function DeptRequests({entries,role,onOpen}:{entries:Entry[];role:string;onOpen:(e:Entry)=>void}){
 const now=useNow(),rank=(s:string)=>s==='review'?0:s==='blocked'?1:['dispatching','linked'].includes(s)?2:3,jobs=entries.filter(e=>e.role===role&&!['parked','cancelled'].includes(e.status)&&!(e.status==='accepted'&&e.updated_at<now-ACCEPTED_VISIBLE_MS)).sort((a,b)=>rank(a.status)-rank(b.status)||b.updated_at-a.updated_at);
 return jobs.length?jobs.slice(0,5).map(e=>{const ago=since(e.updated_at,now);return <button className="j-dept-job" key={e.id} onClick={()=>onOpen(e)}><span>{e.title}<small>{statusNames[e.status]||e.status}{ago?' · '+ago:''}</small></span><ChevronRight size={14}/></button>;}):<p>Ningún encargo suelto a Alfred en esta rama.</p>;
}
