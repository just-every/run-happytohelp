import assert from 'node:assert/strict'

/** The existing desktop import journey asserts undo once. The phone images are
 * visual proof of these same native screens, without another scenario matrix. */
export async function undoBrowser({page,filename,shot}){
 const request=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/undo'))
 await page.getByRole('button',{name:'Undo whole import',exact:true}).click()
 const {data:started}=await (await request).json(),total=started.report.total
 assert.ok(started.report.checkpoint<=total);assert.equal(started.report.retained,total-started.report.checkpoint)
 const heading=page.getByRole('heading',{name:`Undoing import: ${filename}`,exact:true});await heading.waitFor();await heading.scrollIntoViewIfNeeded()
 const status=heading.locator('../..').getByRole('status').first()
 assert.match(await status.innerText(),new RegExp(`[0-9]+ of ${total} imported changes reversed`));assert.doesNotMatch(await status.innerText(),/source records processed/)
 await page.screenshot({path:shot('undo-progress-1440.png')})
 await page.setViewportSize({width:390,height:900});await heading.scrollIntoViewIfNeeded().catch(()=>{});await page.screenshot({path:shot('undo-progress-390.png')})
 await page.setViewportSize({width:1440,height:1000})
 const done=page.getByRole('heading',{name:`Undone: ${filename}`,exact:true});await done.waitFor({timeout:120000});await done.scrollIntoViewIfNeeded()
 const summary=done.locator('../..'),text=await summary.innerText()
 assert.match(text,new RegExp(`${total} of ${total} imported changes reversed`));assert.match(text,new RegExp(`${total} records removed, 0 prior records restored; 0 imported changes retained`));assert.doesNotMatch(text,/records are imported|will be published/)
 await page.getByText('Original import review',{exact:true}).first().click()
 assert.doesNotMatch(await summary.innerText(),/records are imported|will be published/)
 await page.getByText('Original import review',{exact:true}).first().click()
 await page.screenshot({path:shot('undo-complete-1440.png')})
 await page.setViewportSize({width:390,height:900});await done.scrollIntoViewIfNeeded();await page.screenshot({path:shot('undo-complete-390.png')})
 await page.setViewportSize({width:1440,height:1000})
 return {total,removed:total,restored:0,retained:0}
}
