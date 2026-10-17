import React, { useContext, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useDashboardSettings } from '../../../native/dashboard-state';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { nativeRequest } from '../../../native/transport';
import { useWorkflowResource } from '../../../native/pages/workflows/workflow-model';
import { ChatContext } from '../../contexts/ChatContext';
import ConversationDetailSection from '../conversation/ConversationDetailSection';
import { json, label, ticketPath } from '../tickets/ticket-model';
import SlaStatus from './SlaStatus';
import ScheduleForm from './ScheduleForm';
import { workflowTime } from './schedule-time';
import './workflows.css';
export default function WorkflowPanel({ conversation }) {
    const workspace=useDashboardSettings(),{agentsFor}=useContext(ChatContext),{markDirty,markSaved}=useUnsavedChanges();
    const base=ticketPath(conversation.project_id),path=`${base}/conversations/${encodeURIComponent(conversation.id)}`;
    const schedules=useWorkflowResource(`${path}/workflows`),sla=useWorkflowResource(`${path}/sla`),routing=useWorkflowResource(`${path}/routing`);
    const [draft,setDraft]=useState(null),[dirty,setDirty]=useState(false);
    const canManage=schedules.data?.data.permissions?.manage===true,canReply=schedules.data?.data.permissions?.reply===true;
    const agents=(agentsFor(conversation.project_id)||[]).filter(row=>row.access_role!=='collaborator');
    const edit=item=>{if(dirty&&!window.confirm('Discard unsaved schedule changes?'))return;setDraft(item);setDirty(false);markSaved();};
    const refresh=async()=>{await Promise.all([schedules.run(()=>Promise.resolve()),sla.run(()=>Promise.resolve()),routing.run(()=>Promise.resolve())]);};
    const cancel=async item=>{if(!window.confirm(`Cancel this ${item.kind==='reply'?'scheduled reply':'snooze'}?`))return;await schedules.run(()=>nativeRequest(`${base}/workflow-schedules/${encodeURIComponent(item.id)}`,json('PATCH',{action:'cancel'})));};
    const decision=routing.data?.decision;
    return <ConversationDetailSection title="SLA and workflows" className="workflow-panel">
        <button type="button" className="btn btn-link btn-sm" disabled={schedules.busy||sla.busy||routing.busy} onClick={refresh}>Refresh workflows</button>
        {sla.error&&<p className="text-danger" role="alert">SLA: {sla.error}</p>}{!sla.data&&!sla.error&&<p role="status">Loading SLA…</p>}
        <SlaStatus data={sla.data?.data} canManage={canManage} busy={sla.busy} onAcknowledge={alert=>sla.run(()=>nativeRequest(`${base}/sla-alerts/${encodeURIComponent(alert.id)}/ack`,json('PATCH',{})))}/>
        <details><summary>Why this ticket was routed</summary>{routing.error&&<p className="text-danger" role="alert">{routing.error}</p>}{!routing.data&&!routing.error&&<p role="status">Loading routing decision…</p>}{routing.data&&(decision?<><p><strong>{decision.rule_name}</strong> · {label(decision.strategy)}</p><p>{decision.explanation}</p><p>{decision.winner_id?`Operator: ${agents.find(row=>row.id===decision.winner_id)?.name||decision.winner_id}`:'No operator selected'}{decision.overflow?' · Overflow team':''}<br/>{workflowTime(decision.created_at)}</p></>:<p className="settings-note">No automatic routing decision has been recorded.</p>)}</details>
        <details open><summary>Snooze and scheduled replies</summary>{schedules.error&&<p className="text-danger" role="alert">{schedules.error}</p>}{!schedules.data&&!schedules.error&&<p role="status">Loading schedules…</p>}{schedules.data?.data.schedules.map(item=><article className="workflow-schedule" key={item.id}><strong>{item.kind==='reply'?'Scheduled reply':'Snooze'} · {label(item.state)}</strong><p>Due: <time dateTime={item.due_at?new Date(item.due_at).toISOString():undefined}>{workflowTime(item.due_at,item.timezone)}</time> · {item.timezone}<br/>Owner: {agents.find(row=>row.id===item.owner_id)?.name||item.owner_id}</p>{item.dependency_id&&<p>Waiting for <Link to={`/projects/${conversation.project_id}/conversations/${item.dependency_id}`}>ticket {item.dependency_id}</Link></p>}{item.body&&<p>{item.body}</p>}{item.reason&&<p>{label(item.reason)}</p>}{item.state==='uncertain'&&<p role="alert">Delivery outcome is unknown. This reply will not be sent again automatically.</p>}{item.state==='pending'&&(item.kind==='reply'?canReply:canManage)&&(item.sender_id===workspace.currentAgent?.id||['owner','admin'].includes(workspace.projects?.[conversation.project_id]?.role))&&<div className="workflow-panel-actions"><button type="button" disabled={schedules.busy} onClick={()=>edit(item)}>Edit</button><button type="button" disabled={schedules.busy} onClick={()=>cancel(item)}>Cancel schedule</button></div>}</article>)}{schedules.data?.data.schedules.length===0&&<p className="settings-note">No schedules for this ticket.</p>}{(canManage||canReply)&&!['closed','solved'].includes(conversation.status_category)&&<>{draft?<ScheduleForm key={draft.id||draft.kind} schedule={draft} {...{conversation,agents}} currentAgentId={workspace.currentAgent?.id} changed={()=>{setDirty(true);markDirty();}} clean={()=>{setDirty(false);markSaved();}} onCancel={()=>setDraft(null)} onSaved={async()=>{setDraft(null);await schedules.reload();}}/>:<div className="workflow-panel-actions">{canManage&&<button type="button" onClick={()=>edit({kind:'snooze'})}>Snooze</button>}{canReply&&<button type="button" onClick={()=>edit({kind:'reply'})}>Schedule reply</button>}</div>}</>}{schedules.data&&!canManage&&!canReply&&<p className="settings-note">Your role can read schedules. Ticket management permission is required to change them.</p>}</details>
        {schedules.data?.data.followup_of&&<p>Follow-up to <Link to={`/projects/${conversation.project_id}/conversations/${schedules.data.data.followup_of}`}>ticket {schedules.data.data.followup_of}</Link></p>}{schedules.data?.data.followups.length>0&&<details open><summary>Follow-up tickets</summary><ul>{schedules.data.data.followups.map(row=><li key={row.id}><Link to={`/projects/${conversation.project_id}/conversations/${row.id}`}>{row.subject||row.id}</Link> · {label(row.status_category)}</li>)}</ul></details>}
    </ConversationDetailSection>;
}
