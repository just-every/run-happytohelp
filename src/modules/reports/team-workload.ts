import {statement,type TeamReportContext} from './team-scope'

export type WorkloadRow={id:string|null;label:string;incoming:number;resolved:number;backlog:number}
const active="status_category NOT IN ('solved','closed')"
export async function teamWorkload(context:TeamReportContext){
 const {results}=await statement(context,`, dimensions AS (
 SELECT c.id conversation_id,c.created_at,c.status_category,'agent' dimension,c.assigned_to key,COALESCE(u.name,c.assigned_to,'Unassigned') label FROM scoped c LEFT JOIN users u ON u.id=c.assigned_to
 UNION ALL SELECT c.id,c.created_at,c.status_category,'team',c.group_id,COALESCE(g.name,c.group_id,'No team') FROM scoped c LEFT JOIN ticket_groups g ON g.project_id=c.project_id AND g.id=c.group_id
 UNION ALL SELECT c.id,c.created_at,c.status_category,'channel',c.channel,c.channel FROM scoped c
 UNION ALL SELECT c.id,c.created_at,c.status_category,'brand',COALESCE(c.brand_id,c.project_id),CASE WHEN COALESCE(c.brand_id,c.project_id)=p.id THEN p.name ELSE c.brand_id END FROM scoped c JOIN projects p ON p.id=c.project_id
 UNION ALL SELECT c.id,c.created_at,c.status_category,'account',a.id,COALESCE(a.name,'No account') FROM scoped c LEFT JOIN contact_companies cc ON cc.project_id=c.project_id AND cc.contact_id=c.contact_id LEFT JOIN companies a ON a.project_id=cc.project_id AND a.id=cc.company_id AND a.merged_into IS NULL
 UNION ALL SELECT c.id,c.created_at,c.status_category,'tag',t.id,COALESCE(t.name,'Untagged') FROM scoped c LEFT JOIN conversation_tags ct ON ct.project_id=c.project_id AND ct.conversation_id=c.id LEFT JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id
 ) SELECT dimension,key id,label,SUM(created_at>=?2) incoming,SUM(created_at>=?2 AND status_category IN ('solved','closed')) resolved,SUM(${active}) backlog FROM dimensions GROUP BY dimension,key,label ORDER BY dimension,incoming DESC,backlog DESC,label,key`).all<WorkloadRow&{dimension:'agent'|'team'|'channel'|'brand'|'tag'|'account'}>()
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
