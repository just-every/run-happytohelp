// Zapier Platform app definition. Import this default export from the entry of
// an owner-controlled Zapier Platform project; never embed a workspace token.
const field=(key,label,extra={})=>({key,label,type:'string',required:true,...extra})
function endpoint(bundle,path){
 const origin=new URL(bundle.authData.origin)
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw new Error('Use the HTTPS installation origin without a path')
 return origin.origin+'/api/v1'+path
}
async function request(z,bundle,path,{method='GET',body}={}){
 const response=await z.request({url:endpoint(bundle,path),method,headers:{Authorization:'Bearer '+bundle.authData.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
 response.throwForStatus()
 return response.data
}
const replyFields=[field('conversationId','Conversation ID'),field('localId','Stable reply ID'),field('content','Public reply',{type:'text'}),field('expectedRevision','Current revision',{type:'integer'}),field('expectedLastMessageId','Current last message ID',{required:false})]
export default {
 version:'1.0.0',platformVersion:'17.0.0',
 authentication:{type:'custom',fields:[field('origin','HappyToHelp HTTPS origin'),field('token','Workspace token',{type:'password'})],test:(z,bundle)=>request(z,bundle,'/conversations?limit=1'),connectionLabel:'{{bundle.authData.origin}}'},
 triggers:{updatedConversation:{key:'updatedConversation',noun:'Conversation',display:{label:'Updated Conversation',description:'Poll current conversations with native workspace scope and erasure boundaries.'},operation:{
  inputFields:[],
  async perform(z,bundle){
   let cursor=null;const records=[]
   for(let page=0;page<10;page++){
    const result=await request(z,bundle,'/conversations?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''))
    records.push(...result.data.map(row=>({...row,conversation_id:row.id,id:JSON.stringify([row.id,row.updated_at,row.revision,row.status_id])})))
    cursor=result.next_cursor;if(!cursor)return records
   }
   throw new Error('More than 1000 conversations: use native signed webhooks or narrow the integration; this poll was not complete')
  },sample:{id:'synthetic-happytohelp-1',conversation_id:'synthetic-happytohelp-2',revision:1},outputFields:[{key:'id'},{key:'conversation_id'},{key:'revision',type:'integer'}],
 }}},
 creates:{reply:{key:'reply',noun:'Reply',display:{label:'Reply to Conversation',description:'Send a public reply with an explicit stable identity and current frontier. Requires messages:write.'},operation:{inputFields:replyFields,async perform(z,bundle){
  const {conversationId,...command}=bundle.inputData
  const result=await request(z,bundle,'/conversations/'+encodeURIComponent(conversationId)+'/messages',{method:'POST',body:command})
  return {...result.data,duplicate:result.duplicate}
 },sample:{id:'synthetic-happytohelp-3',content:'We are investigating.'},outputFields:[{key:'id'},{key:'content'},{key:'duplicate',type:'boolean'}]}}},
 searches:{conversation:{key:'conversation',noun:'Conversation',display:{label:'Find Conversation',description:'Read the current conversation and reply frontier.'},operation:{inputFields:[field('id','Conversation ID')],async perform(z,bundle){const result=await request(z,bundle,'/conversations/'+encodeURIComponent(bundle.inputData.id));return [result.data]},sample:{id:'synthetic-happytohelp-2',revision:1},outputFields:[{key:'id'},{key:'revision',type:'integer'},{key:'last_message_id'}]}}},
}
