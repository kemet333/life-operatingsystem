'use client';
import {useEffect,useState} from 'react';
// Hora actual en estado: se refresca cada intervalo y cuando cambia `refresh`.
export function useNow(refresh?:unknown,intervalMs=60_000):number{
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{setNow(Date.now());},[refresh]);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),intervalMs);return()=>clearInterval(t);},[intervalMs]);
 return now;
}
