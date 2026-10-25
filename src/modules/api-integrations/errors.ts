import {HTTPException} from 'hono/http-exception'
import type {ContentfulStatusCode} from 'hono/utils/http-status'
export class ApiError extends HTTPException {
 constructor(status:ContentfulStatusCode,readonly code:string,message=code,readonly details:Record<string,unknown>={},readonly headers:Record<string,string>={}){super(status,{message})}
}
