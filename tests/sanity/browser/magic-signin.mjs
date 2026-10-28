import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'

// Deliver the fixture mailbox token to the same owner who next enrolls a factor.
export async function magicSignIn({page,runtime,origin,projectId,userId,email}) {
 await page.goto(origin+'/login');await page.getByRole('link',{name:'Email me a sign-in link'}).click()
 await page.getByLabel('Email',{exact:true}).fill('unknown@example.test')
 const requested=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click();assert.equal((await requested).status(),202)
 await page.getByRole('status').waitFor()
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
 await runtime.execute(`INSERT INTO magic_signins VALUES('${hash}','${userId}','${projectId}','${email}',${Date.now()+60000},NULL)`)
 const link=origin+'/login/magic#token='+token,context=page.context()
 assert.equal((await context.request.get(link)).status(),200)
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'scanner GET creates no session')
 let consumes=0;const count=request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/identity/magic-link/consume')consumes++}
 page.on('request',count)
 await page.goto(link);await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();await page.waitForFunction(()=>location.hash==='')
 assert.equal(consumes,0)
 await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>url.pathname===`/projects/${projectId}/activation`)
 assert.equal(consumes,1);page.off('request',count)
 assert.equal((await (await context.request.get(origin+'/api/identity/session')).json()).id,userId)
 const replay=await context.request.post(origin+'/api/identity/magic-link/consume',{headers:{Origin:origin},data:{token}})
 assert.ok([400,401,410].includes(replay.status()),'used mailbox proof cannot be redeemed again')
}
