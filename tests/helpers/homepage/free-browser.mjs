import assert from 'node:assert/strict'
import {appearance,aqua,disc,inkCard,lineIcon,see} from './visual.mjs'

export async function freeProductPromise({page,section}){
 await see(page,section.getByRole('heading',{name:'Not just better. Free.',exact:true}))
 const statement=await section.locator('.split-copy > p').innerText()
 assert.match(statement,/100% free and open source/i,'the product is free and open source')
 assert.match(statement,/free as in code[\s,]+and free as in cost/i,'both the code and its use are free')
 assert.match(statement,/MIT licensed/i,'the free-product statement names its MIT licence')

 const drawing=section.getByRole('img',{name:/drawing of the MIT licen[cs]e/i})
 await see(page,drawing)
 const editor=drawing.locator('.licence-editor'),card=drawing.locator('.licence-card')
 await inkCard(editor,'code editor')
 await inkCard(card,'MIT licence')
 assert.equal((await editor.innerText()).trim(),'','the code editor is wordless')
 const code=await editor.locator('.code-line').evaluateAll(rows=>rows.map(row=>({
  number:!!row.querySelector('.code-number'),runs:[...row.querySelectorAll('.code-run')].map(run=>{
   const box=run.getBoundingClientRect(),style=getComputedStyle(run)
   return {width:box.width,height:box.height,background:style.backgroundColor,opacity:Number(style.opacity)}
  })
 })))
 assert.ok(code.length>1&&code.every(row=>row.number&&row.runs.length>1&&row.runs.every(run=>run.width>0&&run.height>0&&run.opacity>0&&!/rgba\([^)]*,\s*0\)$/.test(run.background))),'wordless line-number stubs and code runs remain visibly drawn')
 assert.equal(await card.locator('.licence-title').innerText(),'MIT License')
 const charge=card.getByText('free of charge',{exact:true}),rights=card.locator('.licence-grant')
 assert.match(await rights.innerText(),/use, copy, modify, merge, publish, distribute/,'the licence displays the granted rights')
 for(const [highlight,label] of [[charge,'free of charge'],[rights,'licence rights']]){
  const paint=await appearance(highlight),colours=paint.image.match(/rgba?\([^)]+\)/g)||[]
  assert.ok(colours.length&&parseFloat(paint.backgroundSize)>0,`${label} has a painted highlight`)
  for(const colour of colours)aqua(colour,`${label} highlight`)
 }
 const overlap=await drawing.evaluate(root=>{
  const editor=root.querySelector('.licence-editor').getBoundingClientRect(),card=root.querySelector('.licence-card'),box=card.getBoundingClientRect()
  const left=Math.max(editor.left,box.left),right=Math.min(editor.right,box.right),top=Math.max(editor.top,box.top),bottom=Math.min(editor.bottom,box.bottom)
  return {overlaps:right>left&&bottom>top,offset:box.left>editor.left&&box.top>editor.top,
   onTop:card.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2))}
 })
 assert.ok(overlap.overlaps&&overlap.offset&&overlap.onTop,'the ink MIT licence card sits over the code editor')

 const promises=section.locator('.proof')
 await see(page,promises)
 for(const promise of ['No seats.','No plans.','No fees.']){
  const item=promises.getByRole('listitem').filter({hasText:promise})
  assert.equal(await item.innerText(),promise)
  const circle=await disc(item.locator('.proof-icon'),promise,{pale:true})
  await lineIcon(item.locator('svg'),promise)
  const textStart=await item.evaluate(node=>{
   const text=[...node.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim())
   const range=document.createRange();range.selectNode(text);return range.getBoundingClientRect().left
  })
  assert.ok(circle.right<=textStart,'each promise follows its aqua icon circle')
 }
}
