export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
export const WS = process.env.NEXT_PUBLIC_WS_URL || API.replace(/^http/, 'ws');

export type User = { id:number; email:string; name:string };
export type Meeting = { id:number; meeting_id:string; title:string; description:string; scheduled_at:string|null; duration_minutes:number; host_name:string; owner_user_id:number|null; created_at:string; is_scheduled:boolean; host_video?:boolean; participant_video?:boolean; invite_link:string };

async function request<T>(path:string, options:RequestInit={}) : Promise<T> {
  const res = await fetch(`${API}${path}`, { ...options, headers:{'Content-Type':'application/json', ...(options.headers||{})} });
  if(!res.ok) throw new Error((await res.json().catch(()=>({detail:'Request failed'}))).detail || 'Request failed');
  return res.json();
}
export const api = {
  defaultUser:()=>request<{user:User}>('/api/auth/default'),
  activeMeeting:(userId:number)=>request<{active:boolean;meeting_id:string|null}>(`/api/active-meeting?user_id=${userId}`),
  login:(body:{email:string;password:string})=>request<{user:User}>('/api/auth/login',{method:'POST',body:JSON.stringify(body)}),
  register:(body:{email:string;password:string;name:string})=>request<{user:User}>('/api/auth/register',{method:'POST',body:JSON.stringify(body)}),
  meetings:(userId:number)=>request<Meeting[]>(`/api/meetings?user_id=${userId}`),
  meeting:(id:string)=>request<Meeting>(`/api/meetings/${id}`),
  create:(body:Partial<Meeting> & {title?:string; description?:string; scheduled_at?:string|null; duration_minutes?:number; host_name?:string; is_scheduled?:boolean; owner_user_id:number})=>request<Meeting>('/api/meetings',{method:'POST',body:JSON.stringify(body)}),
  check:(meeting_id:string)=>request<{exists:boolean;meeting:Meeting|null}>('/api/meetings/check',{method:'POST',body:JSON.stringify({meeting_id})}),
  delete:(id:string,userId:number)=>request<{deleted:boolean}>(`/api/meetings/${id}?user_id=${userId}`,{method:'DELETE'})
};

export function meetingIdFromInput(value:string):string{
  let id=value.trim();
  try{const url=new URL(id);const match=url.pathname.match(/\/(?:join|meeting)\/([^/]+)/);if(!match)return '';id=decodeURIComponent(match[1]);}catch{}
  id=id.split(/[?#]/)[0].replace(/[ -]/g,'');
  return /^\d{9}$/.test(id)?id:'';
}
export function inviteLink(id:string):string{return `${window.location.origin}/join/${id.replace(/[ -]/g,'')}`;}
