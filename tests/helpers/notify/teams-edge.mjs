import {generateKeyPairSync,randomUUID,sign} from 'node:crypto'
// Only Microsoft's network boundary is simulated. Native auth, routes, storage,
// link redemption and the scheduled consumer remain the real application.
export function teamsEdge(){
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...publicKey.export({format:'jwk'}),kid:'synthetic-hh-teams-key',use:'sig'}
 const calls=[],script=[],tokenScript=[]
 const tenant='synthetic-hh-tenant',appId='synthetic-hh-app',service='https://smba.trafficmanager.net/amer/'
 const outbound=async(request,entry)=>{
  const url=new URL(request.url)
  if(url.hostname==='login.botframework.com')return Response.json({keys:[jwk]})
  if(url.hostname==='login.microsoftonline.com'){
   const next=tokenScript.shift();if(typeof next==='function')await next()
   if(next==='failed')return Response.json({error:'invalid_client'},{status:401})
   return Response.json({access_token:'synthetic-hh-bot-access'})
  }
  if(url.hostname!=='smba.trafficmanager.net')throw Error('Unexpected provider host '+url.hostname)
  calls.push({url:url.href,method:request.method,body:JSON.parse(entry.body),authorization:entry.headers.authorization})
  const next=script.shift()
  if(next==='lost')throw Error('Synthetic lost Teams response')
  if(next==='rate')return Response.json({error:{code:'Throttled'}},{status:429,headers:{'Retry-After':'120'}})
  if(next==='unreadable')return new Response('unreadable')
  if(typeof next==='number')return Response.json({error:{code:'SyntheticRefusal'}},{status:next})
  return Response.json({id:'synthetic-hh-activity-'+calls.length})
 }
 const event=({code,text=`notify link ${code}`,sender='synthetic-hh-member',conversation='synthetic-hh-personal',...extra}={})=>({id:randomUUID(),type:'message',channelId:'msteams',serviceUrl:service,from:{id:sender,aadObjectId:sender},channelData:{tenant:{id:tenant}},conversation:{id:conversation,conversationType:'personal'},text,...extra})
 const signed=(body,overrides={})=>{
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'https://api.botframework.com',aud:appId,exp:now+300,nbf:now-1,serviceurl:body.serviceUrl,...overrides})).toString('base64url'),payload=header+'.'+claims
  return {'Content-Type':'application/json',Authorization:'Bearer '+payload+'.'+sign('RSA-SHA256',Buffer.from(payload),privateKey).toString('base64url')}
 }
 return {jwk,outbound,calls,script,tokenScript,event,signed,tenant,appId,service}
}
