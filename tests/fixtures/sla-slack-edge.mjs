// Network edge only. Provider outcomes are deliberately terminal or rate limited.
let sends=0
export default async function(request){
 if(new URL(request.url).hostname!=='hooks.slack.com')throw new Error('Unexpected external request')
 sends++
 if(sends===1)return new Response('invalid_payload',{status:400})
 if(sends===2)throw new TypeError('Synthetic lost Slack response')
 return new Response('rate_limited',{status:429,headers:{'Retry-After':'120'}})
}
