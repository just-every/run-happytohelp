import {z,boundedNumber,stringMax} from '../../validation/zod.js'
const short=stringMax(z.string().trim().min(1),120)
const attribute=z.object({key:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),value:stringMax(z.string(),200)}).strict()
export const campaignSchema=z.object({
 name:short,enabled:z.boolean(),sender:short,brand:short,message:stringMax(z.string().trim().min(1),1000),
 pathPrefix:stringMax(z.string(),500).refine(value=>value.startsWith('/')&&!value.startsWith('//')&&!/[?#\r\n]/.test(value),'Use a URL path without a query or fragment'),
 trigger:z.discriminatedUnion('type',[
  z.object({type:z.literal('page')}).strict(),z.object({type:z.literal('time'),seconds:boundedNumber(1,86400,'integer')}).strict(),
  z.object({type:z.literal('scroll'),percent:boundedNumber(1,100,'integer')}).strict(),z.object({type:z.literal('exit')}).strict(),
  z.object({type:z.literal('attribute'),...attribute.shape}).strict(),z.object({type:z.literal('returning')}).strict(),
  z.object({type:z.literal('cart'),minimum:boundedNumber(0,1000000000,'finite')}).strict()]),
 audience:z.enum(['all','new','returning']),delaySeconds:boundedNumber(0,86400,'integer'),dailyCap:boundedNumber(1,10,'integer'),
 timezone:stringMax(z.string(),100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'Use an IANA timezone'),
 quietHours:z.object({enabled:z.boolean(),start:boundedNumber(0,23,'integer'),end:boundedNumber(0,23,'integer')}).strict(),
}).strict()
export type Campaign=z.infer<typeof campaignSchema>
export function campaignClock(config:Campaign,now:number){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now)
 const part=(name:string)=>parts.find(p=>p.type===name)!.value
 const hour=Number(part('hour')),q=config.quietHours
 return {day:`${part('year')}-${part('month')}-${part('day')}`,quiet:q.enabled&&(q.start===q.end|| (q.start<q.end?hour>=q.start&&hour<q.end:hour>=q.start||hour<q.end))}
}
export const contextSchema=z.object({path:stringMax(z.string(),500).regex(/^\/(?!\/)[^?#\r\n]*$/),elapsedSeconds:boundedNumber(0,86400,'finite'),scrollPercent:boundedNumber(0,100,'finite'),exitIntent:z.boolean(),cartValue:boundedNumber(0,1000000000,'finite').optional(),visitId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,'Invalid uuid')}).strict()
export function matchesCampaign(config:Campaign,context:z.infer<typeof contextSchema>,returning:boolean,metadata:Record<string,unknown>){
 if(!context.path.startsWith(config.pathPrefix)||context.elapsedSeconds<config.delaySeconds)return false
 if(config.audience==='new'&&returning||config.audience==='returning'&&!returning)return false
 const t=config.trigger
 switch(t.type){
  case 'page':return true
  case 'time':return context.elapsedSeconds>=t.seconds
  case 'scroll':return context.scrollPercent>=t.percent
  case 'exit':return context.exitIntent
  case 'attribute':return ['string','number','boolean'].includes(typeof metadata[t.key])&&String(metadata[t.key])===t.value
  case 'returning':return returning
  case 'cart':return context.cartValue!==undefined&&context.cartValue>=t.minimum
 }
}
