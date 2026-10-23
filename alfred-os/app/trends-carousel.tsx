'use client';
// Cover-flow preview of the pieces in Tendencias (after the owner's iPad reference): the centre cover faces you,
// the rest turn away in depth. Arrows, horizontal scroll, drag or a click on a side cover move it; a click on
// the centre opens the piece in the inspector. Covers come from /api/tendencias/miniatura, cached on the Mac.
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {ChevronLeft,ChevronRight,ExternalLink} from 'lucide-react';
import './trends-carousel.css';

export type CoverPiece={id:number;platform:string;url:string;author:string;marca:string;format:string|null;thumb?:boolean;vistas_dia:number;views:number;hook:string|null;title:string|null;caption:string|null};
const PLAT:Record<string,string>={tiktok:'TikTok',instagram:'Instagram',youtube:'YouTube',x:'X',douyin:'Douyin',xiaohongshu:'Xiaohongshu'};
const num=(n:number)=>n?new Intl.NumberFormat('es-ES',{notation:'compact',maximumFractionDigits:1}).format(n):'—';
const text=(p:CoverPiece)=>(p.hook||p.title||p.caption||'(sin texto)').replace(/\s+/g,' ').trim();
const RANGE=7;

function Cover({p,offset,onClick}:{p:CoverPiece;offset:number;onClick:()=>void}){
 const [broken,setBroken]=useState(!p.thumb),abs=Math.abs(offset),side=Math.sign(offset);
 // Centre faces front and comes forward; the rest fold back like records on a shelf, closer together further out.
 const x=offset===0?0:side*(150+(abs-1)*62),z=offset===0?60:-90-abs*28,ry=offset===0?0:-side*58;
 return <button className={'tc-cover'+(offset===0?' center':'')} onClick={onClick} tabIndex={offset===0?0:-1}
  aria-label={offset===0?`Abrir: ${text(p)}`:`Ver: ${text(p)}`} aria-current={offset===0?'true':undefined}
  style={{transform:`translate3d(${x}px,0,${z}px) rotateY(${ry}deg)`,zIndex:100-abs,opacity:abs>RANGE-1?0:1,'--dim':Math.min(.62,abs*.13)} as CSSProperties}>
  {broken
   ?<span className="tc-type"><small>{PLAT[p.platform]||p.platform}</small><b>{text(p).slice(0,120)}</b></span>
   :<img src={`/api/tendencias/miniatura?id=${p.id}`} alt="" draggable={false} onError={()=>setBroken(true)}/>}
  <span className="tc-badge">{PLAT[p.platform]||p.platform}</span>
 </button>;
}

export default function TrendsCarousel({piezas,selectedId,onCenter,onOpen}:{piezas:CoverPiece[];selectedId:number|null;onCenter:(id:number)=>void;onOpen:(id:number)=>void}){
 const start=Math.max(0,piezas.findIndex(p=>p.id===selectedId));
 const [index,setIndex]=useState(start),stage=useRef<HTMLDivElement>(null),drag=useRef<{x:number;i:number;moved:boolean}|null>(null),wheel=useRef(0);
 const clamp=(i:number)=>Math.max(0,Math.min(piezas.length-1,i));
 useEffect(()=>{setIndex(i=>clamp(i));},[piezas.length]);// eslint-disable-line
 useEffect(()=>{const p=piezas[index];if(p)onCenter(p.id);},[index,piezas]);// eslint-disable-line
 const go=(d:number)=>setIndex(i=>clamp(i+d));
 useEffect(()=>{
  const el=stage.current;if(!el)return;
  // Trackpad: horizontal swipes (or shift+scroll) step one cover at a time, with a short cooldown.
  const onWheel=(e:WheelEvent)=>{const d=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.shiftKey?e.deltaY:0;if(!d)return;e.preventDefault();
   const now=performance.now();if(now-wheel.current<140||Math.abs(d)<4)return;wheel.current=now;go(d>0?1:-1);};
  el.addEventListener('wheel',onWheel,{passive:false});return()=>el.removeEventListener('wheel',onWheel);
 },[piezas.length]);// eslint-disable-line
 const center=piezas[index];
 if(!center)return <div className="tc-empty">Nada con estos filtros.</div>;
 return <div className="tc" onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();go(1);}if(e.key==='ArrowLeft'){e.preventDefault();go(-1);}if(e.key==='Enter'){e.preventDefault();onOpen(center.id);}}}>
  <div className="tc-stage" ref={stage}
   onPointerDown={e=>{drag.current={x:e.clientX,i:index,moved:false};}}
   onPointerMove={e=>{const d=drag.current;if(!d||!(e.buttons&1))return;const steps=Math.round((d.x-e.clientX)/90);if(steps){d.moved=true;setIndex(clamp(d.i+steps));}}}
   onPointerUp={()=>{setTimeout(()=>{drag.current=null;},0);}}>
   <div className="tc-track">
    {piezas.map((p,i)=>Math.abs(i-index)<=RANGE&&<Cover key={p.id} p={p} offset={i-index} onClick={()=>{if(drag.current?.moved)return;i===index?onOpen(p.id):setIndex(i);}}/>)}
   </div>
  </div>
  <div className="tc-caption" aria-live="polite">
   <button className="tc-nav" onClick={()=>go(-1)} disabled={index===0} aria-label="Anterior"><ChevronLeft size={18}/></button>
   <div className="tc-copy">
    <b>{text(center)}</b>
    <small>@{String(center.author||'').replace(/^@/,'')} · {center.marca}{center.format&&center.format!=='otro'?' · '+center.format:''} · <strong>{num(center.vistas_dia)}</strong> al día · {num(center.views)} vistas</small>
   </div>
   <a className="tc-open" href={center.url} target="_blank" rel="noreferrer" aria-label={'Abrir en '+(PLAT[center.platform]||center.platform)}><ExternalLink size={15}/></a>
   <button className="tc-nav" onClick={()=>go(1)} disabled={index===piezas.length-1} aria-label="Siguiente"><ChevronRight size={18}/></button>
  </div>
  <p className="tc-count">{index+1} de {piezas.length}</p>
 </div>;
}
