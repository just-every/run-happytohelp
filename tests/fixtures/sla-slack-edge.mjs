// Network edge only. Provider outcomes are deliberately terminal or rate limited.
let sends=0,teams=0
export default async function(request){
 if(new URL(request.url).hostname==='graph.microsoft.com'){
  teams++
  if(teams===1)return Response.json({id:'1'},{status:201})
  if(teams===2)return Response.json({error:{code:'Forbidden'}},{status:403})
  if(teams===3)throw new TypeError('Synthetic lost Teams response')
  return Response.json({error:{code:'TooManyRequests'}},{status:429,headers:{'Retry-After':'120'}})
 }
 if(new URL(request.url).hostname!=='hooks.slack.com')throw new Error('Unexpected external request')
 sends++
 if(sends===1)return new Response('invalid_payload',{status:400})
 if(sends===2)throw new TypeError('Synthetic lost Slack response')
 return new Response('rate_limited',{status:429,headers:{'Retry-After':'120'}})
}
