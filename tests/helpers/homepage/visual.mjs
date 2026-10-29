import assert from 'node:assert/strict'

// Inspect the painted page after its ordinary scroll reveal, without changing motion or application state.
export async function see(page,locator){
 // A moment can fit at the viewport's bottom while remaining below the page's
 // reveal line. Bring it into the reading area before waiting for its paint.
 await locator.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}))
 const handle=await locator.elementHandle()
 try{
  await page.waitForFunction(root=>{
   const painted=node=>{
    if(!node.getBoundingClientRect().width||!node.getBoundingClientRect().height)return false
    for(let ancestor=node;ancestor;ancestor=ancestor.parentElement){
     const style=getComputedStyle(ancestor)
     if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return false
    }
    return true
   }
   return [root,...root.querySelectorAll('.d-card,.d-window,.proof-icon,.step,.import-status,.import-counts,.d-blob')].every(painted)
    &&[...root.querySelectorAll('.d-sparks path,.ready-line path,.divider-line--wide path')].every(path=>parseFloat(getComputedStyle(path).strokeDashoffset)===0)
    &&root.getAnimations({subtree:true}).every(animation=>animation.playState==='finished')
  },handle)
 }finally{await handle.dispose()}
}

export async function appearance(locator,pseudo=null){
 return locator.evaluate((node,pseudo)=>{
  const style=getComputedStyle(node,pseudo),box=node.getBoundingClientRect()
  return {x:box.x,y:box.y,right:box.right,bottom:box.bottom,width:pseudo?parseFloat(style.width):box.width,height:pseudo?parseFloat(style.height):box.height,
   color:style.color,background:style.backgroundColor,image:style.backgroundImage,backgroundSize:style.backgroundSize,radius:style.borderTopLeftRadius,
   borders:['Top','Right','Bottom','Left'].map(side=>({width:parseFloat(style[`border${side}Width`]),color:style[`border${side}Color`]})),
   stroke:style.stroke,strokeWidth:parseFloat(style.strokeWidth),fill:style.fill,dashOffset:style.strokeDashoffset,fontSize:parseFloat(style.fontSize),
   content:style.content,counterIncrement:style.counterIncrement,counterReset:style.counterReset}
 },pseudo)
}

const channels=value=>{
 const match=value.match(/^rgba?\(([^)]+)\)$/)
 assert.ok(match,`a painted RGB colour was expected, received ${value}`)
 return match[1].split(/[\s,\/]+/).map(Number)
}

export function aqua(value,label,pale=false){
 const [red,green,blue,alpha=1]=channels(value)
 assert.ok(alpha>0&&red<green&&red<blue&&green>130&&blue>130&&Math.abs(green-blue)<45&&(!pale||red>160),`${label} is ${pale?'pale ':''}aqua (${value})`)
}

export function ink(value,label){
 const [red,green,blue,alpha=1]=channels(value)
 assert.ok(alpha>0&&Math.max(red,green,blue)<80&&Math.max(red,green,blue)-Math.min(red,green,blue)<20,`${label} is near-black ink (${value})`)
}

export async function inkCard(locator,label){
 const card=await appearance(locator)
 assert.ok(card.width>0&&card.height>0,`${label} has a visible card`)
 for(const border of card.borders){assert.ok(border.width>0,`${label} has a drawn outline`);ink(border.color,`${label} outline`)}
 ink(card.color,`${label} text`)
 return card
}

export async function disc(locator,label,{pseudo=null,pale=false}={}){
 const circle=await appearance(locator,pseudo)
 assert.ok(circle.width>0&&Math.abs(circle.width-circle.height)<1,`${label} is circular`)
 assert.ok(circle.radius.endsWith('%')?parseFloat(circle.radius)>=50:parseFloat(circle.radius)>=circle.width/2,`${label} has round edges`)
 aqua(circle.background,`${label} fill`,pale)
 ink(circle.color,`${label} ink`)
 return circle
}

export async function lineIcon(locator,label){
 const icon=await appearance(locator)
 assert.ok(icon.width>0&&icon.height>0&&icon.strokeWidth>0,`${label} is a visible line icon`)
 ink(icon.stroke,`${label} stroke`)
 assert.equal(icon.fill,'none',`${label} remains linework`)
 assert.ok(await locator.locator('path,circle,rect,line,polyline').count(),`${label} has drawn strokes`)
}
