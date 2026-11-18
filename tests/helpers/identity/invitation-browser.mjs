import assert from 'node:assert/strict'

// Clipboard is the browser edge; all invitations and reissued links come from
// the real Worker. No capability is included in assertion diagnostics or shots.
export async function invitationBrowser({page,origin,project,shot}){
 const base=`/projects/${project}/agents`
 await page.goto(origin+`/projects/${project}/settings`)
 await page.getByRole('link',{name:'Agents',exact:true}).click()
 await page.getByRole('link',{name:'Invite Agent',exact:true}).click()
 await page.getByLabel('Email',{exact:true}).fill('synthetic-hh-invite@example.test')
 const issued=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(`/projects/${project}/agents`))
 await page.getByRole('button',{name:'Invite',exact:true}).click()
 const invitation=(await (await issued).json()).data
 const clean=async url=>{
  const token=new URL(url).searchParams.get('token');assert.ok(token,'real invitation contains a token')
  const exposed=await page.evaluate(token=>{
   const text=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT)
   while(text.nextNode())if(text.currentNode.textContent.includes(token))return true
   return [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live],[title],[aria-label],a[href]')].some(n=>n.textContent.includes(token)||(n.getAttribute('title')||'').includes(token)||(n.getAttribute('aria-label')||'').includes(token)||(n.getAttribute('href')||'').includes(token))||document.title.includes(token)
  },token)
  assert.equal(exposed,false,'capability never appears in a text node or announcement')
 }
 await clean(invitation.invitationUrl)
 const clipboard=async denied=>page.evaluate(denied=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(denied)throw Error('clipboard unavailable');window.syntheticCopiedLink=text}}})},denied)
 await clipboard(false)
 await page.getByRole('button',{name:'Copy invitation link',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.syntheticCopiedLink)===invitation.invitationUrl,true,'clipboard gets the issued link')
 await clean(invitation.invitationUrl)
 await clipboard(true)
 await page.getByRole('button',{name:'Copy invitation link',exact:true}).click()
 await page.getByRole('button',{name:'Show invitation link',exact:true}).click()
 const input=page.getByRole('textbox',{name:'Invitation link to share',exact:true})
 assert.equal(await input.inputValue()===invitation.invitationUrl,true)
 assert.equal(await input.evaluate(n=>Boolean(n.closest('[role="status"],[role="alert"],[aria-live="polite"],[aria-live="assertive"]'))),false)
 await clean(invitation.invitationUrl)
 await page.goto(origin+base)
 const row=page.getByRole('row').filter({hasText:'synthetic-hh-invite@example.test'})
 await clipboard(false)
 const reissued=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/link'))
 await row.getByRole('button',{name:'Copy link',exact:true}).click()
 const next=(await (await reissued).json()).data.invitationUrl
 await clean(next)
 assert.equal(await page.evaluate(()=>window.syntheticCopiedLink)===next,true)
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:shot(`invitation-copied-${width}.png`),fullPage:true})}
 await page.setViewportSize({width:1440,height:900})
 await clipboard(true)
 const fallback=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/link'))
 await row.getByRole('button',{name:'Copy link',exact:true}).click()
 const fallbackUrl=(await (await fallback).json()).data.invitationUrl
 await page.getByRole('button',{name:'Show invitation link',exact:true}).click()
 assert.equal(await input.inputValue()===fallbackUrl,true)
 await clean(fallbackUrl)
}
