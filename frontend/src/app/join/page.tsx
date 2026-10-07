 'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ZoomWordmark from '@/components/ZoomWordmark';
import { api, meetingIdFromInput } from '@/lib/api';
export default function Join(){const router=useRouter();const [value,setValue]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
async function join(){setBusy(true);setError('');const id=meetingIdFromInput(value);if(!id){router.push('/join/invalid');return}try{const r=await api.check(id);router.push(`/join/${r.exists?id:'invalid'}`)}catch{setError('Unable to reach the meeting server. Please try again.');setBusy(false)}}
return <div className="joinWebPage"><header className="joinWebHeader"><ZoomWordmark/><nav><button onClick={()=>router.push('/schedule')}>Schedule</button><button onClick={()=>router.push('/join')}>Join</button><button onClick={()=>router.push('/login')}>Sign in</button><button onClick={()=>router.push('/')}>Web App</button></nav></header><main className="joinWebForm"><h1>Join Meeting</h1><form onSubmit={e=>{e.preventDefault();void join()}}><label htmlFor="meeting-id">Meeting ID or Personal Link Name</label><input id="meeting-id" autoFocus placeholder="Enter Meeting ID or Personal Link Name" value={value} onChange={e=>setValue(e.target.value)}/><button className="primary" disabled={!value.trim()||busy}>{busy?'Joining…':'Join'}</button>{error&&<p role="alert">{error}</p>}</form></main><footer>Zoom Clone · Meeting workspace</footer></div>}
