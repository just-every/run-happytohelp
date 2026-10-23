import {startEdge, notFound} from './edge.mjs';

// Graph channel-message boundary; no live tenant or credential.
export async function startTeams() {
 const token='synthetic-happytohelp-301',target='00000000-0000-0000-0000-000000000001/19:synthetic@thread.tacv2';
 let sequence=0;
 return startEdge({token,authorization:`Bearer ${token}`,target,route({method,path,json},{issues}){
  if(method!=='POST'||path!==`/v1.0/teams/${encodeURIComponent(target.split('/')[0])}/channels/${encodeURIComponent(target.split('/')[1])}/messages`)return notFound();
  if(json?.body?.contentType!=='text'||typeof json.body.content!=='string')return {status:400};
  const id=String(++sequence),webUrl=`https://teams.microsoft.com/l/message/19:synthetic@thread.tacv2/${id}`;
  issues.set(id,json);return {status:201,body:{id,webUrl}};
 }});
}
