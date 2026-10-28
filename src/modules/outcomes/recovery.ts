import {HTTPException} from 'hono/http-exception'

export function customerRecovery(value:unknown):'unknown'|'recovered'|'not_recovered'{
 if(value===undefined||value==='')return 'unknown'
 if(value==='unknown'||value==='recovered'||value==='not_recovered')return value
 throw new HTTPException(400,{message:'Choose whether your issue is resolved'})
}
