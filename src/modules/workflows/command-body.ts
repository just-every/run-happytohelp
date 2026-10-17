import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
/** Workflow commands take no input. Their body (empty or `{}`) is read before the
 * answer: workerd fails a request stream still unread after its response is sent. */
export async function emptyCommand(c:Context){
 const text=(await c.req.text()).trim()
 if(text&&text!=='{}')throw new HTTPException(400,{message:'This command takes no input'})
}
