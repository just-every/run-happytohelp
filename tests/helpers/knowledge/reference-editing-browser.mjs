import assert from 'node:assert/strict'

// Steps in the existing reference browser journey: real keystrokes exercise
// controlled textarea selection, while public reads verify saved/sent bytes.
export async function referenceEditing({page,width,p,a,article,body,call,token,screen,ticket,tools}){
 const typed='Your invoices are ready:',closing='Let me know if you need help.'
 const type=async(field,words)=>{await field.fill('');await field.click();await page.keyboard.type(words,{delay:40});if(width===1440)assert.equal(await field.inputValue(),words,'typing beside a link preserves words and the caret')}
 await page.goto(`${new URL(page.url()).origin}/projects/${p}/macros/create`)
 await page.getByLabel('Title',{exact:true}).fill(`Invoice link ${width}`)
 await page.getByRole('button',{name:'Insert article',exact:true}).click();await page.getByLabel('Article',{exact:true}).selectOption(article);await page.getByRole('button',{name:'Insert link',exact:true}).click();await page.getByRole('article',{name:'Knowledge reference'}).waitFor()
 await type(page.locator('.knowledge-reference-editor textarea').first(),typed);await type(page.locator('.knowledge-reference-editor textarea').last(),closing);await screen('typing-saved-reply-link')
 const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/management/projects/${p}/macros`)
 await page.getByRole('button',{name:'Create',exact:true}).click();const stored=await (await created).json();if(width===1440){assert.ok(stored.data.content.startsWith(typed+' '),'saved reply retains the typed words');assert.ok(stored.data.content.endsWith(' '+closing),'saved reply retains text after the link')}
 await page.waitForURL(url=>url.pathname.includes('/macros/')&&!url.pathname.endsWith('/create'))
 await ticket(a);await tools('Help articles');await page.getByRole('button',{name:'Insert link',exact:true}).click();await page.getByRole('article',{name:'Knowledge reference'}).last().waitFor()
 await type(page.locator('.knowledge-reference-editor textarea').first(),typed);await type(page.locator('.knowledge-reference-editor textarea').last(),closing);await screen('typing-composer-link')
 const send=async()=>{const sent=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname===`/api/conversations/${a.conversation.id}/messages`);await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal((await sent).status(),200);await page.waitForFunction(()=>!document.querySelector('.knowledge-reference-editor .knowledge-reference-card'))}
 await send();let delivered=await call(`/api/conversations/${a.conversation.id}/messages`,undefined,a.token)
 if(width===1440)assert.ok(delivered.messages.some(message=>message.content.startsWith(typed+' ')&&message.content.endsWith(' '+closing)),'the customer receives unchanged typed words around the link')
 await page.getByRole('textbox',{name:'Reply to conversation'}).first().fill(body);await page.locator('.knowledge-reference-editor .knowledge-reference-card').waitFor();await page.waitForFunction(()=>!document.querySelector('.knowledge-reference-editor [aria-busy="true"]'));await screen('pasted-copy-punctuation')
 await send();delivered=await call(`/api/conversations/${a.conversation.id}/messages`,undefined,a.token)
 if(width===1440){assert.ok(delivered.messages.some(message=>message.content===body),'a copied article arrives with its original final punctuation');assert.ok(delivered.messages.every(message=>!message.content.includes('\n\n.')),'the full stop never becomes a separate paragraph')}
 await screen('delivered-copy-punctuation')
}
