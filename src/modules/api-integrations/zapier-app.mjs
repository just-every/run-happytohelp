// Unpublished Zapier app definition. Every template targets the native API;
// installation supplies baseUrl and bearer auth privately, never in a URL.
export const zapierApp={
 version:'1.0.0',authentication:{type:'custom',test:{method:'GET',path:'/api/v1/zapier/sample?event=conversation.created'}},
 triggers:{support_event:{subscribe:{method:'POST',path:'/api/v1/zapier/hooks',body:['event','url']},unsubscribe:{method:'DELETE',path:'/api/v1/zapier/hooks/{id}'},sample:{method:'GET',path:'/api/v1/zapier/sample?event={event}'}}},
 actions:{
  find_contact:{method:'GET',path:'/api/v1/contacts?email={email}'},
  create_contact:{method:'POST',path:'/api/v1/contacts',body:['name','email','external_id']},
  reply:{method:'POST',path:'/api/v1/conversations/{id}/messages',body:['localId','content','expectedRevision']},
  resolve:{method:'POST',path:'/api/v1/conversations/{id}/resolve',body:[]},
  draft_article:{method:'POST',path:'/api/v1/articles',body:['title','content','slug'],defaults:{status:'draft'}}
 }
}
export function requestTemplate(template,input){
 const path=template.path.replace(/\{(\w+)\}/g,(_,key)=>encodeURIComponent(input[key]))
 return {path,method:template.method,...(template.body?{headers:{'Content-Type':'application/json'},body:JSON.stringify({...template.defaults,...Object.fromEntries(template.body.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]))})}:{})}
}
