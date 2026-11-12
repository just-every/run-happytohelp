import {HTTPException} from 'hono/http-exception'
/** Stable, content-free refusals. Carry the response through the native Hono
 * error handler without changing native authentication/permission responses. */
export class WorkerImportError extends HTTPException {
 constructor(readonly code:string,status=409){super(status as 400,{message:code,res:Response.json({error:code.replaceAll('_',' '),code},{status,headers:{'Cache-Control':'no-store'}})})}
}
export function refuse(code:string,status=409):never{throw new WorkerImportError(code,status)}
