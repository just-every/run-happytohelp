import { markSvg } from '../ui/homepage/brand-mark';
import { wordSvg } from '../ui/homepage/brand-word';
import { penLoop } from '../ui/native/drawings/Drawing';

/** The global the end marker calls once the document's last byte has arrived. */
export const documentEndCall = '$h2hDocumentEnd';
/** Quiet time (no new nodes) after which the busy look shows, and after which a document has stopped arriving: the
 *  Worker writes a heartbeat at least once a second while a document waits (document-recovery.ts), so a few seconds
 *  of silence is not a slow document. */
const busyMs = 2000;
const stallMs = 4000;
/** A document the browser reloaded (by this script or by hand) waits this long: every dashboard request ends well
 *  within it, so a reloaded document that is merely slow is never reloaded again. */
const reloadedStallMs = 30000;

// The dashboard's busy look (DashboardPending in src/ui/native/Dashboard.tsx: the identity pages' paper frame under the
// HappyToHelp lockup, the looping pen line and one status line), drawn with its own styles: the app's stylesheet may
// not have arrived. The values mirror identity.css, drawings.css and brand-tokens.css.
const css = `@font-face{font-family:Outfit;font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/outfit/outfit-latin-wght-normal.woff2') format('woff2')}
.h2h-recovery{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;padding:0 clamp(20px,5vw,76px);overflow:auto;color:#141414;background:#f6f2ea;font:17px/1.5 Outfit,'Avenir Next','Segoe UI',sans-serif;text-align:left;-webkit-font-smoothing:antialiased}
.h2h-recovery *{box-sizing:border-box}
.h2h-recovery__header{display:flex;flex:none;align-items:center;width:100%;max-width:1536px;height:100px;margin:0 auto}
.h2h-recovery__brand{position:relative;display:inline-flex;align-items:center;gap:.3em;color:inherit;font-size:clamp(26px,2.2vw,32px);line-height:1;text-decoration:none}
.h2h-recovery__brand svg{flex:none;overflow:visible}
.h2h-recovery__brand svg:first-child{width:auto;height:1.58em;margin-left:.07em}
.h2h-recovery__name{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.h2h-recovery__body{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px 0 96px;text-align:center}
.h2h-recovery__pen{display:block;width:200px;max-width:70%;height:auto;margin:0;color:#5ad8ec;overflow:visible}
.h2h-recovery__message{max-width:36rem;margin:0;font-size:20px;overflow-wrap:anywhere}
@media (max-width:640px){.h2h-recovery{font-size:16px}.h2h-recovery__header{height:76px}}
@media (prefers-reduced-motion:no-preference){.h2h-recovery__pen path{stroke-dasharray:1 2;animation:h2h-recovery-pen 1.6s cubic-bezier(.55,.05,.35,1) infinite}}
@keyframes h2h-recovery-pen{from{stroke-dashoffset:1.02}to{stroke-dashoffset:0}}`;
const markup = `<style>${css}</style><header class="h2h-recovery__header"><a class="h2h-recovery__brand" href="/">${markSvg().trim()}${wordSvg()}<span class="h2h-recovery__name">HappyToHelp</span></a></header>`
    + `<div class="h2h-recovery__body"><svg class="h2h-recovery__pen" viewBox="0 0 240 60" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path pathLength="1" d="${penLoop}"/></svg>`
    + `<p class="h2h-recovery__message" role="status">The workspace is busy. Trying again in a few seconds…</p></div>`;

/** Script text is never closed early: every `<` is written as an escape. */
const scriptJson = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c');

/**
 * Runs first in a dashboard document's head. It watches the document arrive. When no node has arrived for two seconds
 * it shows the busy look, and takes it away if nodes arrive again. A document that stopped before its body is given
 * an empty one to show it in (the browser paints nothing without a body), removed again if the document resumes.
 * After a few seconds with no node and no end marker the document was cut (a dropped connection, a Worker restart):
 * it asks /health until the Worker answers, then reloads once. A document that completes calls the end marker and is
 * never reloaded. The script and the marker remove their own elements, so hydration never sees them.
 */
export const documentRecoveryScript = `(function(){
var d=document,w=window,me=d.currentScript,last=Date.now(),box=d.createElement('div'),body,done=false,probing=false,next=0,timer;
var nav=performance.getEntriesByType('navigation')[0],stall=nav&&nav.type==='reload'?${reloadedStallMs}:${stallMs};
if(me)me.remove();
box.className='h2h-recovery';box.setAttribute('aria-busy','true');box.innerHTML=${scriptJson(markup)};
function mine(n){return n===box||n===body}
function ours(r){return r.target===box||box.contains(r.target)||[].every.call(r.addedNodes,mine)&&[].every.call(r.removedNodes,mine)}
function hide(){box.remove();if(body&&!body.firstChild)body.remove()}
var mo=new MutationObserver(function(records){if(records.some(function(r){return !ours(r)})){last=Date.now();hide()}});
mo.observe(d,{childList:true,subtree:true});
function finish(){done=true;clearInterval(timer);mo.disconnect()}
w.${documentEndCall}=function(){finish();hide();delete w.${documentEndCall}};
function check(){
 var quiet=Date.now()-last;
 if(done||quiet<${busyMs})return;
 if(!box.isConnected)(d.body||(body=d.documentElement.appendChild(d.createElement('body')))).appendChild(box);
 if(quiet<stall||probing||Date.now()<next)return;
 probing=true;next=Date.now()+1000;
 var abort=new AbortController(),limit=setTimeout(function(){abort.abort()},3000);
 fetch('/health',{cache:'no-store',signal:abort.signal}).then(function(r){return r.ok||r.status===503},function(){return false}).then(function(up){
  clearTimeout(limit);probing=false;
  if(!up||done||Date.now()-last<stall)return;
  finish();location.reload();
 });
}
timer=setInterval(check,500);
})()`;

/** Written after the document's last byte: the document is complete. */
export const documentEndMarker = `<script>self.${documentEndCall}&&${documentEndCall}();document.currentScript.remove()</script>`;
