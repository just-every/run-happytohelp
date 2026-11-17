import React, {useState} from 'react';
export default function DeveloperHandoff({what,unlocks,steps}) {
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 const text=`${what}\n${unlocks}\n\n${steps}`;
 const copy=async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setError('');}catch{setError('Could not copy. Select the steps below to copy them.');}};
 return <section className="settings-section"><h3>Needs a technical person</h3><p>{what}</p><p>{unlocks}</p><details><summary>Details for your developer</summary><pre className="text-wrap">{steps}</pre></details><div className="d-flex flex-wrap gap-2 mt-3"><a className="btn btn-white" href={`mailto:?subject=${encodeURIComponent('Help setting up HappyToHelp')}&body=${encodeURIComponent(text)}`}>Send these steps to my developer</a><button type="button" className="btn btn-white" onClick={copy}>Copy steps</button></div>{copied&&<p role="status">Steps copied.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
