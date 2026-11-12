import {useState,type FormEvent} from 'react'
import {Field,SubmitButton} from '../fields'
import {FactorProof} from '../two-factor/parts'
import {recoveryApi} from './api'
export function Approval({busy,run}:{busy:boolean;run:(work:()=>Promise<void>)=>void}){
 const [review,setReview]=useState<any>(null),[approved,setApproved]=useState(false),[fresh,setFresh]=useState(false)
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const values=new FormData(event.currentTarget);run(async()=>setReview(await recoveryApi('/account/review?requestId='+encodeURIComponent(String(values.get('requestId'))))))}
 return <>
  <h1>{approved?'Workspace consent recorded':'Review a recovery request'}</h1>
  {approved?<p role="status">The account holder can continue once every affected workspace has approved. No membership was changed.</p>:<>
   <p className="id-lede">Sign in as this workspace’s owner and confirm a recent authenticator, passkey or recovery code. Your consent applies only to this workspace.</p>
   {!review?<form onSubmit={submit}><Field id="requestId" label="Recovery request ID" autoComplete="off"/><SubmitButton busy={busy} ready>Review request</SubmitButton></form>:<div className="recovery-review">
    <p><strong>{review.target.name}</strong> ({review.target.email}) has requested to replace their account factors.</p>
    <p>Workspace: <strong>{review.workspace}</strong></p>
    <p>Approve only after confirming this request with the account holder. Approval allows an account-wide factor replacement when every affected workspace consents.</p>
    <button className="pill pill--ink" disabled={busy} onClick={()=>run(async()=>{await recoveryApi('/account/approve',{requestId:review.requestId});setApproved(true)})}>Approve for this workspace</button>
   </div>}
   <details className="recovery-cancel"><summary>Confirm your second factor</summary>{fresh?<p role="status">Second factor confirmed. Review the request to continue.</p>:<FactorProof look="identity" endpoint="/api/identity/step-up" submitLabel="Confirm second factor" onDone={()=>setFresh(true)}/>}</details>
   <div className="id-links"><a href="/login">Sign in</a><a href="/users/profile">Manage your factors</a></div>
  </>}
 </>
}
