import {openaiStream,openaiToolCall,formatName} from '../openai-stream.mjs'

/** Model provider protocol fixture for the emitted Worker: suggestion cards citing the customer's message. */
export default async request=>{
 if(new URL(request.url).hostname!=='api.openai.com')return new Response('Unexpected outbound request',{status:599})
 const body=await request.json(),evidence=JSON.stringify(body).match(/message:[0-9a-f-]{36}/)?.[0]
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
 const card=(button,response)=>({button,icon:'circle-question-mark',response,use_when:'',evidence_ids:evidence?[evidence]:[]})
 if(formatName(body)==='agent_suggestion_alternatives')return openaiStream({alternatives:[card('Refund timing','Refunds arrive within five days.')],missing_information:[]})
 if(formatName(body)==='agent_suggestion_primary')return openaiStream({user_goal:'Cancel an order',responses:[card('Cancel order','Open Orders and choose Cancel.')],missing_information:[]})
 return openaiStream('Thanks for your message.')
}
