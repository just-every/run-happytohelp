export async function renderDocument(request:Request,execution:Pick<ExecutionContext,'waitUntil'>){
 const {default:start}=await import('@tanstack/react-start/server-entry')
 const response=start.fetch(request)
 // In Vite dev a client disconnect during Start's first render can strand its module-load promise.
 if(import.meta.env.DEV)execution.waitUntil(Promise.resolve(response).then(()=>{},()=>{}))
 return response
}
