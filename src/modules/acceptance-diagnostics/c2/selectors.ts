import {HTTPException} from 'hono/http-exception'

const scenarios={
 control:{tag:'ctl',sender:'control-a@desk-proof.example',reply:'ctl'},
 'preexisting-overlap':{tag:'pre',sender:'preexisting-b@desk-proof.example',reply:null},
 'new-overlap':{tag:'ovl',sender:'overlap-c@desk-proof.example',reply:null},
 'overlap-reply':{tag:'ctl',sender:'control-a@desk-proof.example',reply:'ovl'},
 'harmless-reply':{tag:'pre',sender:'preexisting-b@desk-proof.example',reply:'harm'},
} as const
export type Scenario=keyof typeof scenarios
const refuse=()=>{throw new HTTPException(400,{message:'Invalid C2 diagnostic selector'})}

export function parameters(url:string,allowed:string[]){
 const params=new URL(url).searchParams
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)refuse()
 return params
}

/** Finite C2 roles, exact IDs and a bounded window; synthetic labels never grant authority. */
export function receiptSelector(url:string){
 const params=parameters(url,['scenario','messageId','conversationId','localId','from','to'])
 const scenario=params.get('scenario') as Scenario
 if(!Object.hasOwn(scenarios,scenario))return refuse()
 const config=scenarios[scenario],messageId=params.get('messageId')||'',conversationId=params.get('conversationId'),localId=params.get('localId')
 if(!new RegExp(`^<${config.tag}\\.[a-f0-9]{12}@desk-proof\\.example>$`).test(messageId))refuse()
 if(conversationId!==null&&!/^[A-Za-z0-9_-]{1,128}$/.test(conversationId))refuse()
 if(localId!==null&&(!config.reply||!new RegExp(`^c2scratch4-${config.reply}-[0-9]{13}$`).test(localId)||!conversationId))refuse()
 if(['overlap-reply','harmless-reply'].includes(scenario)&&(!localId||!conversationId))refuse()
 const fromText=params.get('from')||'',toText=params.get('to')||''
 if(!/^[0-9]{13}$/.test(fromText)||!/^[0-9]{13}$/.test(toText))refuse()
 const from=Number(fromText),to=Number(toText)
 if(from>to||to-from>60*60*1000||to>Date.now()+5*60*1000)refuse()
 return {scenario,messageId,conversationId,localId,from,to,sender:config.sender}
}
