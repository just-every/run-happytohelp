import {useEffect,useRef,useState} from 'react'
import IdentityFrame from './IdentityFrame'
import {Alert} from './fields'
import {PrimaryForm} from './recovery/PrimaryForm'
import {Replacement} from './recovery/Replacement'
import {Approval} from './recovery/Approval'
import {browserSecret,nonceHash,recoveryApi,type RecoveryStatus} from './recovery/api'
import './recovery/recovery.css'
const savedKey='h2h-owner-recovery'
type Mode='choice'|'manual'|'account'|'approve'|'managed'
export default function OwnerRecovery(){
 const [mode,setMode]=useState<Mode>('choice'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[capability,setCapability]=useState(''),[status,setStatus]=useState<RecoveryStatus|null>(null),[completed,setCompleted]=useState<any>(null),[copied,setCopied]=useState(false)
 const popup=useRef<Window|null>(null),handoff=useRef<any>(null)
 const refresh=async(secret=capability)=>{if(secret)setStatus(await recoveryApi('/status',undefined,secret))}
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work()}catch(failure:any){setError(failure.message)}finally{setBusy(false)}}
 const accept=async(result:any)=>{setCapability(result.capability);sessionStorage.setItem(savedKey,result.capability);await refresh(result.capability)}
 const choose=(next:Mode)=>{setMode(next);setError('')}
 const reset=()=>{sessionStorage.removeItem(savedKey);setCapability('');setStatus(null);setCompleted(null);setMode('choice');setError('');handoff.current=null}
 useEffect(()=>{const secret=sessionStorage.getItem(savedKey);if(secret){setCapability(secret);refresh(secret).catch(()=>sessionStorage.removeItem(savedKey))}},[])
 useEffect(()=>{if(!capability||!status||!['pending','authorized'].includes(status.state))return;const timer=setInterval(()=>refresh().catch(failure=>setError(failure.message)),5000);return()=>clearInterval(timer)},[capability,status?.state])
 useEffect(()=>{
  const receive=(event:MessageEvent)=>{
   const current=handoff.current
   if(!current||event.origin!==current.platformOrigin||event.source!==popup.current||event.data?.installationId!==current.installationId)return
   if(event.data.type==='h2h-owner-recovery-ready')popup.current?.postMessage({type:'h2h-owner-recovery-challenge',installationId:current.installationId,challenge:current.challenge},current.platformOrigin)
   if(event.data.type==='h2h-owner-recovery-authorized'&&event.data.challengeId===current.requestId)run(()=>refresh())
  }
  window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive)
 },[capability])
 const startManaged=()=>{
  // Open in this click, before the async challenge, so popup blockers allow it.
  popup.current=window.open('about:blank','h2h-owner-recovery','popup,width=660,height=820')
  run(async()=>{try{const secret=browserSecret(),result=await recoveryApi('/challenge',{nonce:await nonceHash(secret)});handoff.current=result;setMode('managed');await accept({...result,capability:secret});if(popup.current)popup.current.location=result.platformUrl;else throw new Error('Allow the recovery popup, then start again.')}catch(failure){popup.current?.close();throw failure}})
 }
 const finish=(result:any)=>{setCompleted(result);setStatus(previous=>previous?{...previous,state:'completed'}:previous);sessionStorage.removeItem(savedKey);const current=handoff.current;if(current)popup.current?.postMessage({type:'h2h-owner-recovery-completed',installationId:current.installationId,challengeId:current.requestId},current.platformOrigin)}
 let content
 if(completed)content=<><h1>Save your new recovery codes</h1><p className="id-lede">Recovery is complete. Your replacement factor is active and every old session has ended. These codes are shown once.</p><ul className="recovery-codes">{completed.recoveryCodes.map((code:string)=><li key={code}>{code}</li>)}</ul><a className="pill pill--ink" href={completed.destination}>Continue to your account</a></>
 else if(status){
  if(!['pending','authorized'].includes(status.state))content=<><h1>{({expired:'Recovery expired',cancelled:'Recovery cancelled',refused:'Recovery cannot continue',completed:'Recovery already completed'} as Record<string,string>)[status.state]||'Recovery cannot continue'}</h1><p className="id-lede">{status.state==='completed'?'Sign in with your replacement factor. Recovery codes cannot be shown again.':'This request grants no access. Start again with current proof; your existing credentials remain unchanged.'}</p><button className="pill pill--ink" onClick={reset}>Start a new recovery</button></>
  else if(status.ready)content=<Replacement capability={capability} status={status} busy={busy} run={run} finish={finish}/>
  else content=<><h1>{status.mode==='account'?'Waiting for workspace owners':'Confirm ownership in Managed settings'}</h1><p className="id-lede">{status.mode==='account'?'Share this request ID with an owner of each affected workspace. Each owner signs in here and explicitly approves for their workspace.':'Use the Managed window to prove current installation ownership with a recovery passkey. A remembered session or email alone cannot authorize recovery.'}</p>{status.mode==='account'&&<div className="recovery-status"><p className="recovery-count">{status.approved} of {status.required} approved</p><code className="recovery-request">{status.requestId}</code><button className="recovery-link" onClick={()=>run(async()=>{await navigator.clipboard.writeText(status.requestId);setCopied(true)})}>{copied?'Request ID copied':'Copy request ID'}</button></div>}<p>No account access is granted until you prove a replacement factor. This request expires at {new Date(status.expiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}.</p><button className="pill pill--ink" disabled={busy} onClick={()=>run(()=>refresh())}>Refresh status</button></>
 }else if(mode==='approve')content=<Approval busy={busy} run={run}/>
 else if(mode==='manual'||mode==='account')content=<PrimaryForm mode={mode} busy={busy} run={run} accept={accept}/>
 else content=<><h1>Recover account access</h1><p className="id-lede">Lost every authenticator, passkey and recovery code? Choose how to recover your account.</p><div className="recovery-actions recovery-choices"><button className="pill pill--ink" disabled={busy} onClick={startManaged}>Recover installation owner</button><button className="recovery-link" onClick={()=>choose('account')}>Recover a shared account</button><button className="recovery-link" onClick={()=>choose('approve')}>Approve a workspace request</button></div><details><summary>Separately controlled installation</summary><p>The original owner can use a private installation key and their native password.</p><button className="recovery-link" onClick={()=>choose('manual')}>Use an installation key</button></details></>
 return <IdentityFrame><div className="recovery-content">{content}</div><Alert>{error}</Alert>{status&&['pending','authorized'].includes(status.state)&&<button className="recovery-link recovery-cancel" disabled={busy} onClick={()=>run(async()=>{await recoveryApi('/cancel',{},capability);await refresh()})}>Cancel recovery</button>}<div className="id-links">{!status&&mode!=='choice'&&<button className="recovery-link" onClick={reset}>Choose another recovery path</button>}<a href="/login">Back to login</a></div></IdentityFrame>
}
