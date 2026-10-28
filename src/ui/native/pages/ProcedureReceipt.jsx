import React from 'react';
import ProviderSetupNotice from '../activation/ProviderSetupNotice';

export const caseLabels={allowed:'Allowed read',denied:'Denied read',timeout:'Read timeout',injection:'Prompt injection'};
export const toolLabels={search_knowledge:'Search knowledge',read_knowledge_source:'Read knowledge source'};
const activeStatuses=['planning','queued','running'];
function failureMessage(failure){
 const phrases=value=>(Array.isArray(value)?value:[]).map(phrase=>`“${phrase}”`).join(', ');
 switch(failure.check){
  case 'must_not_include_per_reply': return `Used the forbidden phrase ${phrases(failure.actual)}.`;
  case 'must_include_any_per_reply': return `Did not include a required phrase: ${phrases(failure.expected)}.`;
  case 'must_include_all_per_reply': return `Did not include the required phrases: ${phrases(failure.expected)}.`;
  case 'required_sandbox_read': return 'Did not read the sandbox as required.';
  case 'response_cardinality': return 'Did not return one response.';
  default: return 'The response did not meet the declared requirements.';
 }
}
export default function ProcedureReceipt({receipt,versionId,projectId}){
 return <div aria-label="Simulation receipt" className="procedure-receipt">
  <p>Version receipt: <code>{versionId}</code></p>
  {receipt.cases.map(item=>{
   const notRun=['queued','cancelled'].includes(item.status)&&!activeStatuses.includes(receipt.status);
   const failures=[...new Set((item.checks?.failures||[]).map(failureMessage))];
   const sandbox=item.artifact?.sandbox?.receipts||[];
   const setup=item.error?.startsWith('CONFIGURATION_REQUIRED:');
   return <article key={item.id} className="procedure-case">
    <h3>{caseLabels[item.case_id]||'Synthetic case'}</h3>
    <p>{notRun?'Not run':item.status==='uncertain'?'Result uncertain':item.checks?.passed?'Passed':item.checks?'Not passed':item.status==='running'?'Running':'Queued'}</p>
    {item.checks&&!item.checks.passed&&failures.length>0&&<ul>{failures.map(message=><li key={message}>{message}</li>)}</ul>}
    {setup?<ProviderSetupNotice projectId={projectId} error={item.error}/>:item.error&&!notRun&&<p>The simulation stopped without a confirmed result. Review the provider connection and simulation budget before starting another run.</p>}
    {item.status==='uncertain'&&<p>This attempt will not be replayed automatically. Inspect its error and any retained output before starting another run.</p>}
    {item.artifact?.response&&<p>Reply: {item.artifact.response}</p>}
    {sandbox.length?sandbox.map((read,index)=><p key={index}>{toolLabels[read.tool]||'Sandbox read'}: {read.status==='ok'?'completed':read.status==='timeout'?'timed out':read.status==='denied'?'denied':'unavailable'}</p>):<p>No sandbox read</p>}
   </article>;
  })}
 </div>;
}
