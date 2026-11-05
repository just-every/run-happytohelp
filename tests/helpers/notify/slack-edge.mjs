// The Slack network edge only: documented Web API response shapes, played by the
// test. The application's requests, authority checks and outcomes are all real.
// `members` maps a Slack member ID to its Slack team; `script` queues one-shot
// answers for the next message posts: 'lost' (response lost), 'rate' (rate limited).
export function slackEdge({installTeam='T0SYNTH1'}={}){
 const calls=[],script=[],members={}
 const outbound=async(request,entry)=>{
  const url=new URL(request.url)
  if(url.hostname!=='slack.com'||!url.pathname.startsWith('/api/'))throw new Error('Unexpected external request: '+url.hostname)
  const method=url.pathname.slice(5),json=(entry.headers['content-type']||'').includes('json')
  const params=entry.body?json?JSON.parse(entry.body):Object.fromEntries(new URLSearchParams(entry.body)):{}
  calls.push({method,token:(entry.headers.authorization||'').replace('Bearer ',''),params,body:entry.body})
  if(method==='auth.test')return Response.json({ok:true,team_id:installTeam,user_id:'U0SYNTHBOT'})
  if(method==='users.info')return members[params.user]?Response.json({ok:true,user:{id:params.user,team_id:members[params.user],deleted:false,is_bot:false}}):Response.json({ok:false,error:'user_not_found'})
  if(method==='conversations.open')return members[params.users]?Response.json({ok:true,channel:{id:'D'+params.users.slice(1)}}):Response.json({ok:false,error:'user_not_found'})
  if(method==='chat.postMessage'){
   const next=script.shift()
   if(next==='lost')throw new Error('Synthetic lost Slack response')
   if(next==='rate')return Response.json({ok:false,error:'ratelimited'},{status:429,headers:{'Retry-After':'1'}})
   return Response.json({ok:true,channel:params.channel,ts:'1700000000.000100'})
  }
  throw new Error('Unexpected Slack method: '+method)
 }
 const posts=()=>calls.filter(call=>call.method==='chat.postMessage')
 // Personal notices are direct messages. The workspace's own channel posts (the existing
 // connection) and one-time verification codes (read with `lastCode`) are not notices.
 const notices=()=>posts().filter(call=>call.params.channel.startsWith('D')&&!call.params.text.includes('verification code'))
 const lastCode=()=>posts().filter(call=>call.params.text.includes('verification code')).at(-1)?.params.blocks[0].text.text.match(/code is (\d{8})/)?.[1]
 return {outbound,calls,script,members,posts,notices,lastCode,installTeam}
}
