import {HTTPException} from 'hono/http-exception'

/** Native HTTP refusal, also loadable by the disk CLI's TypeScript strip loader. */
export class AdoptionError extends HTTPException {
 readonly code:string
 constructor(code:string,status=409){
  super(status as 400,{message:code,res:Response.json({error:code.replaceAll('_',' '),code},{status,headers:{'Cache-Control':'no-store'}})})
  this.code=code
 }
}
export function refuse(code:string,status=409):never{throw new AdoptionError(code,status)}
