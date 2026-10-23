import {statement,type TeamReportContext} from './team-scope'

export type WorkloadRow={id:string|null;label:string;incoming:number;resolved:number;backlog:number}
export const teamDimensionsSQL=`, dimensions AS (
 SELECT c.id conversation_id,c.created_at,c.status_category,d.value dimension,
 CASE d.value WHEN 'agent' THEN c.assigned_to WHEN 'team' THEN c.group_id WHEN 'channel' THEN c.channel WHEN 'brand' THEN COALESCE(c.brand_id,c.project_id) WHEN 'account' THEN a.id ELSE t.id END key,
 CASE d.value WHEN 'agent' THEN COALESCE(u.name,c.assigned_to,'Unassigned') WHEN 'team' THEN COALESCE(g.name,c.group_id,'No team') WHEN 'channel' THEN c.channel WHEN 'brand' THEN CASE WHEN COALESCE(c.brand_id,c.project_id)=p.id THEN p.name ELSE c.brand_id END WHEN 'account' THEN COALESCE(a.name,'No account') ELSE COALESCE(t.name,'Untagged') END label
 FROM scoped c CROSS JOIN json_each('["agent","team","channel","brand","account","tag"]') d
 JOIN projects p ON p.id=c.project_id
 LEFT JOIN users u ON d.value='agent' AND u.id=c.assigned_to
 LEFT JOIN ticket_groups g ON d.value='team' AND g.project_id=c.project_id AND g.id=c.group_id
 LEFT JOIN contact_companies cc ON d.value='account' AND cc.project_id=c.project_id AND cc.contact_id=c.contact_id
 LEFT JOIN companies a ON a.project_id=cc.project_id AND a.id=cc.company_id AND a.merged_into IS NULL
 LEFT JOIN conversation_tags ct ON d.value='tag' AND ct.project_id=c.project_id AND ct.conversation_id=c.id
 LEFT JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id
 )`
const active="status_category NOT IN ('solved','closed')"
export async function teamWorkload(context:TeamReportContext){
 const {results}=await statement(context,`${teamDimensionsSQL} SELECT dimension,key id,label,SUM(created_at>=?2) incoming,SUM(created_at>=?2 AND status_category IN ('solved','closed')) resolved,SUM(${active}) backlog FROM dimensions GROUP BY dimension,key,label ORDER BY dimension,incoming DESC,backlog DESC,label,key`).all<WorkloadRow&{dimension:'agent'|'team'|'channel'|'brand'|'tag'|'account'}>()
 const workload:{agent:WorkloadRow[];team:WorkloadRow[];channel:WorkloadRow[];brand:WorkloadRow[];tag:WorkloadRow[];account:WorkloadRow[]}={agent:[],team:[],channel:[],brand:[],tag:[],account:[]}
 for(const {dimension,...row} of results)workload[dimension].push(row)
 return workload
}

export async function teamBacklog(context:TeamReportContext){
 const row=await statement(context,`SELECT COUNT(*) total,MIN(created_at) oldest_created_at,
 SUM(CASE WHEN ?7-created_at<86400000 THEN 1 ELSE 0 END) under_1d,
 SUM(CASE WHEN ?7-created_at>=86400000 AND ?7-created_at<259200000 THEN 1 ELSE 0 END) days_1_3,
 SUM(CASE WHEN ?7-created_at>=259200000 AND ?7-created_at<604800000 THEN 1 ELSE 0 END) days_3_7,
 SUM(CASE WHEN ?7-created_at>=604800000 AND ?7-created_at<2592000000 THEN 1 ELSE 0 END) days_7_30,
 SUM(CASE WHEN ?7-created_at>=2592000000 THEN 1 ELSE 0 END) days_30_plus
 FROM scoped WHERE ${active}`).bind(context.projectId,context.range.startAt,context.range.endAt,context.filters.teamId,context.filters.brandId,context.filters.includeImported?1:0,context.now).first<any>()
 return {total:row.total,oldest_age_ms:row.oldest_created_at===null?null:Math.max(0,context.now-row.oldest_created_at),buckets:[
  {id:'under_1d',label:'Under 1 day',count:row.under_1d??0},{id:'days_1_3',label:'1–3 days',count:row.days_1_3??0},{id:'days_3_7',label:'3–7 days',count:row.days_3_7??0},{id:'days_7_30',label:'7–30 days',count:row.days_7_30??0},{id:'days_30_plus',label:'30 days or more',count:row.days_30_plus??0}
 ]}
}
