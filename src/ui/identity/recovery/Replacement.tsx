import {useState,type FormEvent} from 'react'
import {Field,SubmitButton} from '../fields'
import QrCode from '../two-factor/QrCode'
import {createPasskey,passkeysAvailable,passkeyDomain} from '../two-factor/webauthn-client'
import {recoveryApi,type RecoveryStatus} from './api'
export function Replacement({capability,status,busy,run,finish}:{capability:string;status:RecoveryStatus;busy:boolean;run:(work:()=>Promise<void>)=>void;finish:(result:any)=>void}){
 const [totp,setTotp]=useState<any>(null),[password,setPassword]=useState('')
 const complete=async(body:any)=>finish(await recoveryApi('/complete',{...body,...(password?{password}:{})},capability))
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const values=new FormData(event.currentTarget);run(()=>complete({factorId:totp.factorId,code:values.get('code')}))}
 return <>
  <h1>Prove your replacement factor</h1>
  <p className="id-lede">Your old factors and sessions remain until this step succeeds. Completion signs out every old session and keeps your workspace access.</p>
  <Field id="replacementPassword" label={status.needsPassword?'Create a password':'New password (optional)'} type="password" autoComplete="new-password" required={status.needsPassword} value={password} onChange={event=>setPassword(event.target.value)} minLength={12} maxLength={1024} hint={status.needsPassword?'A password lets you sign in when email is off.':'Leave blank to keep your current password.'}/>
  {!totp?<div className="recovery-actions">
   <button className="pill pill--ink" disabled={busy} onClick={()=>run(async()=>setTotp(await recoveryApi('/enrol/totp',{},capability)))}>Set up an authenticator app</button>
   {passkeysAvailable()&&passkeyDomain()&&<button className="recovery-link" disabled={busy||(status.needsPassword&&password.length<12)} onClick={()=>run(async()=>{const options=await recoveryApi('/enrol/passkey-options',{},capability);const credential=await createPasskey(options);await complete({credential})})}>Use a new passkey</button>}
  </div>:<form onSubmit={submit}>
   <div className="recovery-qr"><QrCode value={totp.uri} label="Scan with your authenticator app"/></div>
   <p>Scan the code or enter this key in your authenticator app.</p>
   <code className="recovery-secret" data-testid="recovery-secret">{totp.secret}</code>
   <Field id="code" label="Code from your authenticator app" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}"/>
   <SubmitButton busy={busy} ready={!status.needsPassword||password.length>=12} busyLabel="Completing…">Complete recovery</SubmitButton>
  </form>}
 </>
}
