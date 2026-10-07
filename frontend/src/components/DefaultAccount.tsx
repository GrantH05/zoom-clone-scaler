'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
export default function DefaultAccount({children}:{children:React.ReactNode}){
 const [ready,setReady]=useState(false);const [error,setError]=useState(false);const [attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;setError(false);async function init(){try{if(!localStorage.getItem('zoom_user')&&!localStorage.getItem('zoom_signed_out')){const {user}=await api.defaultUser();if(!live)return;localStorage.setItem('zoom_user',JSON.stringify(user));localStorage.setItem('zoom_name',user.name)}if(live)setReady(true)}catch{if(live)setError(true)}}void init();return()=>{live=false}},[attempt]);
 if(!ready)return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#fff'}}>{error?<div><p>Unable to connect. Please check that the meeting server is running.</p><button className="primary" onClick={()=>setAttempt(v=>v+1)}>Retry</button></div>:<p>Loading…</p>}</div>;
 return <>{children}</>;
}
