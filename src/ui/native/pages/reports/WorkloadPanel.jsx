import React,{useState} from 'react';
import {reportCount,reportDuration,reportPercent} from './report-format';

const groupings=[['agent','Agent'],['team','Team'],['channel','Channel'],['brand','Brand'],['account','Account'],['tag','Tag']];
const count=(label,path)=>[label,row=>path.split('.').reduce((value,key)=>value?.[key],row),reportCount];
const percent=(label,path)=>[label,row=>path.split('.').reduce((value,key)=>value?.[key],row),reportPercent];
const distribution=path=>[count('Samples',path+'.count'),['Median',row=>row[path].median,reportDuration],['p90',row=>row[path].p90,reportDuration]];
const sla=metric=>[count('Met','sla.'+metric+'.met'),count('Breached','sla.'+metric+'.breached'),count('Pending','sla.'+metric+'.pending'),count('Eligible','sla.'+metric+'.denominator'),percent('Met rate','sla.'+metric+'.rate')];
const metrics={
 workload:{label:'Workload',columns:[count('Incoming','incoming'),count('Backlog','backlog'),count('Resolved','resolved')]},
 age:{label:'Backlog age',columns:[['Oldest',row=>row.oldest_age_ms,reportDuration],...[['under_1d','Under 1 day'],['days_1_3','1–3 days'],['days_3_7','3–7 days'],['days_7_30','7–30 days'],['days_30_plus','30+ days']].map(([id,label])=>[label,row=>row.ageBuckets.find(bucket=>bucket.id===id)?.count,reportCount])]},
 response:{label:'First response time',columns:distribution('firstResponse')},
 resolution:{label:'First resolution time',columns:distribution('firstResolution')},
 recovery:{label:'Customer-confirmed recovery',columns:[count('Recovered','recovery.recovered'),count('Still needs help','recovery.notRecovered'),count('Answered','recovery.answered'),percent('Recovered rate','recovery.rate'),count('Unknown','recovery.unknown')]},
 csat:{label:'Satisfaction',columns:[count('Positive','csat.positive'),count('Rated','csat.rated'),percent('Positive rate','csat.rate')]},
 firstSla:{label:'First response SLA',columns:sla('first_response')},
 nextSla:{label:'Next response SLA',columns:sla('next_response')},
 resolutionSla:{label:'Resolution SLA',columns:sla('resolution')},
 reopens:{label:'Reopened requests',columns:[count('Reopened','reopens.reopened'),count('Known resolved','reopens.denominator'),percent('Reopen rate','reopens.rate'),count('Events','reopens.events'),count('Unknown history','reopens.historyUnknown')]},
 containment:{label:'AI containment',columns:[count('Contained','ai.containment.contained'),count('Not contained','ai.containment.notContained'),count('Unknown','ai.containment.unknown'),count('Participating tickets','ai.containment.denominator'),percent('Containment rate','ai.containment.rate'),count('Customer confirmed','ai.containment.customerConfirmed')]},
 ai:{label:'Recorded AI outcomes',columns:[count('AI closed','ai.closed'),count('AI handoffs','ai.handedOff'),count('Assignments','ai.assignmentHandoffs'),count('Failed','ai.failed'),count('Uncertain','ai.uncertain'),count('Unknown outcome','ai.outcomeUnknown')]},
};
export default function WorkloadPanel({workload,breakdowns}){
 const [group,setGroup]=useState('team'),[metric,setMetric]=useState('workload'),selected=metrics[metric];
 const rows=(metric==='workload'||metric==='age'?workload:breakdowns)[group];
 return <section className="team-report-card" aria-labelledby="team-workload-heading">
  <div className="team-report-card-heading"><h3 id="team-workload-heading">{selected.label}</h3><label>Report metric<select aria-label="Report metric" className="form-select" value={metric} onChange={event=>setMetric(event.target.value)}>{Object.entries(metrics).map(([id,value])=><option key={id} value={id}>{value.label}</option>)}</select></label><label>Group by<select aria-label="Group workload by" className="form-select" value={group} onChange={event=>setGroup(event.target.value)}>{groupings.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
  <p className="team-report-muted">Incoming and service figures use the selected creation cohort. Backlog includes older unresolved tickets. Timing samples omit missing measurements; p90 uses the nearest rank. Pending SLA clocks are excluded from the met-rate denominator.</p>
  {rows.length?<div className="team-report-table-wrap" tabIndex={0} role="region" aria-label="Scrollable report table"><table className={`team-report-table${metric==='containment'?' team-report-containment-table':''}`}><caption className="visually-hidden">{selected.label} grouped by {group}</caption><thead><tr><th scope="col">{groupings.find(([id])=>id===group)[1]}</th>{selected.columns.map(([label])=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.id??'unassigned'}><th scope="row"><span className="team-report-dot" aria-hidden="true"/>{row.label}</th>{selected.columns.map(([label,value,format])=><td key={label}>{value(row)==null?'—':format(value(row))}</td>)}</tr>)}</tbody></table></div>:<p role="status">No data for this selection.</p>}
  {metric==='ai'&&<p className="team-report-muted">AI handoffs count confirmed transfers requested by the assistant. Assignments include ordinary native reassignment. Recorded AI closure does not verify customer recovery or containment. Failed and uncertain values count generation attempts; unknown outcomes stay unknown.</p>}
  {metric==='containment'&&<p className="team-report-muted">Contained means a currently closed, fully observed native ticket answered only by AI, with no human help, handoff, reopening or incomplete automatic generation. The rate includes unknown participating tickets in its denominator. Customer confirmed counts explicit recovery answers among contained tickets; containment alone does not verify resolution.</p>}
  {metric==='recovery'&&<p>Explicit customer answers for the latest cycle. Reopened cycles are unknown for current recovery. Satisfaction and AI closure do not establish recovery.</p>}
  {metric==='csat'&&<p className="team-report-muted">Latest-cycle feedback includes reopened cycles. Unrated cycles are excluded; thumbs up or 4–5 out of 5 is positive.</p>}
  {group==='tag'&&<p className="team-report-muted">A ticket with multiple tags appears in each tag group. Tag rows are not additive.</p>}
 </section>;
}
