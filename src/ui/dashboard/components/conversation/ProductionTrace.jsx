import React, {useEffect, useState} from 'react';
import {requestJson} from '../../utils/requestJson';

export default function ProductionTrace({conversation,active}) {
    const [read,setRead]=useState({key:null,loading:true});
    const [version,reload]=useState(0);
    const key=`${conversation.project_id}:${conversation.id}`;
    useEffect(()=>{
        if(!active)return undefined;
        const controller=new AbortController();
        setRead({key,loading:true});
        requestJson(`/api/ai-support/projects/${conversation.project_id}/conversations/${conversation.id}/trace`,{credentials:'same-origin'},{signal:controller.signal})
            .then(data=>{if(!controller.signal.aborted)setRead({key,data});})
            .catch(()=>{if(!controller.signal.aborted)setRead({key,error:true});});
        return ()=>controller.abort();
    },[key,active,version]);
    if(!active)return null;
    const current=read.key===key?read:{loading:true};
    return <section aria-label="Execution trace" style={{overflowWrap:'anywhere'}}>
        <button className="btn btn-white" style={{minHeight:44}} onClick={()=>reload(v=>v+1)}>Refresh trace</button>
        {current.loading?<p role="status">Loading trace…</p>:current.error?<p role="alert">Trace unavailable. Refresh to try again.</p>:<>
            {!current.data.generations.length&&<p>No recorded executions.</p>}
            <p>Latest {current.data.limit} executions. Provider cost: unavailable.</p>
            {current.data.generations.map(run=><details key={run.id}>
                <summary style={{minHeight:44,padding:'12px 0'}}> {run.result} · {run.state}</summary>
                <dl>
                    <dt>Requested scope</dt><dd>{run.requestedScope}</dd>
                    <dt>Approval</dt><dd>{run.approval}</dd>
                    <dt>Source versions</dt><dd>Assistant <abbr title={run.source.assistantVersion}>{run.source.assistantVersion.slice(0,12)}</abbr><br/>Conversation {run.source.conversationRevision}, context {run.source.contextRevision}
                        {run.source.knowledge.map(source=><div key={source.source_id}>{source.source_id} · {source.source_version}</div>)}</dd>
                    <dt>Timing</dt><dd>{run.timing.startedAt||'Not started'} · {run.timing.durationMs===null?'Duration unavailable':`${run.timing.durationMs} ms`}</dd>
                    <dt>Provider outcome</dt><dd>{run.providerOutcome}</dd>
                    <dt>Contribution</dt><dd>{run.contribution}</dd>
                    <dt>Cycle outcome</dt><dd>{run.customerOutcome.cycle?<>
                        <div>Resolution {run.customerOutcome.cycle.id}</div>
                        <div>Resolved {run.customerOutcome.cycle.resolvedAt}</div>
                        <div>Recorded attribution: {run.customerOutcome.cycle.attribution}</div>
                        <div>{run.customerOutcome.cycle.rating?`Feedback: ${run.customerOutcome.cycle.rating.value} (${run.customerOutcome.cycle.rating.scale}), revision ${run.customerOutcome.cycle.rating.revision}`:'Feedback: not recorded'}</div>
                        <div>{run.customerOutcome.cycle.reopenedAt?`Reopened ${run.customerOutcome.cycle.reopenedAt}`:'No later reopening recorded'}</div>
                    </>:<>Unknown: {run.customerOutcome.reason}</>}</dd>
                    <dt>Supporting case</dt><dd><a href={`/projects/${conversation.project_id}/conversations/${conversation.id}`}>Open conversation</a></dd>
                    <dt>Interpretation</dt><dd>Contributions share a cycle; feedback does not establish causal blame or independently verified recovery.</dd>
                    <dt>Committed answer</dt><dd>{run.committedAnswer?`${run.committedAnswer.id} · revision ${run.committedAnswer.revision}`:'None recorded'}</dd>
                </dl>
                {run.tools.map((tool,index)=><p key={index}>{tool.name} · {tool.outcome} · {tool.durationMs===null?'Duration unavailable':`${tool.durationMs} ms`}</p>)}
            </details>)}
        </>}
    </section>;
}
