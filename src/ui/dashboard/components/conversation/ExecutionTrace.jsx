import React, {useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../../../native/transport';

/** The existing Ticket section presents allowlisted production receipts only. */
export default function ProductionTrace({projectId,conversationId,shown}){
 const [result,setResult]=useState(null),[report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),epoch=useRef(0);
 const base=`/api/ai-support/projects/${projectId}`;
 useEffect(()=>{epoch.current++;setResult(null);setReport(null);setError('');setBusy(false);return ()=>{epoch.current++;};},[base,conversationId]);
 const read=async(offset=0)=>{
  const current=epoch.current;setBusy(true);setError('');
  try{const data=await nativeRequest(`${base}/conversations/${conversationId}/trace?offset=${offset}`);if(current===epoch.current)setResult(prior=>({...data,traces:offset?[...(prior?.traces||[]),...data.traces]:data.traces}));}
  catch(e){if(current===epoch.current)setError(e.message);}finally{if(current===epoch.current)setBusy(false);}
 };
 const inspect=async key=>{
  const current=epoch.current;setBusy(true);setError('');
  try{const data=await nativeRequest(`${base}/procedure-reports/${encodeURIComponent(key)}`);if(current===epoch.current)setReport(data);}
  catch(e){if(current===epoch.current)setError(e.message);}finally{if(current===epoch.current)setBusy(false);}
 };
 const moreCases=async()=>{
  const current=epoch.current;setBusy(true);setError('');
  try{const data=await nativeRequest(`${base}/procedure-reports/${encodeURIComponent(report.procedureKey)}?offset=${report.nextOffset}`);if(current===epoch.current)setReport(prior=>({...data,cases:[...prior.cases,...data.cases]}));}
  catch(e){if(current===epoch.current)setError(e.message);}finally{if(current===epoch.current)setBusy(false);}
 };
 const money=value=>typeof value==='number'?`$${value.toFixed(6)} USD`:'Price data unavailable';
 return <div className="production-trace" style={{overflowWrap:'anywhere'}}>
  <p>Inspect admitted answers, read-only tool receipts and handoffs. A completed read or proposal does not prove a customer action succeeded.</p>
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="btn btn-white btn-sm" disabled={busy||!shown} onClick={()=>read()}>{busy?'Loading traces…':result?'Refresh production traces':'Load production traces'}</button>
  {result&&!result.traces.length&&<p>No production generations recorded for this conversation.</p>}
  {result?.traces.map((trace,index)=><details key={trace.generationId}><summary>Generation {index+1}: {trace.state}{trace.result.customerMessageCommitted?' · answer committed':' · no admitted answer'}</summary>
   <p>Provider estimate: {money(trace.providerCostEstimateUsd)}. {trace.durationMs===null?'Duration unknown':`${trace.durationMs} ms`}.</p>
   {trace.failureCategory&&<p>Failure category: {trace.failureCategory}</p>}
   <p>Assistant version: <code>{trace.assistantVersion}</code></p>
   <ul aria-label="Issued knowledge sources">{trace.sources.map(source=><li key={source.id+source.sourceVersion}>{source.id} · {source.sourceVersion}</li>)}</ul>
   <ul aria-label="Tool receipts">{trace.toolTrace.calls.map(tool=><li key={tool.id}><strong>{tool.toolName}</strong>: {tool.state}; {tool.requestedScope}; {tool.approval}; {tool.durationMs===null?'duration unknown':`${tool.durationMs} ms`}{tool.responsibleHumanId?`; responsible human ${tool.responsibleHumanId}`:''}. Business action executed: no.</li>)}</ul>
   <ul aria-label="Provider usage">{trace.rounds.map(round=><li key={round.requestId}>{round.observed?'Observed':'Unconfirmed'} round: input {round.usage.input_tokens??'unknown'}, output {round.usage.output_tokens??'unknown'} tokens; {money(round.usage.cost)}.</li>)}</ul>
   {trace.procedure?.procedureKey&&<button type="button" className="btn btn-link" disabled={busy} onClick={()=>inspect(trace.procedure.procedureKey)}>Open procedure report: {trace.procedure.procedureKey} v{trace.procedure.version}</button>}
  </details>)}
  {result?.nextOffset!==null&&result?.nextOffset!==undefined&&<button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={()=>read(result.nextOffset)}>More traces</button>}
  {report&&<div aria-label="Procedure report"><h4>Procedure report: {report.procedureKey}</h4><p>{report.attribution}</p><p>{money(report.providerCostEstimateUsd)}</p>
   <ul>{report.versions.map(version=><li key={version.versionId}>Version {version.version}: {version.reopened}/{version.denominator} resolution cycles reopened ({version.excluded} excluded from {version.originalDenominator} original cycles); {version.negativeCsat}/{version.rated} rated cycles negative.</li>)}</ul>
   <p>{report.productionScope}</p><ul>{report.productionVersions.map(version=><li key={version.versionId}>{version.handoffs}/{version.generationDenominator} linked generations handed off; {version.failures} failed or uncertain outcomes.</li>)}</ul>
   <ul>{report.cases.map(item=><li key={item.resolutionId}><a href={`/projects/${projectId}/conversations/${item.conversationId}`}>Supporting case, version {item.version}</a>: {item.included===0?'excluded by human attribution review':item.reopenedAt?'reopened':'closed, recovery unconfirmed'}{item.negativeCsat?'; negative CSAT':''}</li>)}</ul>
   {report.nextOffset!==null&&<button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={moreCases}>More supporting cases</button>}
   <ul aria-label="Attribution reviews">{report.attributionReviews.map(review=><li key={review.id}>{review.decision}: {review.reason}; reviewer {review.reviewedBy}; evidence {review.evidenceMessageId}.</li>)}</ul>
   <ul>{report.failureClusters.map(cluster=><li key={cluster.category}>{cluster.category}: {cluster.count} linked generations.</li>)}</ul>
  </div>}
 </div>;
}
