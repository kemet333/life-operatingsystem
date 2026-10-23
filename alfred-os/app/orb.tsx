'use client';
import {useEffect,useRef} from 'react';
export type OrbMode='idle'|'listening'|'thinking'|'speaking';
type Point=[number,number,number];
type Projection={x:number;y:number;z:number};
const TAU=Math.PI*2,STRANDS=22,SAMPLES=136,LAYERS=8;
// One deterministic sculpture. State changes never replace or restart it: they only change how it moves.
const strands:Point[][]=Array.from({length:STRANDS},(_,j)=>Array.from({length:SAMPLES+1},(_,i)=>{
 const t=i/SAMPLES*TAU,phase=j/STRANDS*TAU,r=.63+.285*Math.cos(3*t+phase);
 const x=r*Math.cos(t),y=.285*Math.sin(3*t+phase),z=r*Math.sin(t),a=(j/STRANDS-.5)*1.35;
 return [x,y*Math.cos(a)-z*Math.sin(a),y*Math.sin(a)+z*Math.cos(a)];
}));
// Motion signature per state; the live values ease toward these so changes never jump.
//  spin: turning speed · gather: pull toward the core (listening leans in) · ripple: waves along the filaments
//  swirl: counter-rotation of alternate filaments (thinking) · pulse: how far speech pushes the filaments out
//  lights: speed of the travelling lights · bright: base luminosity
const SIGNATURES:Record<OrbMode,{spin:number;gather:number;ripple:number;swirl:number;pulse:number;lights:number;bright:number}>={
 idle:     {spin:.14,gather:0,  ripple:0, swirl:0, pulse:0, lights:.045,bright:.18},
 listening:{spin:.05,gather:.07,ripple:1, swirl:0, pulse:0, lights:.03, bright:.42},
 thinking: {spin:.38,gather:.02,ripple:.25,swirl:1,pulse:0, lights:.16, bright:.56},
 speaking: {spin:.17,gather:-.02,ripple:0,swirl:0, pulse:1, lights:.07, bright:.66},
};
const clamp=(v:number)=>Math.max(0,Math.min(1,Number.isFinite(v)?v:0));

export default function Orb({mode,level=0,calm=false,subdued=false}:{mode:OrbMode;level?:number;calm?:boolean;subdued?:boolean}){
 const ref=useRef<HTMLCanvasElement>(null),live=useRef({mode,level,calm,subdued}),refresh=useRef<()=>void>(()=>{});
 live.current={mode,level,calm,subdued};
 useEffect(()=>{
  const canvas=ref.current!,ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx){canvas.classList.add('orb-fallback');return;}
  // Treat a newly mounted canvas as visible until the observer reports otherwise.
  let w=1,h=1,dpr=1,frame=0,last=0,clock=0,turn=0,visible=true,disposed=false;
  let targetX=0,targetY=0,tiltX=0,tiltY=0,pointerX=0,pointerY=0,inside=false,hover=0;
  // The pointer is a hand in the sculpture: its velocity stirs nearby filaments and spins the whole orb.
  let lastPX=0,lastPY=0,lastPT=0,velX=0,velY=0,wakeX=0,wakeY=0,spinVel=0,tiltVel=0;
  // Voice envelope: loudness normalised against its own decaying peak, fast attack and slow release,
  // so the orb rides syllables instead of flickering with every sample.
  let env=0,peak=.05,burst=0,sonar=0,sweep=0,lastEnv=0;
  const sig={...SIGNATURES.idle};
  let ca=1,sa=0,cb=1,sb=0,cc=1,sc=0;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const moving=()=>!reduced.matches&&visible&&!document.hidden&&!disposed;
  function shape(p:Point,j:number,k:number):Point{
   let [x,y,z]=p;const t=k/SAMPLES*TAU;
   // Speech pushes filaments out in a syllable-shaped wave; listening gathers them and lets ripples travel inward.
   const wave=Math.sin(3*t+j*1.7+clock*7.5)*.6+Math.sin(5*t-j*.9+clock*4.1)*.4;
   const scale=1-sig.gather*(.6+env*.6)+sig.pulse*env*(.05+.06*wave)+burst*.07
    -sig.ripple*(.012+env*.05)*Math.sin(t*4+clock*5.5+j*.8);
   x*=scale;z*=scale;y*=1+(scale-1)*.6;
   if(sig.swirl>.01){const a=sig.swirl*Math.sin(clock*1.25+j*.7)*.16*(j%2?1:-1),c=Math.cos(a),s=Math.sin(a);[x,z]=[x*c+z*s,-x*s+z*c];}
   return [x,y,z];
  }
  function project(p:Point,breath:number):Projection{
   let [x,y,z]=p;
   [y,z]=[y*ca-z*sa,y*sa+z*ca];[x,z]=[x*cb+z*sb,-x*sb+z*cb];[x,y]=[x*cc-y*sc,x*sc+y*cc];
   const scale=3.35/(3.35-z),r=Math.min(w,h)*.405*breath;
   let px=w/2+x*r*scale,py=h/2-y*r*scale;
   if(hover>.01||Math.abs(wakeX)+Math.abs(wakeY)>.5){
    // Near the cursor the filaments part a little and are dragged along the direction of the gesture, like threads in water.
    const dx=px-pointerX,dy=py-pointerY,d2=dx*dx+dy*dy,g=Math.exp(-d2/(2*(r*.36)**2)),d=Math.sqrt(d2)||1;
    const part=hover*g*r*.07*Math.min(1,d/(r*.12));
    px+=dx/d*part+wakeX*g;py+=dy/d*part+wakeY*g;
   }
   return {x:px,y:py,z};
  }
  function pointOnStrand(j:number,u:number):[Point,number]{
   const v=((u%1)+1)%1*SAMPLES,k=Math.floor(v),f=v-k,a=strands[j][k],b=strands[j][k+1];
   return [[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f,a[2]+(b[2]-a[2])*f],k];
  }
  function ring(radius:number,alpha:number,width=1,from=0,to=TAU){
   if(alpha<.004||radius<=0)return;
   ctx!.beginPath();ctx!.arc(w/2,h/2,radius,from,to);ctx!.strokeStyle=`rgba(176,204,240,${alpha})`;ctx!.lineWidth=width;ctx!.stroke();
  }
  function render(dt=0){
   if(disposed)return;
   const {mode,level,calm,subdued}=live.current,still=calm||reduced.matches,target=SIGNATURES[mode]||SIGNATURES.idle;
   const ease=still?1:1-Math.exp(-dt*3.2);
   for(const key of Object.keys(sig) as (keyof typeof sig)[])sig[key]+=(target[key]-sig[key])*ease;
   const raw=mode==='idle'?0:clamp(level);
   peak=Math.max(raw,.05,peak-.5*peak*dt);
   const want=Math.min(1,raw/peak);
   env=still?want*.5:env+(want-env)*Math.min(1,dt/(want>env?.05:.35));
   if(mode==='speaking'&&env-lastEnv>.32)burst=1;           // a strong onset throws a ring
   lastEnv=env;burst*=Math.exp(-dt*3.2);
   hover+=((inside&&!still?1:0)-hover)*(1-Math.exp(-dt*4));
   const energy=sig.bright+env*.28+hover*.12;
   if(!still){tiltX+=(targetX-tiltX)*(1-Math.exp(-dt*5));tiltY+=(targetY-tiltY)*(1-Math.exp(-dt*5));}
   if(!still){
    // The wake follows the pointer's velocity and relaxes back; a quick swipe leaves spin that slowly dies away.
    const k=1-Math.exp(-dt*9),R0=Math.min(w,h)*.405;wakeX+=(Math.max(-1,Math.min(1,velX/900))*R0*.22-wakeX)*k;wakeY+=(Math.max(-1,Math.min(1,velY/900))*R0*.22-wakeY)*k;
    velX*=Math.exp(-dt*6);velY*=Math.exp(-dt*6);
    turn+=spinVel*dt;tiltY+=tiltVel*dt;spinVel*=Math.exp(-dt*1.4);tiltVel*=Math.exp(-dt*2.2);tiltY*=Math.exp(-dt*.8);
   }
   const cadence=calm?.42:subdued?.72:1;
   turn+=dt*sig.spin*cadence*(1+hover*.35);
   const ax=.63+tiltY,ay=.55+turn+tiltX,az=.17+Math.sin(clock*.21*cadence)*.04;
   ca=Math.cos(ax);sa=Math.sin(ax);cb=Math.cos(ay);sb=Math.sin(ay);cc=Math.cos(az);sc=Math.sin(az);
   const breath=1+Math.sin(clock*.7*cadence)*(.03+energy*.012)+hover*.02;
   const r=Math.min(w,h)*.405*breath;
   ctx!.setTransform(dpr,0,0,dpr,0,0);ctx!.clearRect(0,0,w,h);

   // Halo rings: sonar while idle, an inward ripple while listening, a sweep while thinking, a burst on speech.
   if(!still){
    sonar=(sonar+dt/(mode==='idle'?6:3.2))%1;
    if(mode==='idle'||sig.ripple<.2)ring(r*(.72+sonar*.55),.07*(1-sonar)*(1-sig.swirl),1);
    if(sig.ripple>.05)ring(r*(1.22-sonar*.42),sig.ripple*(.04+env*.16)*(sonar),1+env);
    if(sig.swirl>.05){sweep+=dt*2.2;ring(r*1.1,.22*sig.swirl,1.2,sweep,sweep+.9);ring(r*1.1,.08*sig.swirl,1.2,sweep+Math.PI,sweep+Math.PI+.5);}
    if(burst>.02)ring(r*(1.02+(1-burst)*.4),.32*burst,1.6);
   }
   if(hover>.02){
    const glow=ctx!.createRadialGradient(pointerX,pointerY,0,pointerX,pointerY,r*.55);
    glow.addColorStop(0,`rgba(180,210,248,${.07*hover})`);glow.addColorStop(1,'rgba(180,210,248,0)');
    ctx!.fillStyle=glow;ctx!.beginPath();ctx!.arc(pointerX,pointerY,r*.55,0,TAU);ctx!.fill();
   }

   const buckets:Array<Array<[Projection,Projection]>>=Array.from({length:LAYERS},()=>[]);
   const dots:Array<Projection&{depth:number;index:number}>=[];
   for(let j=0;j<STRANDS;j++){
    const points=strands[j].map((p,k)=>project(shape(p,j,k),breath));
    for(let k=1;k<points.length;k++){
     const a=points[k-1],b=points[k],z=(a.z+b.z)*.5;
     buckets[Math.max(0,Math.min(LAYERS-1,Math.floor((z+1)*.5*LAYERS)))].push([a,b]);
    }
    for(let k=0;k<3;k++){
     // The same lights persist through every state; only their speed changes.
     const [q,idx]=pointOnStrand(j,j*.618+k/3+clock*sig.lights*(j%2?1:-1)),p=project(shape(q,j,idx),breath);
     dots.push({...p,depth:Math.max(0,Math.min(1,(p.z+1)*.5)),index:j+k});
    }
   }
   for(let i=0;i<LAYERS;i++){
    const depth=i/(LAYERS-1),alpha=.035+Math.pow(depth,1.75)*(.44+energy*.14);
    ctx!.beginPath();for(const [a,b] of buckets[i]){ctx!.moveTo(a.x,a.y);ctx!.lineTo(b.x,b.y);}
    ctx!.strokeStyle=`rgba(${155+Math.round(depth*53)},${169+Math.round(depth*49)},${188+Math.round(depth*45)},${alpha})`;
    ctx!.lineWidth=.37+depth*.76+env*.25*depth;ctx!.lineCap='round';ctx!.stroke();
    if(i>=LAYERS-2){ctx!.strokeStyle=`rgba(172,203,241,${alpha*(.075+env*.08)})`;ctx!.lineWidth=4.5+env*3;ctx!.stroke();}
   }
   dots.sort((a,b)=>a.z-b.z);
   for(const p of dots){
    const near=hover>.01?hover*Math.exp(-((pointerX-p.x)**2+(pointerY-p.y)**2)/(2*(r*.3)**2)):0;
    const alpha=Math.min(1,.09+Math.pow(p.depth,1.7)*.76+near*.5),radius=(.52+p.depth*.92)*(1+energy*.2+near*.6);
    if(p.depth>.65||near>.2){const glow=ctx!.createRadialGradient(p.x,p.y,0,p.x,p.y,6*radius);glow.addColorStop(0,`rgba(164,196,237,${alpha*(.16+env*.1)})`);glow.addColorStop(1,'rgba(164,196,237,0)');ctx!.fillStyle=glow;ctx!.beginPath();ctx!.arc(p.x,p.y,6*radius,0,TAU);ctx!.fill();}
    ctx!.fillStyle=p.index%7?`rgba(222,230,242,${alpha})`:`rgba(150,187,231,${alpha})`;
    ctx!.beginPath();ctx!.arc(p.x,p.y,radius,0,TAU);ctx!.fill();
   }
  }
  function tick(now:number){
   frame=0;if(!moving())return;
   const elapsed=(now-last)/1000;
   // 60 fps while it is reacting (voice, hover, transitions); 30 fps at rest to save energy.
   const busy=live.current.mode!=='idle'||hover>.02||inside||Math.abs(spinVel)>.02||Math.abs(wakeX)+Math.abs(wakeY)>.5;
   if(elapsed>=(busy?1/60:1/30)){const dt=Math.min(elapsed,.06);clock+=dt*(live.current.subdued?.4:1);render(dt);last=now;}
   frame=requestAnimationFrame(tick);
  }
  function schedule(){
   cancelAnimationFrame(frame);frame=0;last=performance.now();
   if(!document.hidden&&visible)render();
   if(moving())frame=requestAnimationFrame(tick);
  }
  function resize(){
   const rect=canvas.getBoundingClientRect();w=Math.max(1,rect.width);h=Math.max(1,rect.height);dpr=Math.min(window.devicePixelRatio||1,1.5);
   canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);schedule();
  }
  const sizeObserver=new ResizeObserver(resize),viewObserver=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;schedule();});
  function pointer(e:PointerEvent){
   if(!moving()||e.pointerType==='touch')return;
   // The canvas itself ignores the mouse (pointer-events:none, the button around it takes the clicks), so we listen on the
   // window and react whenever the cursor is over the orb's area.
   const box=canvas.getBoundingClientRect();
   if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom){if(inside)leave();return;}
   const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,now=performance.now(),gap=Math.max(8,now-lastPT);
   if(inside&&gap<120){const vx=(x-lastPX)/gap*1000,vy=(y-lastPY)/gap*1000;velX+=(vx-velX)*.5;velY+=(vy-velY)*.5;
    // Horizontal sweeps spin the orb, vertical ones tip it; capped so it never whips around.
    spinVel=Math.max(-2.4,Math.min(2.4,spinVel+vx/r.width*.018));tiltVel=Math.max(-.8,Math.min(.8,tiltVel+vy/r.height*.006));}
   lastPX=x;lastPY=y;lastPT=now;pointerX=x;pointerY=y;inside=true;
   targetX=(pointerX/r.width-.5)*.32;targetY=(pointerY/r.height-.5)*.32;
  }
  function leave(){targetX=0;targetY=0;inside=false;}
  sizeObserver.observe(canvas);viewObserver.observe(canvas);document.addEventListener('visibilitychange',schedule);reduced.addEventListener('change',schedule);window.addEventListener('pointermove',pointer,{passive:true});document.addEventListener('pointerleave',leave);
  refresh.current=schedule;resize();
  return()=>{disposed=true;refresh.current=()=>{};cancelAnimationFrame(frame);sizeObserver.disconnect();viewObserver.disconnect();document.removeEventListener('visibilitychange',schedule);reduced.removeEventListener('change',schedule);window.removeEventListener('pointermove',pointer);document.removeEventListener('pointerleave',leave);};
 },[]);
 useEffect(()=>{refresh.current();},[mode,calm,subdued]);
 return <canvas ref={ref} className={'j-orb-canvas j-filament-canvas '+mode} aria-hidden="true"/>;
}
