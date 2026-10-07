'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { api, Meeting, WS } from '@/lib/api';
import { Camera, CameraOff, Circle, Copy, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, OctagonX, Send, Info, Heart, ShieldCheck, ChevronDown, Smile, ChevronUp, UserMinus, Users, Volume2, X } from 'lucide-react';

type Person={peerId:string;name:string;muted:boolean;cameraOff:boolean;host?:boolean;userId?:number;screenOn?:boolean;status?:string};
type Remote={pc:RTCPeerConnection;stream:MediaStream;screenStream:MediaStream;screenSender:RTCRtpSender|null};
type Reaction={peerId:string;id:string;name:string;emoji:string};

const stopStream=(stream:MediaStream|null)=>stream?.getTracks().forEach(t=>{try{t.stop()}catch{}});

export default function MeetingRoom(){
 const {id}=useParams<{id:string}>();
 const qs=useSearchParams();
 const router=useRouter();
 const name=qs.get('name')||'Guest';
 const userId=Number(qs.get('userId')||0);
 const initialMuted=qs.get('muted')==='1';const initialCameraOff=qs.get('cameraOff');
 const mini=qs.get('mini')==='1';
 const queryHost=qs.get('host')==='1';
 const [meeting,setMeeting]=useState<Meeting|null>(null);
 const [connected,setConnected]=useState(false);
 const [wsStatus,setWsStatus]=useState('Connecting…');
 const [muted,setMuted]=useState(initialMuted);
 const [cameraOff,setCameraOff]=useState(false);
 const [screenOn,setScreenOn]=useState(false);
 const [recording,setRecording]=useState(false);
 const [videoPage,setVideoPage]=useState(0);const [chatPreview,setChatPreview]=useState<{name:string;text:string}|null>(null);const [unread,setUnread]=useState(0);const seenMessage=useRef('');
 const [panels,setPanels]=useState<('people'|'chat')[]>([]);const togglePanel=(kind:'people'|'chat')=>setPanels(v=>v.includes(kind)?v.filter(p=>p!==kind):[...v,kind]);const openPanel=(kind:'people'|'chat')=>setPanels(v=>v.includes(kind)?v:[...v,kind]);
 const [openMenu,setOpenMenu]=useState<'host'|'reactions'|'more'|'info'|null>(null);const more=openMenu==='host';const recordMenu=openMenu==='more';const reactionMenu=openMenu==='reactions';const infoOpen=openMenu==='info';const toggleMenu=(menu:'host'|'reactions'|'more'|'info')=>setOpenMenu(v=>v===menu?null:menu);
 const [moreReactions,setMoreReactions]=useState(false);const [status,setStatus]=useState('');
 useEffect(()=>{if(!openMenu)return;const outside=(e:PointerEvent)=>{if(!(e.target instanceof Element)||!e.target.closest(`[data-meeting-menu="${openMenu}"]`))setOpenMenu(null)};const key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpenMenu(null)};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key)}},[openMenu]);
 const [screenStream,setScreenStream]=useState<MediaStream|null>(null);
 const [videoWidth,setVideoWidth]=useState(280);
 const shareArea=useRef<HTMLDivElement>(null);
 const [people,setPeople]=useState<Person[]>([]);
 const [messages,setMessages]=useState<{id:string;peerId:string;name:string;text:string;sentAt:string}[]>([]);
 const [chat,setChat]=useState('');
 const [reactions,setReactions]=useState<Reaction[]>([]);
 useEffect(()=>{const latest=messages.at(-1);if(panels.includes('chat')){setChatPreview(null);setUnread(0)}if(!latest||seenMessage.current===latest.id)return;seenMessage.current=latest.id;if(!panels.includes('chat')&&latest.peerId!==selfId.current){setChatPreview({name:latest.name,text:latest.text});setUnread(v=>v+1)}},[messages,panels]);
 useEffect(()=>{if(!chatPreview)return;const timer=setTimeout(()=>setChatPreview(null),6000);return()=>clearTimeout(timer)},[chatPreview]);
 const [toast,setToast]=useState('');
 const [removed,setRemoved]=useState(false);
 const [ended,setEnded]=useState(false);
 const [switched,setSwitched]=useState(false);
 const [sessionConflict,setSessionConflict]=useState(false);
 const [activeMeetingId,setActiveMeetingId]=useState('');

 const [remotes,setRemotes]=useState<Record<string,{stream:MediaStream;screenStream:MediaStream;name:string;muted:boolean;cameraOff:boolean}>>({});
 useEffect(()=>{setVideoPage(v=>Math.min(v,Math.max(0,Math.ceil((1+Object.keys(remotes).length)/6)-1)))},[Object.keys(remotes).length]);
 useEffect(()=>{if(ended&&!mini)router.replace(`/?feedback=${encodeURIComponent(id)}`)},[ended,mini,id,router]);
 const [isHost,setIsHost]=useState(queryHost);
 const [endMenu,setEndMenu]=useState(false);
 const wsRef=useRef<WebSocket|null>(null);
 const pcs=useRef<Record<string,Remote>>({});
 const pendingIce=useRef<Record<string,RTCIceCandidateInit[]>>({});
 const localVideo=useRef<HTMLVideoElement>(null);
 const recorder=useRef<MediaRecorder|null>(null);
 const chunks=useRef<Blob[]>([]);
 const screenTrack=useRef<MediaStreamTrack|null>(null);
 const selfId=useRef(crypto.randomUUID());
 const streamRef=useRef<MediaStream|null>(null);
 const mountedRef=useRef(true);
 const attachLocalVideo=useCallback((node:HTMLVideoElement|null)=>{localVideo.current=node;if(node)node.srcObject=streamRef.current},[]);
 const peopleRef=useRef<Person[]>([]);
 const cameraOffRef=useRef(false);
 cameraOffRef.current=cameraOff;
 const leavingRef=useRef(false);
 const releaseMedia=()=>{stopStream(streamRef.current);stopStream(screenTrack.current?new MediaStream([screenTrack.current]):null);streamRef.current=null;screenTrack.current=null;if(recorder.current?.state==='recording')recorder.current.stop();Object.values(pcs.current).forEach(x=>x.pc.close());pcs.current={};pendingIce.current={};};
 const switchingRef=useRef(false);
 const notify=(s:string)=>{setToast(s);window.setTimeout(()=>setToast(''),2200)};
 const send=useCallback((x:any)=>{const ws=wsRef.current;if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(x));},[]);

 const setPeopleSafe=useCallback((updater:Person[]|((v:Person[])=>Person[]))=>{
   const next=typeof updater==='function'?updater(peopleRef.current):updater;peopleRef.current=next;setPeople(next);
 },[]);
 const updateRemote=useCallback((peerId:string,patch:Partial<{name:string;muted:boolean;cameraOff:boolean;stream:MediaStream;screenStream:MediaStream}>)=>{
   setRemotes(v=>v[peerId]?({...v,[peerId]:{...v[peerId],...patch}}):v);
 },[]);

 useEffect(()=>{
   mountedRef.current=true;
   api.meeting(id).then(setMeeting).catch(()=>router.replace('/'));
   return()=>{
     if(!mini&&!leavingRef.current&&userId>0)sessionStorage.setItem('zoom_home_handoff',JSON.stringify({meetingId:id,userId,at:Date.now()}));
     mountedRef.current=false;
     if(recorder.current?.state==='recording')recorder.current.stop();
     Object.values(pcs.current).forEach(x=>x.pc.close());
     pcs.current={}; pendingIce.current={};
     try{wsRef.current?.close()}catch{}
     stopStream(streamRef.current); stopStream(screenTrack.current?new MediaStream([screenTrack.current]):null);
     streamRef.current=null; screenTrack.current=null;
   };
 },[id,router]);

 useEffect(()=>{
   if(!meeting)return;
   const normalized=meeting.meeting_id.replaceAll(' ','');
   const current={meetingId:normalized,title:meeting.title,host:queryHost,userId,muted,cameraOff};
   if(userId>0)localStorage.setItem('zoom_active_meeting',JSON.stringify(current));
   setActiveMeetingId(normalized);
 },[meeting,queryHost,userId,muted,cameraOff]);

 const closePeer=useCallback((peerId:string)=>{
   pcs.current[peerId]?.pc.close(); delete pcs.current[peerId]; delete pendingIce.current[peerId];
   setRemotes(v=>{const n={...v};delete n[peerId];return n});
   setPeopleSafe(v=>v.filter(p=>p.peerId!==peerId));
 },[setPeopleSafe]);

 const makePc=useCallback(async(peerId:string,offer:boolean,stream:MediaStream,peerName='Participant')=>{
   if(pcs.current[peerId])return pcs.current[peerId].pc;
   const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
   const remote=new MediaStream();
   const remoteScreen=new MediaStream();
   // Stable media slots: microphone, camera, screen. Reserve screen before the
   // first offer so sharing never replaces camera or needs renegotiation.
   let screenSender:RTCRtpSender|null=null;
   if(offer){
     pc.addTransceiver(stream.getAudioTracks()[0]||'audio',{direction:'sendrecv'});
     pc.addTransceiver(stream.getVideoTracks()[0]||'video',{direction:'sendrecv'});
     screenSender=pc.addTransceiver(screenTrack.current||'video',{direction:'sendrecv'}).sender;
   }
   // Answerers attach media to the slots created by the remote offer.
   pcs.current[peerId]={pc,stream:remote,screenStream:remoteScreen,screenSender};
   pendingIce.current[peerId]??=[];
   setRemotes(v=>v[peerId]?v:{...v,[peerId]:{stream:remote,screenStream:remoteScreen,name:peerName,muted:false,cameraOff:false}});
   pc.ontrack=e=>{
     const destination=e.transceiver===pc.getTransceivers()[2]?remoteScreen:remote;
     if(!destination.getTracks().some(t=>t.id===e.track.id))destination.addTrack(e.track);
     updateRemote(peerId,{stream:remote,screenStream:remoteScreen});
   };
   pc.onicecandidate=e=>{if(e.candidate)send({type:'ice-candidate',target:peerId,candidate:e.candidate.toJSON()});};
   pc.onconnectionstatechange=()=>{
     if(['failed','closed'].includes(pc.connectionState))closePeer(peerId);
   };
   if(offer){
     const o=await pc.createOffer();
     await pc.setLocalDescription(o);
     send({type:'offer',target:peerId,sdp:pc.localDescription});
   }
   return pc;
 },[send,updateRemote,closePeer]);

 const flushIce=useCallback(async(peerId:string,pc:RTCPeerConnection)=>{
   const queued=pendingIce.current[peerId]||[]; pendingIce.current[peerId]=[];
   for(const candidate of queued){try{await pc.addIceCandidate(candidate)}catch{}}
 },[]);

 const addReaction=useCallback((r:Reaction)=>{
   setReactions(v=>[...v,r]);
   window.setTimeout(()=>setReactions(v=>v.filter(x=>x.id!==r.id)),10000);
 },[]);

 const handleSignal=useCallback(async(data:any,stream:MediaStream)=>{
   if(data.type==='room-state'){
     const ps=(data.peers as Person[]).filter(p=>p.peerId!==selfId.current);
     setPeopleSafe(ps);
     if(data.self){setIsHost(Boolean(data.self.host));}
     // Exactly one side creates each offer: the lexicographically smaller peer id.
     for(const p of ps){if(selfId.current<p.peerId)await makePc(p.peerId,true,stream,p.name);}
   } else if(data.type==='peer-joined'){
     const p=data.peer as Person;
     if(p.peerId===selfId.current)return;
     setPeopleSafe(v=>[...v.filter(x=>x.peerId!==p.peerId),p]);
     if(selfId.current<p.peerId)await makePc(p.peerId,true,stream,p.name);
   } else if(data.type==='offer'){
     const peer=peopleRef.current.find(p=>p.peerId===data.from);
     const pc=await makePc(data.from,false,stream,peer?.name||'Participant');
     await pc.setRemoteDescription(data.sdp);
     const slots=pc.getTransceivers();
     const outgoing=[stream.getAudioTracks()[0]||null,stream.getVideoTracks()[0]||null,screenTrack.current];
     for(let i=0;i<3;i++){if(slots[i]){slots[i].direction='sendrecv';await slots[i].sender.replaceTrack(outgoing[i]);}}
     pcs.current[data.from].screenSender=slots[2]?.sender||null;
     await flushIce(data.from,pc);
     const a=await pc.createAnswer(); await pc.setLocalDescription(a);
     send({type:'answer',target:data.from,sdp:pc.localDescription});
   } else if(data.type==='answer'){
     const pc=pcs.current[data.from]?.pc;
     if(pc){await pc.setRemoteDescription(data.sdp);await flushIce(data.from,pc);}
   } else if(data.type==='ice-candidate'){
     const pc=pcs.current[data.from]?.pc;
     if(pc?.remoteDescription){try{await pc.addIceCandidate(data.candidate)}catch{}}
     else (pendingIce.current[data.from]??=[]).push(data.candidate);
   } else if(data.type==='peer-left'){
     closePeer(data.peerId);
   } else if(data.type==='participant-updated'){
     if(data.peerId===selfId.current&&'status' in data.changes)setStatus(data.changes.status);
     setPeopleSafe(v=>v.map(p=>p.peerId===data.peerId?{...p,...data.changes}:p));
     updateRemote(data.peerId,data.changes);
   } else if(data.type==='participants-snapshot'){
     setPeopleSafe((data.participants as Person[]).filter(p=>p.peerId!==selfId.current));
     const me=(data.participants as Person[]).find(p=>p.peerId===selfId.current);
     if(me){setMuted(Boolean(me.muted));stream.getAudioTracks().forEach(t=>t.enabled=!me.muted);}
     (data.participants as Person[]).filter(p=>p.peerId!==selfId.current).forEach(p=>updateRemote(p.peerId,p));
   } else if(data.type==='mute-all'){
     if(data.by!==selfId.current){setMuted(true);stream.getAudioTracks().forEach(t=>t.enabled=false);send({type:'media-state',muted:true,cameraOff:cameraOffRef.current});notify('The host muted everyone.');}
   } else if(data.type==='chat')setMessages(v=>[...v,data.message]);
   else if(data.type==='reaction')addReaction({peerId:data.peerId,id:crypto.randomUUID(),name:data.name||'Participant',emoji:data.emoji||'👍'});
   else if(data.type==='removed'){releaseMedia();setRemoved(true);leavingRef.current=true;localStorage.removeItem('zoom_active_meeting');wsRef.current?.close();}
   else if(data.type==='meeting-ended'){releaseMedia();setEnded(true);leavingRef.current=true;localStorage.removeItem('zoom_active_meeting');wsRef.current?.close();stopStream(streamRef.current);}
   else if(data.type==='host-left'){notify('The host left. The meeting remains open for everyone.');}
   else if(data.type==='session-conflict'){if(data.meetingId===id){send({type:'switch-session'});}else{setSessionConflict(true);setActiveMeetingId(data.meetingId);}}
   else if(data.type==='session-switched'){releaseMedia();setSwitched(true);leavingRef.current=true;stopStream(streamRef.current);wsRef.current?.close();}
   else if(data.type==='error')notify(data.message||'Meeting error');
 },[makePc,flushIce,send,setPeopleSafe,updateRemote,closePeer,addReaction,mini,id]);

 const connect=useCallback((stream:MediaStream)=>{
   const base=WS.replace(/^http/,'ws').replace(/\/$/,'');
   const socket=new WebSocket(`${base}/ws/meeting/${encodeURIComponent(id)}/${encodeURIComponent(selfId.current)}?name=${encodeURIComponent(name)}&userId=${encodeURIComponent(String(userId))}`);
   wsRef.current=socket; setWsStatus('Connecting…');
   socket.onopen=()=>{if(!mountedRef.current)return;socket.send(JSON.stringify({type:'media-state',cameraOff:cameraOffRef.current,muted:initialMuted}));setConnected(true);setWsStatus('Connected');};
   socket.onerror=()=>{if(mountedRef.current){setConnected(false);setWsStatus('Connection error');notify('Could not connect to the meeting server.');}};
   socket.onclose=(e)=>{if(mountedRef.current){setConnected(false);if(e.code===4008||switchingRef.current)return;setWsStatus(e.code===1000?'Disconnected':'Connection closed');}};
   socket.onmessage=async e=>{try{await handleSignal(JSON.parse(e.data),stream)}catch(err){console.error('meeting signal error',err)}};
 },[id,name,userId,initialMuted,handleSignal]);

 useEffect(()=>{
   if(!meeting)return;
   let active=true;
   navigator.mediaDevices.getUserMedia({video:true,audio:true}).then(stream=>{
     if(!active){stopStream(stream);return;}
     const off=initialCameraOff!==null?initialCameraOff==='1':!(meeting.owner_user_id===userId?meeting.host_video??true:meeting.participant_video??true);stream.getAudioTracks().forEach(t=>t.enabled=!initialMuted);stream.getVideoTracks().forEach(t=>t.enabled=!off);setCameraOff(off);cameraOffRef.current=off;streamRef.current=stream;if(localVideo.current)localVideo.current.srcObject=stream;connect(stream);
   }).catch(()=>{
     if(!active)return;
     notify('Camera/microphone permission was denied. Joining without media.');
     const empty=new MediaStream();streamRef.current=empty;connect(empty);
   });
   return()=>{active=false;};
 },[meeting,userId,initialMuted,initialCameraOff,connect]);

 const toggleMute=()=>{const next=!muted;setMuted(next);streamRef.current?.getAudioTracks().forEach(t=>t.enabled=!next);send({type:'media-state',muted:next,cameraOff});};
 const toggleCamera=()=>{const next=!cameraOff;setCameraOff(next);streamRef.current?.getVideoTracks().forEach(t=>t.enabled=!next);send({type:'media-state',muted,cameraOff:next});};

 useEffect(()=>{if(!mini)return;window.parent.postMessage({type:'mini-media',muted,cameraOff,connected},window.location.origin);const receive=(e:MessageEvent)=>{if(e.origin!==window.location.origin||e.source!==window.parent)return;if(e.data?.type==='mini-mute')toggleMute();else if(e.data?.type==='mini-camera')toggleCamera();else if(e.data?.type==='mini-release'){leavingRef.current=true;releaseMedia();wsRef.current?.close()}};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)},[mini,muted,cameraOff,connected]);
 useEffect(()=>{if(mini&&(ended||removed||switched))window.parent.postMessage({type:'mini-ended'},window.location.origin)},[mini,ended,removed,switched]);
 const replaceScreenTrack=async(track:MediaStreamTrack|null)=>{
   await Promise.all(Object.values(pcs.current).map(({screenSender})=>screenSender?.replaceTrack(track)));
 };
 const stopScreenShare=()=>{
   const track=screenTrack.current;screenTrack.current=null;
   if(track){track.onended=null;track.stop();}
   void replaceScreenTrack(null).catch(()=>notify('Unable to stop the outgoing screen track.'));
   setScreenStream(null);setScreenOn(false);send({type:'media-state',screenOn:false});
 };
 const share=async()=>{
   if(screenOn){stopScreenShare();return;}
   let ss:MediaStream|null=null;
   try{
     ss=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
     if(!mountedRef.current){stopStream(ss);return;}
     const track=ss.getVideoTracks()[0];screenTrack.current=track;
     await replaceScreenTrack(track);
     setScreenStream(ss);setScreenOn(true);send({type:'media-state',screenOn:true});
     track.onended=stopScreenShare;
   }catch{stopStream(ss);screenTrack.current=null;void replaceScreenTrack(null);notify('Screen sharing cancelled or unavailable');}
 };

 const startRecord=()=>{
   const stream=streamRef.current;if(!stream)return;
   if(recording){recorder.current?.stop();setRecording(false);return;}
   try{
     const r=new MediaRecorder(stream);chunks.current=[];
     r.ondataavailable=e=>e.data.size&&chunks.current.push(e.data);
     r.onstop=()=>{const blob=new Blob(chunks.current,{type:'video/webm'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`meeting-${id}.webm`;a.click();};
     r.start();recorder.current=r;setRecording(true);
   }catch{notify('Recording is not supported in this browser');}
 };
 const sendChat=()=>{if(chat.trim()){send({type:'chat',text:chat.trim()});setChat('');}};
 const react=(emoji:string)=>send({type:'reaction',emoji});

 const cleanupAndHome=useCallback((clearActive=true,feedback=false)=>{
   leavingRef.current=true;
   if(clearActive)localStorage.removeItem('zoom_active_meeting');
   recorder.current?.state==='recording'&&recorder.current.stop();
   screenTrack.current?.stop();screenTrack.current=null;
   Object.values(pcs.current).forEach(x=>x.pc.close());pcs.current={};pendingIce.current={};
   try{wsRef.current?.close()}catch{};wsRef.current=null;
   stopStream(streamRef.current);streamRef.current=null;
   router.push(feedback?`/?feedback=${encodeURIComponent(id)}`:'/');
 },[router,id]);

 const leaveMeeting=()=>{send(isHost?{type:'host-leave'}:{type:'leave'});cleanupAndHome(true);};
 const endForAll=()=>{send({type:'end-meeting'});cleanupAndHome(true,true);};
 const switchToThisWindow=()=>{switchingRef.current=true;send({type:'switch-session'});setSessionConflict(false);setTimeout(()=>{switchingRef.current=false;},2500);};

 if(switched)return <div className="movedMeetingBackdrop"><div className="movedMeetingDialog" role="dialog" aria-modal="true"><h1>You have joined this meeting on another platform.</h1><p>This window will be exited.</p><button className="primary" onClick={()=>router.push('/')}>OK</button></div></div>;
 if(removed)return <InfoScreen title="You were removed" text="The meeting host removed you from this meeting." onClick={()=>router.push('/')}/>;
 if(ended)return <InfoScreen title="Meeting ended" text="The host ended this meeting for everyone." onClick={()=>router.push('/')}/>;
 if(!meeting||(!connected&&wsStatus==='Connecting…'&&!sessionConflict))return <div className="joiningScreen"><div><span className="joiningSpinner"/><p>Joining Meeting...</p></div></div>;
 const remoteEntries=Object.entries(remotes);
 const total=1+remoteEntries.length;
 const gridClass=total===1?'one':total===2?'two':total<=4?'four':total<=9?'nine':'many';
 const sharedScreens=[...(screenOn&&screenStream?[{id:'self',stream:screenStream,name}]:[]),...remoteEntries.filter(([pid])=>people.some(p=>p.peerId===pid&&p.screenOn)).map(([pid,r])=>({id:pid,stream:r.screenStream,name:r.name}))];
 const activeScreen=sharedScreens.length>0;
 const inviteLink=typeof window!=='undefined'?`${window.location.origin}/join/${id.replaceAll(' ','')}`:meeting.invite_link;
 const resizeAt=(clientX:number)=>{const rect=shareArea.current?.getBoundingClientRect();if(rect)setVideoWidth(Math.max(180,Math.min(rect.width*.55,rect.right-clientX)));};
 return <div className={`meetingPage ${mini?'miniRoom':''}`}>
   <div className="meetingTop"><div className="meetingInfoWrap" data-meeting-menu="info"><button className="meetingInfoButton" aria-label="Meeting information" aria-expanded={infoOpen} onClick={()=>toggleMenu('info')}><Info size={16}/><strong>{meeting.title}</strong></button>{infoOpen&&<div className="meetingInfoPopover"><div className="infoHeading"><strong>{meeting.title}</strong><button aria-label="Close meeting information" onClick={()=>setOpenMenu(null)}><X size={16}/></button></div><dl><dt>Invite Link</dt><dd><div className="inviteCopy"><input aria-label="Meeting invite link" readOnly value={inviteLink} onFocus={e=>e.target.select()}/><button title="Copy meeting link" aria-label="Copy meeting link" onClick={()=>navigator.clipboard.writeText(inviteLink).then(()=>notify('Meeting link copied')).catch(()=>notify('Copy unavailable. Select the link.'))}><Copy size={16}/></button></div></dd><dt>Meeting ID</dt><dd>{meeting.meeting_id}</dd><dt>Host</dt><dd>{meeting.host_name}{isHost?' (You)':''}</dd><dt>Participant ID</dt><dd>{selfId.current.slice(0,8)}</dd></dl></div>}</div><div className="meetingTopRight"><span className={`connectionStatus ${connected?'ok':'bad'}`}>● {wsStatus}</span><ShieldCheck size={18} className="secureMark" aria-label="Meeting connection"/><span className="meetingAppMark">zm</span></div></div>
   <div className="meetingMain">
    <div ref={shareArea} className={`videoArea ${activeScreen?'sharingArea':''}`} style={activeScreen?{'--video-width':`${videoWidth}px`} as React.CSSProperties:undefined}>
      {activeScreen&&<><div className="sharedStage">{sharedScreens.map(screen=><ScreenTile key={screen.id} stream={screen.stream} name={screen.name}/>)}</div><div className="shareDivider" role="separator" aria-label="Resize shared screen and participant videos" aria-orientation="vertical" tabIndex={0} aria-valuemin={180} aria-valuenow={videoWidth} aria-valuemax={Math.floor((shareArea.current?.clientWidth||800)*.55)} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();setVideoWidth(v=>Math.max(180,Math.min((shareArea.current?.clientWidth||800)*.55,v+(e.key==='ArrowLeft'?20:-20))))}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resizeAt(e.clientX)}} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)}/></>}
      <div className={activeScreen?'pagedParticipantPanel':'galleryContainer'}><div key="participants" className={activeScreen?'participantStrip':`videoGrid ${gridClass} ${total>25?'overflowGallery':''}`}>

      <div className="tile localTile" style={activeScreen&&videoPage!==0?{display:'none'}:undefined}><span className="tileReaction" aria-label="Your reaction">{reactions.filter(r=>r.peerId===selfId.current).at(-1)?.emoji||status}</span><video ref={attachLocalVideo} autoPlay muted playsInline/><div className="noVideo" style={{display:cameraOff?'grid':'none'}}><div className="tileAvatar">{name[0]?.toUpperCase()}</div></div><div className="tileName">{muted&&<MicOff size={13}/>} {status} {name}</div></div>
      {remoteEntries.map(([pid,r],i)=><RemoteTile hidden={activeScreen&&Math.floor((i+1)/6)!==videoPage} key={pid} data={{...r,...people.find(p=>p.peerId===pid)}} reaction={reactions.filter(r=>r.peerId===pid).at(-1)?.emoji} onRemove={()=>send({type:'remove-participant',target:pid})} canRemove={isHost}/>)}</div>{activeScreen&&<div className="videoPageControls"><button aria-label="Previous six videos" disabled={videoPage===0} onClick={()=>setVideoPage(v=>v-1)}><ChevronUp size={20}/></button><span>{videoPage+1} / {Math.ceil(total/6)}</span><button aria-label="Next six videos" disabled={videoPage>=Math.ceil(total/6)-1} onClick={()=>setVideoPage(v=>v+1)}><ChevronDown size={20}/></button></div>}</div></div>
    {panels.length>0&&<aside className="meetingPanelStack">{panels.map(kind=><section className={`sidePanel ${kind==='chat'?'chatPanel':'peoplePanel'}`} key={kind} aria-label={kind==='chat'?'Meeting chat':'Meeting participants'}><div className="panelHead"><h3>{kind==='chat'?meeting.title:`Participants (${people.length+1})`}</h3><button aria-label={kind==='chat'?'Close chat':'Close participants'} className="iconbtn" onClick={()=>togglePanel(kind)}><X size={18}/></button></div>{kind==='people'?<div className="panelBody"><PersonRow person={{peerId:selfId.current,name,muted,cameraOff,host:isHost,status}} reaction={reactions.filter(r=>r.peerId===selfId.current).at(-1)?.emoji} self/>{people.map(p=><PersonRow key={p.peerId} person={p} reaction={reactions.filter(r=>r.peerId===p.peerId).at(-1)?.emoji} onRemove={isHost?()=>send({type:'remove-participant',target:p.peerId}):undefined}/>)}</div>:<><div className="chatList"><p className="chatNotice">Messages sent to “Meeting Group Chat” are visible to everyone in this meeting.</p>{messages.map((m,i)=>{const previous=messages[i-1];const grouped=previous?.peerId===m.peerId&&Math.abs(new Date(m.sentAt).getTime()-new Date(previous.sentAt).getTime())<60000;return <div className={`chatMsg ${grouped?'chatGrouped':''}`} key={m.id}>{!grouped&&<><div className="chatSender">{m.peerId===selfId.current?'You':m.name} <time>{new Date(m.sentAt+'Z').toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></div><span className="chatAvatar">{m.name[0]?.toUpperCase()}</span></>}<p>{m.text}</p></div>})}</div><div className="chatVisibility">Who can see your messages? <span>Everyone in this meeting</span></div><div className="chatAudience">to: <span>Meeting Group Chat</span></div><div className="chatComposer"><textarea aria-label="Chat message" placeholder="Type message here ..." value={chat} onChange={e=>setChat(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}}}/><button aria-label="Send message" disabled={!chat.trim()} onClick={sendChat}><Send size={18}/></button></div></>}</section>)}</aside>}
   </div>
   <div className="controls"><div className="controlsMedia">
    <Control icon={muted?<MicOff/>:<Mic/>} label={muted?'Unmute':'Mute'} off={muted} onClick={toggleMute}/>
    <Control icon={cameraOff?<CameraOff/>:<Camera/>} label={cameraOff?'Start video':'Stop video'} off={cameraOff} caption="Video" onClick={toggleCamera}/></div><div className="controlsCenter">
    <Control icon={<Users/>} label="Participants" badge={people.length+1} active={panels.includes('people')} onClick={()=>togglePanel('people')}/>
    <Control icon={<MessageSquare/>} label="Chat" badge={unread||undefined} active={panels.includes('chat')} onClick={()=>togglePanel('chat')}/>
    <div className="controlWrap" data-meeting-menu="reactions"><Control icon={<Heart/>} label="Reactions" caption="React" active={reactionMenu} onClick={()=>toggleMenu('reactions')}/>{reactionMenu&&<div className="reactionPicker" aria-label="Choose a reaction"><div className="reactionEmojiRow">{[['👏','Applause'],['👍','Thumbs up'],['😂','Laugh'],['😮','Surprised'],['❤️','Heart'],['🎉','Celebrate']].map(([emoji,label])=><button key={emoji} aria-label={label} title={label} onClick={()=>{react(emoji);setOpenMenu(null)}}>{emoji}</button>)}<button aria-label="More reactions" onClick={()=>setMoreReactions(v=>!v)}>⋯</button></div>{moreReactions&&<div className="reactionExtras">{[['🙌','Hooray'],['🤔','Thinking'],['👎','Thumbs down'],['😊','Smile'],['🚀','Rocket'],['💯','Hundred']].map(([emoji,label])=><button key={emoji} aria-label={label} onClick={()=>{react(emoji);setOpenMenu(null)}}>{emoji}</button>)}</div>}<div className="reactionFeedback">{[['✅','Yes'],['❌','No'],['⏪','Slow down'],['⏩','Speed up'],['☕','Break']].map(([emoji,label])=><button key={emoji} aria-label={label} title={label} className={status===emoji?'selected':''} onClick={()=>{send({type:'participant-status',status:status===emoji?'':emoji});setOpenMenu(null)}}>{emoji}</button>)}</div><button className="reactionStatus" onClick={()=>{send({type:'participant-status',status:status==='✋'?'':'✋'});setOpenMenu(null)}}>{status==='✋'?'✋ Lower Hand':'✋ Raise Hand'}</button><button className="reactionStatus" onClick={()=>{send({type:'participant-status',status:status==='⌛'?'':'⌛'});setOpenMenu(null)}}>{status==='⌛'?'⌛ I’m back':'⌛ Be right back'}</button>{status&&<button className="reactionStatus" onClick={()=>send({type:'participant-status',status:''})}>Clear feedback</button>}</div>}</div>
    <Control icon={<MonitorUp/>} label={screenOn?'Stop share':'Share screen'} caption={screenOn?'Stop share':'Share'} active={screenOn} onClick={share}/>
    {isHost&&<div className="controlWrap" data-meeting-menu="host"><Control icon={<ShieldCheck/>} label="Host tools" onClick={()=>toggleMenu('host')}/>{more&&<div className="menu"><button onClick={()=>{send({type:'mute-all'});setOpenMenu(null);notify('Everyone else was muted')}}><Volume2 size={15}/> Mute all</button><button onClick={()=>{openPanel('people');setOpenMenu(null)}}><Users size={15}/> Manage participants</button></div>}</div>}
    <div className="controlWrap" data-meeting-menu="more"><Control icon={<MoreHorizontal/>} label="More" onClick={()=>{toggleMenu('more')}}/>{recordMenu&&<div className="menu"><button onClick={()=>{startRecord();setOpenMenu(null)}}><Circle size={15}/> {recording?'Stop recording':'Record on this computer'}</button><button onClick={()=>{openPanel('chat');setOpenMenu(null)}}><MessageSquare size={15}/> Open meeting chat</button></div>}</div>
    </div><div className="controlsEnd">
    {isHost?<Control icon={<OctagonX/>} label="End" end onClick={()=>setEndMenu(true)}/>:<Control icon={<PhoneOff/>} label="Leave" end onClick={leaveMeeting}/>} 
   </div></div>
   {endMenu&&<div className="modalBackdrop endBackdrop" onClick={()=>setEndMenu(false)}><div className="modal endModal" role="dialog" aria-modal="true" aria-labelledby="end-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setEndMenu(false)}}><button className="modalClose" autoFocus aria-label="Close end meeting dialog" onClick={()=>setEndMenu(false)}><X size={20}/></button><h2 id="end-title">End meeting?</h2><div className="modalActions"><button className="secondary" onClick={()=>{setEndMenu(false);leaveMeeting()}}>Leave meeting</button><button className="primary dangerBtn" onClick={()=>{setEndMenu(false);endForAll()}}>End meeting for all</button></div><button className="endCancel" onClick={()=>setEndMenu(false)}>Cancel</button></div></div>}
   {sessionConflict&&<div className="modalBackdrop"><div className="modal"><h2>You're already in a meeting</h2><p>This account is currently active in meeting <strong>{activeMeetingId}</strong> in another window.</p><div className="modalActions"><button className="secondary" onClick={()=>cleanupAndHome(false)}>Stay in previous window</button><button className="primary" onClick={switchToThisWindow}>Switch to this window</button></div></div></div>}
   {chatPreview&&!panels.includes('chat')&&<div className="chatMessagePreview"><span className="previewAvatar">{chatPreview.name[0]?.toUpperCase()}</span><button className="previewOpenChat" onClick={()=>openPanel('chat')}><strong>From {chatPreview.name} to Meeting Group Chat</strong><span>{chatPreview.text}</span></button><button className="previewClose" aria-label="Dismiss message preview" onClick={()=>setChatPreview(null)}><X size={14}/></button></div>}
   {reactions.map((r,i)=><div className="reactionBubble" style={{left:`${38+(i%5)*8}%`,top:`${24+(i%3)*8}%`}} key={r.id}><span>{r.emoji}</span><small>{r.name}</small></div>)}
   {toast&&<div className="toast">{toast}</div>}
 </div>;
}

function InfoScreen({title,text,onClick}:{title:string;text:string;onClick:()=>void}){return <div className="loginPage"><div className="loginCard"><h1>{title}</h1><p>{text}</p><button className="primary" onClick={onClick}>Back to dashboard</button></div></div>}
function Control({icon,label,caption,badge,onClick,off,active,end}:{icon:React.ReactNode;label:string;caption?:string;badge?:number;onClick:()=>void;off?:boolean;active?:boolean;end?:boolean}){return <button aria-label={label} title={label} className={`control ${off?'off':''} ${active?'active':''} ${end?'end':''}`} onClick={onClick}><div className="controlIcon">{icon}{badge!==undefined&&<small>{badge}</small>}</div><span>{caption||label}</span></button>}
function RemoteTile({data,reaction,hidden,canRemove,onRemove}:{data:{stream:MediaStream;screenStream:MediaStream;name:string;muted:boolean;cameraOff:boolean;status?:string};reaction?:string;hidden?:boolean;canRemove:boolean;onRemove:()=>void}){const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{if(ref.current)ref.current.srcObject=data.stream;return()=>{if(ref.current)ref.current.srcObject=null}},[data.stream]);return <div className="tile" style={hidden?{display:'none'}:undefined}><span className="tileReaction" aria-label="Participant reaction">{reaction||data.status}</span><video className="remote" ref={ref} autoPlay playsInline/><div className="noVideo" style={{display:data.cameraOff?'grid':'none'}}><div className="tileAvatar">{data.name[0]?.toUpperCase()}</div></div><div className="tileName">{data.muted&&<MicOff size={13}/>} {data.status} {data.name}</div>{canRemove&&<button onClick={onRemove} className="removeTile" title="Remove participant"><UserMinus size={14}/></button>}</div>}
function PersonRow({person,reaction,self,onRemove}:{person:Person;reaction?:string;self?:boolean;onRemove?:()=>void}){return <div className="person"><div className="pavatar">{person.name[0]?.toUpperCase()}</div><div className="personName">{reaction||person.status} {person.name}{person.host||self?` (${[person.host?'Host':'',self?'me':''].filter(Boolean).join(', ')})`:''}</div><div className="personActions"><span className={person.muted?'mediaDisabled':''}>{person.muted?<MicOff size={16}/>:<Mic size={16}/>}</span><span className={person.cameraOff?'mediaDisabled':''}>{person.cameraOff?<CameraOff size={16}/>:<Camera size={16}/>}</span>{onRemove&&<button aria-label={`Remove ${person.name}`} title="Remove participant" onClick={onRemove}><UserMinus size={16}/></button>}</div></div>}

function ScreenTile({stream,name}:{stream:MediaStream;name:string}){const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{const video=ref.current;if(video)video.srcObject=stream;return()=>{if(video)video.srcObject=null}},[stream]);return <div className="sharedScreen"><video ref={ref} autoPlay muted playsInline/><span>{name}’s screen</span></div>}
