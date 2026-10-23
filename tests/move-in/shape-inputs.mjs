// Hand-written source documents and paths; deliberately independent of reader schemas.
const iso='2024-01-01T00:00:00Z',unix=1704067200;
export const privateEmail='shape-private@example.test';
export function documents(vendor){
 if(vendor==='zendesk')return {
  person:{user:{id:71,name:'Unaffected customer',email:'other@example.test',role:'end-user',created_at:iso}},
  conversation:{ticket:{id:72,requester_id:71,subject:'History',status:'open',created_at:iso,updated_at:iso,tags:['General'],via:{channel:'email'},comments:[{id:73,author_id:71,public:true,body:'Body',created_at:iso}]}},
  macro:{macro:{id:74,title:'Reply',restriction:null,actions:[{field:'comment_value',value:'Hello'}],created_at:iso,updated_at:iso}},
  article:{article:{id:75,title:'Guide',body:'Guide body',draft:true,user_segment_id:null,created_at:iso,updated_at:iso}}
 };
 return {
  person:{type:'contact',id:'customer',name:'Unaffected customer',email:'other@example.test',created_at:unix,tags:{type:'list',data:[{id:'general',name:'General'}]}},
  conversation:{type:'conversation',id:'history',state:'open',created_at:unix,updated_at:unix,channel:{initial:'email'},contacts:{type:'contact.list',contacts:[{id:'customer'}]},source:{id:'first',body:'Body',author:{type:'contact',id:'customer'}},conversation_parts:{type:'conversation_part.list',total_count:1,conversation_parts:[{id:'reply',part_type:'comment',body:'Reply',created_at:unix,author:{id:'staff',type:'admin'}}]},tags:{type:'tag.list',tags:[{id:'general',name:'General'}]}},
  macro:{type:'macro',id:'reply',name:'Reply',body:'Hello',visible_to:'everyone',available_on:['inbox'],created_at:iso,updated_at:iso},
  article:{type:'article',id:'guide',title:'Guide',body:'Guide body',state:'draft',created_at:unix,updated_at:unix}
 };
}
// Each tuple names a real source field, the replacement value, and the expected
// independent JSON pointer relative to that record's payload.
const hidden={customer:{email:privateEmail}};
export const cases={
 intercom:[
  ['conversation',['source','unrecognized'],hidden,'/source/unrecognized','unsupported_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'unrecognized'],hidden,'/conversation_parts/conversation_parts/0/unrecognized','unsupported_source_field'],
  ['person',['name'],hidden,'/name','malformed_source_field'],
  ['person',['tags','data',0,'name'],hidden,'/tags/data/0/name','malformed_source_field'],
  ['person',['tags','data',0,'extra'],hidden,'/tags/data/0/extra','unsupported_source_field'],
  ['person',['custom_attributes'],privateEmail,'/custom_attributes','opaque_source_field'],
  ['person',['user_fields'],[hidden],'/user_fields','opaque_source_field'],
  ['person',['custom_attributes'],{},'/custom_attributes','opaque_source_field'],
  ['person',['unknown'],null,'/unknown','unsupported_source_field'],
  ['conversation',['channel','initial'],hidden,'/channel/initial','malformed_source_field'],
  ['conversation',['channel','extra'],hidden,'/channel/extra','unsupported_source_field'],
  ['conversation',['channel','initial'],privateEmail,'/channel/initial','malformed_source_field'],
  ['conversation',['contacts','type'],privateEmail,'/contacts/type','malformed_source_field'],
  ['conversation',['contacts','extra'],hidden,'/contacts/extra','unsupported_source_field'],
  ['conversation',['contacts','contacts',0,'name'],hidden,'/contacts/contacts/0/name','malformed_source_field'],
  ['conversation',['contacts','contacts'],[null],'/contacts/contacts/0','malformed_source_field'],
  ['conversation',['source','author','name'],hidden,'/source/author/name','malformed_source_field'],
  ['conversation',['source','author','type'],hidden,'/source/author/type','malformed_source_field'],
  ['conversation',['source','author','type'],privateEmail,'/source/author/type','malformed_source_field'],
  ['conversation',['source','body'],hidden,'/source/body','malformed_source_field'],
  ['conversation',['source','attachments'],[hidden],'/source/attachments/0/customer','unsupported_source_field'],
  ['conversation',['source','metadata'],privateEmail,'/source/metadata','unsupported_source_field'],
  ['conversation',['conversation_parts','extra'],hidden,'/conversation_parts/extra','unsupported_source_field'],
  ['conversation',['conversation_parts','type'],privateEmail,'/conversation_parts/type','malformed_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'author','extra'],hidden,'/conversation_parts/conversation_parts/0/author/extra','unsupported_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'author','email'],hidden,'/conversation_parts/conversation_parts/0/author/email','malformed_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'part_type'],hidden,'/conversation_parts/conversation_parts/0/part_type','malformed_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'part_type'],privateEmail,'/conversation_parts/conversation_parts/0/part_type','malformed_source_field'],
  ['conversation',['conversation_parts','conversation_parts',0,'attachments'],hidden,'/conversation_parts/conversation_parts/0/attachments','malformed_source_field'],
  ['conversation',['conversation_parts','conversation_parts'],[null],'/conversation_parts/conversation_parts/0','malformed_source_field'],
  ['conversation',['tags','tags'],[hidden],'/tags/tags/0/customer','unsupported_source_field'],
  ['macro',['available_on'],['inbox',hidden],'/available_on/1','malformed_source_field'],
  ['macro',['body_text'],hidden,'/body_text','malformed_source_field'],
  ['macro',['visible_to'],privateEmail,'/visible_to','malformed_source_field'],
  ['article',['translated_content'],hidden,'/translated_content','opaque_source_field'],
  ['article',['audience_rules'],[hidden],'/audience_rules','opaque_source_field'],
  ['article',['body_markdown'],hidden,'/body_markdown','malformed_source_field'],
  ['article',['state'],privateEmail,'/state','malformed_source_field'],
  ['article',['user_segment_ids'],[hidden],'/user_segment_ids','unsupported_source_field']
 ],
 zendesk:[
  ['person',['name'],hidden,'/name','malformed_source_field'],
  ['person',['role'],privateEmail,'/role','malformed_source_field'],
  ['person',['tags'],[hidden],'/tags/0','malformed_source_field'],
  ['person',['user_fields'],privateEmail,'/user_fields','opaque_source_field'],
  ['person',['custom_attributes'],[hidden],'/custom_attributes','opaque_source_field'],
  ['conversation',['comments',0,'unrecognized'],hidden,'/comments/0/unrecognized','unsupported_source_field'],
  ['conversation',['status'],privateEmail,'/status','malformed_source_field'],
  ['conversation',['comments',0,'body'],hidden,'/comments/0/body','malformed_source_field'],
  ['conversation',['comments',0,'plain_body'],hidden,'/comments/0/plain_body','malformed_source_field'],
  ['conversation',['comments',0,'author_id'],hidden,'/comments/0/author_id','malformed_source_field'],
  ['conversation',['comments',0,'public'],hidden,'/comments/0/public','malformed_source_field'],
  ['conversation',['comments',0,'metadata'],privateEmail,'/comments/0/metadata','opaque_source_field'],
  ['conversation',['comments',0,'attachments'],[hidden],'/comments/0/attachments/0/customer','unsupported_source_field'],
  ['conversation',['comments'],[null],'/comments/0','malformed_source_field'],
  ['conversation',['via','channel'],hidden,'/via/channel','malformed_source_field'],
  ['conversation',['via','source'],hidden,'/via/source','opaque_source_field'],
  ['conversation',['via','extra'],hidden,'/via/extra','unsupported_source_field'],
  ['conversation',['attachments'],hidden,'/attachments','opaque_source_field'],
  ['macro',['actions',0,'extra'],hidden,'/actions/0/extra','unsupported_source_field'],
  ['macro',['actions',0,'value'],hidden,'/actions/0/value','malformed_source_field'],
  ['macro',['actions'],[null],'/actions/0','malformed_source_field'],
  ['macro',['actions'],[{field:'comment_value',value:'Hello'},{field:'custom_customer',value:privateEmail}],'/actions/1/value','opaque_source_field'],
  ['macro',['actions'],[{field:'comment_value',value:'Hello'},{field:'comment_mode_is_public',value:privateEmail}],'/actions/1/value','malformed_source_field'],
  ['macro',['restriction'],hidden,'/restriction','opaque_source_field'],
  ['article',['translated_content'],hidden,'/translated_content','opaque_source_field'],
  ['article',['translated_content'],[],'/translated_content','opaque_source_field'],
  ['article',['user_segment_ids'],[hidden],'/user_segment_ids/0','malformed_source_field'],
  ['article',['draft'],hidden,'/draft','malformed_source_field'],
  ['article',['ai_agent_availability'],privateEmail,'/ai_agent_availability','opaque_source_field']
 ]
};
export function changed(vendor,kind,path,value){const input=documents(vendor),record=input[kind],payload=vendor==='zendesk'?Object.values(record)[0]:record;let parent=payload;for(const key of path.slice(0,-1))parent=parent[key];parent[path.at(-1)]=structuredClone(value);return {record,records:kind==='conversation'?[input.person,record]:[record]}}
