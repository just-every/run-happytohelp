import {useState,type FormEvent} from 'react'
import {Field,SubmitButton} from '../fields'
import {postJson} from '../hooks'
import {recoveryApi} from './api'
export function PrimaryForm({mode,busy,run,accept}:{mode:'manual'|'account';busy:boolean;run:(work:()=>Promise<void>)=>void;accept:(result:any)=>Promise<void>}){
 const [mail,setMail]=useState(false),[sent,setSent]=useState(false)
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const values=new FormData(event.currentTarget);run(async()=>{
  const body:any={email:values.get('email'),password:values.get('password'),recoveryKey:values.get('recoveryKey')}
  if(mail){const url=new URL(String(values.get('primaryLink')));body.primaryToken=new URLSearchParams(url.hash.slice(1)).get('token')}
  await accept(await recoveryApi(mode==='manual'?'':'/account/request',body))
 })}
 return <>
  <h1>{mode==='manual'?'Use an installation key':'Recover your shared account'}</h1>
  <p className="id-lede">{mode==='manual'?'For the original installation owner. Your password and a one-time installation key authorize replacement-factor setup.':'Prove your account, then ask an owner of every affected workspace to approve. Your memberships stay intact.'}</p>
  {mode==='account'&&<div className="recovery-actions"><button type="button" className="recovery-link" onClick={()=>setMail(!mail)}>{mail?'Use my password':'Use an emailed sign-in link'}</button></div>}
  <form onSubmit={submit}>
   <Field id="email" label="Account email" type="email" autoComplete="username"/>
   {mail?<><button type="button" className="recovery-link" disabled={busy} onClick={()=>run(async()=>{const email=(document.getElementById('email') as HTMLInputElement).value;await postJson('/api/identity/magic-link',{email});setSent(true)})}>Request a sign-in link</button>{sent&&<p role="status">If the address belongs to an account, check its inbox. Keep this recovery page open.</p>}<Field id="primaryLink" label="Sign-in link from your email" type="url" autoComplete="off" hint="Paste the link here to use it only as recovery proof."/></>:<Field id="password" label="Password" type="password" autoComplete="current-password"/>}
   {mode==='manual'&&<Field id="recoveryKey" label="Installation recovery key" type="password" autoComplete="off" minLength={32}/>}
   <SubmitButton busy={busy} ready busyLabel="Checking…">Continue recovery</SubmitButton>
  </form>
 </>
}
