import React from 'react';
import {Section,Field} from './forms';
import {caseLabels,toolLabels} from './ProcedureReceipt';

// Compare saved values, including the declared cases, rather than evaluator output.
function fields(definition){
 const rows=[
  ['Intent',definition.intent],['Instructions',definition.instructions],
  ['Model',definition.model],['Human escalation',definition.humanEscalation],
  ['Read-only sandbox tools',[...definition.tools].sort().map(tool=>toolLabels[tool]||tool).join('\n')],
  ['Maximum simulation cost (USD)',String(definition.maxCost)],
  ['Maximum output tokens per case',String(definition.maxTokens)],
 ];
 for(const [kind,label] of Object.entries(caseLabels)){
  const item=definition.cases.find(entry=>entry.kind===kind);
  for(const [key,name] of [['prompt','Synthetic prompt'],['expected','Required phrase'],['forbidden','Forbidden phrase']])rows.push([`${label} · ${name}`,item?.[key]??'Not declared']);
 }
 return rows;
}
export default function ProcedureDefinition({version,versions,comparisonId,onCompare,onRevise,busy}){
 const peers=versions.filter(item=>item.procedure_key===version.procedure_key&&item.id!==version.id);
 const compared=peers.find(item=>item.id===comparisonId),current=fields(version.definition),previous=compared&&fields(compared.definition);
 const changed=compared&&current.some(([,value],index)=>value!==previous[index][1]);
 const source=versions.find(item=>item.id===version.definition.basedOnVersionId);
 return <Section title={`Version ${version.version} definition`} description="Saved instructions, tools, budgets and required synthetic cases. Comparing or copying a version does not qualify or release it.">
  <p>Procedure: <strong>{version.procedure_key}</strong> · Saved <time dateTime={new Date(version.created_at).toISOString()}>{new Date(version.created_at).toLocaleString()}</time></p>
  {source&&<p>Based on {source.procedure_key} · Version {source.version}.</p>}
  <div className="procedure-definition-controls">
   {peers.length>0?<Field name="procedure-compare" label="Compare with" value={compared?.id||''} onChange={(_,value)=>onCompare(value)} options={[{value:'',label:'Selected version only'},...peers.map(item=>({value:item.id,label:`${item.procedure_key} · Version ${item.version}`}))]}/>:<p>Save another version of this procedure to compare changes.</p>}
   <button type="button" className="btn btn-white" aria-disabled={busy} onClick={onRevise}>Draft from this version</button>
  </div>
  {compared&&<p role="status">{changed?'Changed values are marked below.':'These versions have the same instructions, tools, budgets and required cases.'}</p>}
  <table className={`procedure-definition${compared?' procedure-comparison':''}`}>
   <caption className="visually-hidden">{version.procedure_key}: {compared?`Version ${compared.version} compared with selected Version ${version.version}`:`saved Version ${version.version}`}</caption>
   <thead><tr><th scope="col">Setting</th>{compared&&<th scope="col">Version {compared.version}</th>}<th scope="col">Selected · Version {version.version}</th></tr></thead>
   <tbody>{current.map(([label,value],index)=>{
    const different=compared&&previous[index][1]!==value;
    return <tr key={label} className={different?'procedure-value-changed':undefined}>
     <th scope="row">{label}{compared&&<span className="procedure-change">{different?'Changed':'Unchanged'}</span>}</th>
     {compared&&<td><span className="procedure-value-label" aria-hidden="true">Version {compared.version}</span>{previous[index][1]}</td>}
     <td><span className="procedure-value-label" aria-hidden="true">Selected · Version {version.version}</span>{value}</td>
    </tr>;
   })}</tbody>
  </table>
 </Section>;
}
