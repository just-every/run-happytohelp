import assert from 'node:assert/strict'

// Exercise the owner’s actual mailto and clipboard doors, including a refused clipboard.
export async function developerHandoffFlow(page, block) {
 const details=block.locator('details').first();
 assert.equal(await details.getAttribute('open'),null,'technical instructions start collapsed');
 const link=block.getByRole('link',{name:'Send these steps to my developer',exact:true});
 const message=new URL(await link.getAttribute('href')).searchParams.get('body');
 assert.ok(message?.trim(),'developer email contains instructions');
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await block.getByRole('button',{name:'Copy steps',exact:true}).click();
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),message,'copy includes the same full instructions as the email');
 const handle=await page.evaluateHandle(()=>navigator.clipboard.writeText);
 await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Clipboard denied')}});
 try {
  await block.getByRole('button',{name:'Copy steps',exact:true}).click();
  assert.notEqual(await details.getAttribute('open'),null,'copy refusal opens the selectable steps');
  assert.ok((await details.innerText()).trim(),'manual copying remains available');
 } finally {
  await page.evaluate(original=>{navigator.clipboard.writeText=original},handle);
  await handle.dispose();
 }
}
