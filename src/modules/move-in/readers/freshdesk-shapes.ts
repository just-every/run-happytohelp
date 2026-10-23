/** Freshdesk API v2 objects as the Move in script writes them: one singular wrapper per line,
 * `{"ticket":{...,"conversations":[...]}}`, `{"contact":{...}}`, `{"agent":{...}}` or
 * `{"canned_response":{...}}`. Fields the mapping does not read are typed, so a documented
 * response raises no diagnostic; free-form or address fields stay opaque and are reported. */
export function freshdeskShapes(s:any){
 const {record:r,array:a,nullable:n,string:t,integer:i,id,reference:ref,opaque:o,boolean:b}=s,iso={type:'iso'}
 const attachment=r({id,name:t,content_type:t,size:i,created_at:iso,updated_at:iso})
 const stats=r({agent_responded_at:n(iso),requester_responded_at:n(iso),first_responded_at:n(iso),status_updated_at:n(iso),reopened_at:n(iso),resolved_at:n(iso),closed_at:n(iso),pending_since:n(iso)})
 const conversation=r({id,body:n(t),body_text:n(t),incoming:b,private:b,user_id:ref,source:i,category:n(i),ticket_id:id,attachments:a(attachment),created_at:iso,updated_at:iso,last_edited_at:n(iso),last_edited_user_id:n(ref),auto_response:n(b),automation_id:n(id),automation_type_id:n(i),thread_id:n(id),thread_message_id:n(id),email_failure_count:n(i),outgoing_failures:n(o),source_additional_info:n(o),support_email:n(o),from_email:n(o),to_emails:n(o),cc_emails:n(o),bcc_emails:n(o)},['id','user_id'])
 const requester={...r({id:ref,name:n(t),email:n(t),mobile:n(t),phone:n(t)},['id']),person:true}
 return {
  'freshdesk/company':r({id,name:t,domains:a(t),description:n(o),note:n(o),custom_fields:n(o),created_at:iso,updated_at:iso,health_score:n(t),account_tier:n(t),renewal_date:n(t),industry:n(t)},['id','name','created_at','updated_at']),
  'freshdesk/ticket':r({id,subject:n(t),description:n(t),description_text:n(t),status:i,priority:i,source:i,type:n(t),requester_id:ref,responder_id:n(ref),group_id:n(id),company_id:n(id),product_id:n(id),email_config_id:n(id),form_id:n(id),spam:b,deleted:b,fr_escalated:b,is_escalated:b,nr_escalated:n(b),due_by:n(iso),fr_due_by:n(iso),nr_due_by:n(iso),association_type:n(i),associated_tickets_count:n(i),sentiment_score:n(i),initial_sentiment_score:n(i),tags:n(a(t)),attachments:a(attachment),custom_fields:n(o),structured_description:n(o),source_additional_info:n(o),cc_emails:n(o),fwd_emails:n(o),reply_cc_emails:n(o),ticket_cc_emails:n(o),to_emails:n(o),support_email:n(o),requester,stats,conversations:a(conversation),created_at:iso,updated_at:iso},['id','requester_id','conversations']),
  'freshdesk/contact':{...r({id,name:n(t),email:n(t),other_emails:n(a(t)),unique_external_id:n(t),phone:n(t),mobile:n(t),twitter_id:n(t),facebook_id:n(t),other_phone_numbers:n(a(o)),address:n(t),description:n(t),job_title:n(t),language:n(t),time_zone:n(t),company_id:n(id),other_companies:n(a(o)),view_all_tickets:n(b),active:b,deleted:n(b),tags:n(a(t)),custom_fields:n(o),csat_rating:n(i),preferred_source:n(t),first_name:n(t),last_name:n(t),visitor_id:n(t),org_contact_id:n(id),created_at:iso,updated_at:iso},['id']),person:true},
  'freshdesk/agent':{...r({id,type:n(t),available:n(b),available_since:n(iso),occasional:n(b),focus_mode:n(b),deactivated:n(b),ticket_scope:n(i),signature:n(t),group_ids:n(a(id)),role_ids:n(a(id)),skill_ids:n(a(id)),agent_operational_status:n(t),last_active_at:n(iso),contact:r({name:n(t),email:n(t),active:n(b),job_title:n(t),language:n(t),time_zone:n(t),mobile:n(t),phone:n(t),last_login_at:n(iso),created_at:iso,updated_at:iso}),created_at:iso,updated_at:iso},['id']),person:true},
  'freshdesk/canned_response':r({id,title:t,content:n(t),content_html:n(t),folder_id:n(id),visibility:i,group_ids:n(a(id)),attachments:a(attachment),created_at:iso,updated_at:iso}),
  'freshdesk/tag-name':r({name:t})
 }
}
