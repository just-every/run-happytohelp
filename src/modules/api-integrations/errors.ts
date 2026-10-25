import {HTTPException} from 'hono/http-exception'
import type {ContentfulStatusCode} from 'hono/utils/http-status'
export class ApiError extends HTTPException {
 readonly code:string
 readonly details:Record<string,unknown>
 readonly headers:Record<string,string>
 constructor(status:ContentfulStatusCode,code:string,message=code,details:Record<string,unknown>={},headers:Record<string,string>={}){
  super(status,{message,res:Response.json({error:{code,message,...details}},{status,headers})})
  this.code=code;this.details=details;this.headers=headers
 }
}
