import {startEdge,notFound} from './edge.mjs';
export async function startTeams(){
 const token='synthetic-hh-5',target='11111111-1111-4111-8111-111111111111/19:synthetic-channel@thread.tacv2';
 let sequence=0;
 return startEdge({token,authorization:`Bearer ${token}`,target,route({method,path,json},{issues}){
  if(method!=='POST'||path!==`/v1.0/teams/${target.split('/')[0]}/channels/${encodeURIComponent(target.split('/')[1])}/messages`)return notFound();
  if(json?.body?.contentType!=='text'||typeof json.body.content!=='string')return {status:400};
  const id=String(++sequence),message={id,body:json.body,webUrl:`https://teams.microsoft.com/l/message/${encodeURIComponent(target.split('/')[1])}/${id}`};
  issues.set(id,message);return {status:201,body:message};
 }});
}
