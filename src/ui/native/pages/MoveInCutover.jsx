import React,{useState} from 'react';
import CopyCommand from '../setup-help/CopyCommand';

/** Channel instructions come from the source-aware server, including this installation's addresses. */
export default function MoveInCutover({run,busy,onSync,onCutover}){
 const [checked,setChecked]=useState({}),api=run.api;
 if(!api||run.state!=='completed')return null;
 const channels=api.channels||[],steps=channels.flatMap((entry,channelIndex)=>(entry.instructions||[]).map((instruction,index)=>({id:`${channelIndex}/${index}`,instruction,channel:entry.channel})));
 const confirmed=steps.length>0&&steps.every(step=>checked[step.id]);
 return <div className="move-in-api"><h3>Final sync and channel cutover</h3><p>Pause work in your old help desk, then fetch changes since your last import. Final sync creates another review; approve it before switching channels.</p>
  {!api.cutover&&<button className="btn btn-white" disabled={busy} onClick={onSync}>Final sync</button>}
  {api.mode!=='delta'&&!api.cutover&&<p className="settings-note">Complete and review a final sync to unlock the cutover checklist.</p>}
  {(api.mode==='delta'||api.cutover)&&<><p>Follow each source-specific step below. Keep old vendor-owned reply addresses receiving and relaying to this installation until replies to pre-migration notifications have been verified. Change forwarding, widget installation and Help Center DNS in the relevant provider; this page does not change those external settings.</p>
   {channels.map((entry,channelIndex)=><fieldset className="move-in-cutover-channel" key={`${entry.channel}/${channelIndex}`}><legend>{entry.channel}</legend>{(entry.instructions||[]).map((instruction,index)=>{const id=`${channelIndex}/${index}`;return <div className="form-check" key={id}><input className="form-check-input" type="checkbox" disabled={busy||api.cutover} id={`move-in-cutover-${channelIndex}-${index}`} checked={api.cutover||Boolean(checked[id])} onChange={event=>setChecked(old=>({...old,[id]:event.target.checked}))}/><label className="form-check-label" htmlFor={`move-in-cutover-${channelIndex}-${index}`}>{instruction}</label></div>})}{entry.snippet&&<CopyCommand text={entry.snippet} label="Copy snippet"/>}</fieldset>)}
   {!steps.length&&!api.cutover&&<p role="alert">Channel instructions are unavailable. Complete cutover is blocked until this installation supplies its forwarding, widget and DNS steps.</p>}
   {api.cutover?<p role="status">Cutover complete. Saved agent mappings are active. No messages or notifications were sent by this action.</p>:<><p className="settings-note">Confirm every step, including receiving a new test message through each channel and replying to an old notification. Complete cutover activates saved agent mappings; it sends no messages or notifications and invites no staff.</p><button className="btn btn-primary" disabled={busy||!confirmed} onClick={onCutover}>Complete cutover</button></>}
  </>}
 </div>;
}
