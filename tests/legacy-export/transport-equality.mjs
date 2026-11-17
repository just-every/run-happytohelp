import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {findDatabase} from '../helpers/upgrade-snapshot.mjs'
import {createHash} from 'node:crypto'
const tables={
 projects:'id,name,allowed_origin,created_at',
 users:'id,name,email,created_at',
 memberships:'project_id,user_id,role',
 contacts:'id,project_id,name,email,external_id,is_verified,metadata_json,created_at',
 conversations:'id,project_id,contact_id,subject,assigned_to,resolved_at,revision,last_message_id,created_at,updated_at',
 messages:'id,project_id,conversation_id,bucket_id,actor_id,actor_role,content,local_id,revision,created_at',
 message_authorship:'message_id,project_id,kind,source_kind,recorded_at',
 conversation_notes:'id,conversation_id,user_id,content,created_at',
 conversation_buckets:'id,conversation_id,metadata_json,created_at',
 conversation_participants:'id,conversation_id,contact_id,created_at',
 media:'id,project_id,conversation_id,message_id,object_key,filename,content_type,size,created_at',
 knowledge_categories:'id,project_id,parent_id,name,slug,summary,is_published,position',
 knowledge_articles:'id,project_id,title,slug,content,summary,status,updated_at',
 knowledge_article_categories:'article_id,category_id',
 knowledge_datasets:'id,project_id,url,status,published_version,excluded_urls,source_input,refresh_mode,next_refresh_at,claim_token,created_at',
 knowledge_documents:'id,version_id,url,title,content',
 macros:'id,project_id,title,content,created_by,created_at,updated_at',
 project_settings:'project_id,settings_json,updated_at',
 email_settings:'project_id,from_name,from_address,inbound_address,is_enabled,updated_at',
 local_jobs:'id,project_id,conversation_id,operator_id,device_id,status,claim_id,delivery_state',
 local_events:'job_id,event_id,kind,payload,created_at',
 billing_ledger:'id,project_id,amount_minor,provider_id,created_at',
 billing_usage_history:'id,project_id,model,cost_decimal,source_json,created_at',
}
export async function transportEquality(left,right){
 const a=new DatabaseSync(await findDatabase(left+'/v3/d1'),{readOnly:true}),b=new DatabaseSync(await findDatabase(right+'/v3/d1'),{readOnly:true})
 const result={}
 try{for(const [table,columns] of Object.entries(tables)){
  const values=db=>db.prepare(`SELECT ${columns} FROM ${table} ORDER BY ${columns.split(',').map((_,i)=>i+1).join(',')}`).all().map(r=>({...r}))
  const rows=values(a);assert.deepEqual(values(b),rows,'--file and --package canonical '+table)
  result[table]={rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}
 }}finally{a.close();b.close()}
 return result
}
