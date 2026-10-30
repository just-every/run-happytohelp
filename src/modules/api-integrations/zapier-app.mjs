import {createHmac,timingSafeEqual} from 'node:crypto'
// Unpublished Zapier Platform app. Runtime supplies z.request and private authData;
// it uses these native request templates without a second operation implementation.
export const zapierRequests={
 subscribe:{method:'POST',path:'/api/v1/zapier/hooks',body:['event','url']},
 unsubscribe:{method:'DELETE',path:'/api/v1/zapier/hooks/{id}'},
 sample:{method:'GET',path:'/api/v1/zapier/sample?event={event}'},
 find_contact:{method:'GET',path:'/api/v1/contacts?email={email}'},
 create_contact:{method:'POST',path:'/api/v1/contacts',body:['name','email','external_id']},
 reply:{method:'POST',path:'/api/v1/conversations/{id}/messages',body:['localId','content','expectedRevision']},
 resolve:{method:'POST',path:'/api/v1/conversations/{id}/resolve',body:[]},
 draft_article:{method:'POST',path:'/api/v1/articles',body:['title','content','slug'],defaults:{status:'draft'}}
}
export function requestTemplate(template,input){
 const path=template.path.replace(/\{(\w+)\}/g,(_,key)=>encodeURIComponent(input[key]))
 return {path,method:template.method,...(template.body?{headers:{'Content-Type':'application/json'},body:JSON.stringify({...template.defaults,...Object.fromEntries(template.body.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))})}:{})}
}
async function request(z,bundle,template,input=bundle.inputData){
 const origin=new URL(bundle.authData.baseUrl)
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/')throw Error('Choose the HTTPS workspace API origin')
 const {path,...wire}=requestTemplate(template,input),response=await z.request({url:origin.origin+path,...wire,headers:{...wire.headers,Authorization:'Bearer '+bundle.authData.token}})
 response.throwForStatus();return response.data
}
const field=(key,required=true,type='string')=>({key,label:key.replaceAll('_',' '),required,type})
const create=(key,label,fields)=>({key,noun:label,display:{label,description:label+' through the workspace API.'},operation:{inputFields:fields,perform:async(z,bundle)=>{const result=await request(z,bundle,zapierRequests[key]);return result.data}}})
const creates={
 create_contact:create('create_contact','Create contact',[field('name'),field('email'),field('external_id',false)]),
 reply:create('reply','Reply to conversation',[field('id'),field('localId'),field('content'),field('expectedRevision',true,'integer')]),
 resolve:create('resolve','Resolve conversation',[field('id')]),
 draft_article:create('draft_article','Draft article',[field('title'),field('content'),field('slug',false)])
}
export function verifiedZapierEvent(bundle){
 const headers=Object.fromEntries(Object.entries(bundle.rawRequest.headers).map(([key,value])=>[key.toLowerCase(),value])),subscription=bundle.subscribeData
 if(headers['webhook-tenant']!==subscription.project_id||headers['webhook-destination']!==subscription.id||headers['webhook-event']!==subscription.event)throw Error('Webhook binding refused')
 const signed=JSON.stringify(['integrations.webhook.v1',headers['webhook-tenant'],headers['webhook-destination'],headers['webhook-event'],headers['webhook-id'],headers['webhook-timestamp'],bundle.rawRequest.content])
 const expected=Buffer.from('v1='+createHmac('sha256',Buffer.from(subscription.secret,'hex')).update(signed).digest('hex')),supplied=Buffer.from(headers['webhook-signature']??'')
 if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw Error('Webhook signature refused')
 const event=JSON.parse(bundle.rawRequest.content);return [{...event.data,id:event.id,event:event.event,created_at:event.created_at}]
}
export const zapierApp={
 version:'1.0.0',platformVersion:'19.2.1',
 authentication:{type:'custom',fields:[field('baseUrl'),{...field('token'),type:'password'}],test:async(z,bundle)=>{await request(z,bundle,{method:'POST',path:'/api/v1/mcp',body:[],defaults:{jsonrpc:'2.0',id:1,method:'initialize'}});return {authenticated:true}}},
 triggers:{support_event:{key:'support_event',noun:'Support event',display:{label:'Support event',description:'Receive a signed native support event.'},operation:{type:'hook',inputFields:[field('event')],performSubscribe:(z,bundle)=>request(z,bundle,zapierRequests.subscribe,{event:bundle.inputData.event,url:bundle.targetUrl}),performUnsubscribe:(z,bundle)=>request(z,bundle,zapierRequests.unsubscribe,{id:bundle.subscribeData.id}),performList:async(z,bundle)=>(await request(z,bundle,zapierRequests.sample)).data,perform:async(_z,bundle)=>verifiedZapierEvent(bundle)}}},
 creates,
 searches:{find_contact:{key:'find_contact',noun:'Contact',display:{label:'Find contact',description:'Find an exact email in this workspace.'},operation:{inputFields:[field('email')],perform:async(z,bundle)=>(await request(z,bundle,zapierRequests.find_contact)).data}}}
}
export default zapierApp
