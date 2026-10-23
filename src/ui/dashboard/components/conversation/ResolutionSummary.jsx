import React from 'react';
import ConversationDetailSection from './ConversationDetailSection';
const labels={ai:'AI',assisted:'Assisted',human:'Human',unknown:'Unknown'};
function Feedback({resolution}) {
    return <>
        <div><strong>Outcome</strong><p>{labels[resolution.outcome]||'Unknown'}</p></div>
        <div><strong>Visitor rating</strong><p>{resolution.rating?(resolution.rating.scale==='five'?`${resolution.rating.score} / 5`:resolution.rating.value===1?'Thumbs up':'Thumbs down'):'Not rated'}</p></div>
        {resolution.rating?.comment&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{resolution.rating.comment}</p>}
    </>;
}
export default function ResolutionSummary({resolution,history=[]}) {
    return <>
        {resolution&&<ConversationDetailSection title="Resolution"><Feedback resolution={resolution}/></ConversationDetailSection>}
        {history.length>0&&<ConversationDetailSection title="Past resolutions">
            {history.map(item=><div key={item.id} aria-label={item.orderUnknown?'Historical resolution':`Resolution ${item.ordinal}`}>
                <h4>{item.orderUnknown?'Historical resolution':`Resolution ${item.ordinal}`}</h4>
                {item.orderUnknown&&<p>Earlier resolution order was not recorded.</p>}
                <p>Resolved <time dateTime={item.resolvedAt}>{new Date(item.resolvedAt).toLocaleString()}</time></p>
                <p>Reopened <time dateTime={item.reopenedAt}>{new Date(item.reopenedAt).toLocaleString()}</time></p>
                <Feedback resolution={item}/>
            </div>)}
        </ConversationDetailSection>}
    </>;
}
