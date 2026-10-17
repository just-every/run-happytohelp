/** Coalesce concurrent routing in one Worker into workspace turns. The D1 revision
 * guard still arbitrates between Workers; a lost cross-Worker commit is deferred
 * by the durable event rather than spun on inside this turn. */
const turns=new Map<string,Promise<void>>()
export async function inRoutingTurn<T>(projectId:string,run:()=>Promise<T>):Promise<T>{
 const previous=turns.get(projectId)??Promise.resolve()
 let release!:()=>void
 const done=new Promise<void>(resolve=>{release=resolve}),tail=previous.then(()=>done)
 turns.set(projectId,tail)
 await previous
 try{return await run()}finally{release();if(turns.get(projectId)===tail)turns.delete(projectId)}
}
