import {request} from './http'
import {providerError,record,text,type Connection} from './types'

// Use a configured Graph channel rather than trusting an event's service URL.
// Plain text prevents selected customer content from becoming mentions or HTML.
export function teamsTarget(value:string){
 const parts=value.split('/')
 if(parts.length!==2||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(parts[0])||!/^19:[A-Za-z0-9_.-]+@thread\.tacv2$/.test(parts[1]))throw providerError()
 return parts
}
export async function postTeams(connection:Connection,input:{body:string}){
 if(connection.provider!=='teams'||!input.body.trim()||input.body.length>28000)throw providerError()
 const [team,channel]=teamsTarget(connection.target)
 const data=record(await request(connection,`/v1.0/teams/${encodeURIComponent(team)}/channels/${encodeURIComponent(channel)}/messages`,{body:{contentType:'text',content:input.body}}))
 const id=text(data.id)
 if(!/^\d+$/.test(id))throw providerError()
 let url:URL;try{url=new URL(text(data.webUrl))}catch{throw providerError()}
 if(url.protocol!=='https:'||url.hostname!=='teams.microsoft.com'||url.port||url.username||url.password||url.pathname!==`/l/message/${encodeURIComponent(channel)}/${id}`||url.hash)throw providerError()
 return {id,url:url.href}
}
