import React,{useId,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {needContent} from './need-content';
import {needStatus} from './setup-model';

const mailto=(host,snippet)=>`mailto:?subject=${encodeURIComponent(`Add the HappyToHelp chat widget${host?` to ${host}`:''}`)}&body=${encodeURIComponent(`Please paste this before the closing body tag${host?` on ${host}`:' of our website'}:\n\n${snippet}\n`)}`;

function CopySnippet({text}) {
 const [copied,setCopied]=useState('');
 const copy=async()=>{try{await navigator.clipboard.writeText(text);setCopied('Copied');}catch{setCopied('Select the code above and copy it');}};
 return <><button type="button" className="btn btn-white btn-sm" data-copy onClick={copy}>Copy snippet</button><span className="sl-copied" aria-live="polite">{copied}</span></>;
}

/** One thing only the owner can do: its heading with the way to leave it for now (above any snippet, so it is always in
 *  reach), what and why, its action, and the status we are watching. */
export default function NeedItem({data,item,projectId,onSkip,skipBusy}) {
 const how=useId(),[open,setOpen]=useState(false);
 const content=needContent({data,item,projectId,local:data.environment==='local'});
 if(!content)return null;
 const {status,text}=needStatus(data,item);
 return <li className="sl-need" data-need={item.id}>
  <div className="sl-need-head">
   <h3>{content.title}</h3>
   <button type="button" className="activation-text-action sl-skip" data-skip disabled={skipBusy} aria-label={`Skip for now: ${content.title}`} onClick={()=>onSkip(item.id,true)}>Skip for now</button>
  </div>
  <p>{content.copy}</p>
  {content.snippet&&<pre className="sl-snippet" tabIndex={0}><code data-field="snippet">{content.snippet}</code></pre>}
  <div className="sl-act">
   {content.actions.map((action,index)=>action.kind==='how'
    ?<button key={index} type="button" className="btn btn-white btn-sm" aria-expanded={open} aria-controls={how} data-how onClick={()=>setOpen(value=>!value)}>Show me how</button>
    :action.kind==='copy'?<CopySnippet key={index} text={action.text}/>
    :action.kind==='mailto'?<a key={index} className="btn btn-white btn-sm" href={mailto(action.host,action.text)}>Email it to my developer</a>
    :<Link key={index} className="btn btn-white btn-sm" to={action.to}>{action.label}</Link>)}
   <span className="sl-wait" data-status={status}><i aria-hidden="true"/>{text}</span>
  </div>
  {content.how&&<div className="sl-how" id={how} hidden={!open}>{content.how}</div>}
 </li>;
}
