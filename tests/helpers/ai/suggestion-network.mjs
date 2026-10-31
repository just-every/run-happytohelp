import {openaiStream,formatName,openaiToolCall} from '../openai-stream.mjs'

/** Model provider protocol fixture for the emitted Worker: suggestion cards citing the customer's message. */
export default async request=>{
 if(new URL(request.url).hostname!=='api.openai.com')return new Response('Unexpected outbound request',{status:599})
 const body=await request.json(),evidence=JSON.stringify(body).match(/message:[0-9a-f-]{36}/)?.[0]
 // Synthetic reply evaluations have a scoped packet without a live ticket.
 // Keep their default provider response separate from production retrieval.
 const textParts=(body.input||[]).flatMap(item=>typeof item.content==='string'?[item.content]:Array.isArray(item.content)?item.content.map(part=>part.text).filter(text=>typeof text==='string'):[])
 const packetText=textParts.find(text=>text.startsWith('Scoped customer-reply context:\n'))
 const packet=packetText?JSON.parse(packetText.slice(packetText.indexOf('\n')+1)):null
 if(packet?.schema==='happytohelp.customer-reply-context.v1'&&!packet.conversation)return openaiStream('Thanks for your message.')
 if(JSON.stringify(body).includes('trace-browser')&&body.tools?.some(t=>t.name==='search_knowledge')){
  const calls=body.input.filter(item=>item.type==='function_call')
  if(!calls.some(item=>item.name==='search_knowledge'))return openaiToolCall('search_knowledge',{query:'refund'},'trace-search')
  if(!calls.some(item=>item.name==='cite_knowledge')){
   const output=body.input.find(item=>item.type==='function_call_output'&&item.call_id==='call-trace-search')?.output||'[]'
   const rows=JSON.parse(output.slice(output.indexOf('[')))
   return openaiToolCall('cite_knowledge',{sources:rows.slice(0,1).map(r=>({id:r.id,sourceVersion:r.sourceVersion}))},'trace-cite')
  }
  return openaiStream('Refund advice: a human can review your request.')
 }
 if(JSON.stringify(body).includes('Isolated synthetic procedure simulation')){
  if(JSON.stringify(body).includes('synthetic-hh-provider-error'))return new Response(JSON.stringify({error:{message:'Synthetic provider unavailable',type:'server_error'}}),{status:503,headers:{'content-type':'application/json'}})
  if(JSON.stringify(body).includes('synthetic-hh-no-read'))return openaiStream('Please ask a human to review this refund.')
 if(!body.input?.some(x=>x.type==='function_call_output'))return openaiToolCall('search_knowledge',{query:'refund'});return openaiStream(JSON.stringify(body).includes('synthetic-hh-failing')?'refund issued':'Please ask a human to review this refund.')}
 const card=(button,response)=>({button,icon:'circle-question-mark',response,use_when:'',evidence_ids:evidence?[evidence]:[]})
 if(formatName(body)==='agent_suggestion_alternatives')return openaiStream({alternatives:[card('Refund timing','Refunds arrive within five days.')],missing_information:[]})
 if(formatName(body)==='agent_suggestion_primary')return openaiStream({user_goal:'Cancel an order',responses:[card('Cancel order','Open Orders and choose Cancel.')],missing_information:[]})
 return openaiStream('Thanks for your message.')
}
