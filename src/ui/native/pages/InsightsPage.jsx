import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';
import ReportsTabs from './reports/ReportsTabs';
export default function InsightsPage({ projectId }) {
 const [items,setItems]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const load=async(after)=>{setBusy(true);setError('');try{const result=await nativeRequest(`/api/customer-context/${projectId}/insights${after?`?cursor=${encodeURIComponent(after)}`:''}`);setItems(previous=>after?[...previous,...result.data]:result.data);setCursor(result.nextCursor);}catch(e){setError(e.message);}finally{setBusy(false);}};
 useEffect(()=>{setItems([]);setCursor(null);load();},[projectId]);
 return <section className="workspace-insights workspace-insights--index" aria-busy={busy}>
  <ReportsTabs projectId={projectId} activeSection="insights"/>
  {error&&<p className="alert alert-danger" role="alert">{error}</p>}
  <div className="table-responsive workspace-insights__list"><table className="table table-hover insights-list">
   <thead><tr><th scope="col">Insight</th><th scope="col">Status</th><th scope="col" className="insights-list__seen">Seen</th></tr></thead>
   <tbody>{items.map(item=><tr key={item.id}>
    <td className="insights-list__insight"><div className="insight-identity"><div className="insight-identity__context"><span>{item.help_type}</span></div></div><div className="insight-content"><p>{item.content}</p></div></td>
    <td className="insights-list__status"><span className={`insight-status insight-status--${item.dismissed_at?'closed':'quiet'}`}>{item.dismissed_at?'Closed':'Open'}</span></td>
    <td className="insights-list__seen"><time dateTime={new Date(item.created_at).toISOString()} title={new Date(item.created_at).toLocaleString()}>{new Date(item.created_at).toLocaleDateString()}</time></td>
   </tr>)}{!items.length&&!error&&<tr><td colSpan="3" className="insights-list__empty"><div><p>{busy?'Loading insights…':'No insights yet'}</p>{!busy&&<span>Insights from your conversations will appear here.</span>}</div></td></tr>}</tbody>
  </table></div>{cursor&&<button className="btn btn-white" disabled={busy} onClick={()=>load(cursor)}>Load more</button>}
 </section>;
}
