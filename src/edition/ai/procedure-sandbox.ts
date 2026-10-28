// This capability deliberately receives no environment, database, files or fetch.
// The only available data is a fixed synthetic publication. The two tool names
// mirror existing retrieval tools, without granting access to their live stores.
export function procedureSandbox(names:string[],scenario:string){
 const receipts:any[]=[]
 const status=scenario==='denied'?'denied':scenario==='timeout'?'timeout':'ok'
 const tools=names.map(name=>({allowSummary:false,definition:{type:'function',function:{name,description:'Read synthetic sandbox knowledge only. Permission and timeout faults are isolated scenario inputs.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}}},function:async(query:string)=>{
  const receipt={tool:name,status,query:String(query).slice(0,500),records:status==='ok'?[{id:'synthetic-hh-1',sourceVersion:'synthetic-hh-1',content:'Synthetic refund policy: ask a human to approve refunds.'}]:[]}
  receipts.push(receipt);return receipt
 }}))
 return {tools,receipts,status}
}
