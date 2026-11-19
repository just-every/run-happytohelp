import React,{useState} from 'react';
import {tooltip} from '../../../modules/tooltip/tooltip';
import './setup-help.css';

/** A command or value shown exactly as it must be typed, with a copy button. */
export default function CopyCommand({text,label='Copy',tooltipLabel}) {
 const [copied,setCopied]=useState('');
 const copy=async()=>{try{await navigator.clipboard.writeText(text);setCopied('Copied');}catch{setCopied('Select the text and copy it');}};
 return <div className="sh-copy"><pre tabIndex={0}><code>{text}</code></pre><button type="button" className="btn btn-white btn-sm" onClick={copy} {...(tooltipLabel ? tooltip(tooltipLabel) : {'aria-label':`${label}: ${text.split('\n')[0]}`})}>{label}</button><span className="sh-copied" aria-live="polite">{copied}</span></div>;
}
