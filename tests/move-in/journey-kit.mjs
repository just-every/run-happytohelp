import assert from 'node:assert/strict'

export const root='/api/move-in/projects/p/imports'
export const json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
export const encode=rows=>rows.map(JSON.stringify).join('\n')
export const state=async(h,run,actor='owner')=>(await h.call(`${root}/${run.id}`,{actor})).data
export const upload=async(h,vendor,body,name='history.jsonl',actor='owner')=>(await h.call(`${root}?vendor=${vendor}`,{method:'POST',actor,headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16','Content-Type':'application/octet-stream'},body})).data
export async function review(h,vendor,body,name,actor){
 const run=await upload(h,vendor,body,name,actor)
 await h.drain()
 const ready=await state(h,run,actor)
 assert.equal(ready.state,'ready',JSON.stringify({state:ready.state,error:ready.error}))
 return ready
}
export async function apply(h,run,actor='owner'){
 await h.call(`${root}/${run.id}/apply`,{...json({fingerprint:run.plan.fingerprint}),actor})
 await h.drain()
 const done=await state(h,run,actor)
 assert.equal(done.state,'completed',JSON.stringify({state:done.state,error:done.error}))
 assert.equal(done.error,null)
 return done
}
export async function undo(h,run,actor='owner'){
 await h.call(`${root}/${run.id}/undo`,{...json({}),actor})
 await h.drain()
 const done=await state(h,run,actor)
 assert.equal(done.state,'undone',JSON.stringify({state:done.state,error:done.error}))
 return done
}
export const rows=async(h,sql,...args)=>(await h.db.prepare(sql).bind(...args).all()).results
