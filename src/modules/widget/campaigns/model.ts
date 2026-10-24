import {z} from 'zod'
const short=z.string().trim().min(1).max(120)
const attribute=z.object({key:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),value:z.string().max(200)}).strict()
export const campaignSchema=z.object({
 name:short,enabled:z.boolean(),sender:short,brand:short,message:z.string().trim().min(1).max(1000),
 pathPrefix:z.string().max(500).refine(value=>value.startsWith('/')&&!value.startsWith('//')&&!/[?#\r\n]/.test(value),'Use a URL path without a query or fragment'),
 trigger:z.discriminatedUnion('type',[
  z.object({type:z.literal('page')}).strict(),z.object({type:z.literal('time'),seconds:z.number().int().min(1).max(86400)}).strict(),
  z.object({type:z.literal('scroll'),percent:z.number().int().min(1).max(100)}).strict(),z.object({type:z.literal('exit')}).strict(),
  z.object({type:z.literal('attribute'),...attribute.shape}).strict(),z.object({type:z.literal('returning')}).strict(),
  z.object({type:z.literal('cart'),minimum:z.number().finite().min(0).max(1000000000)}).strict()]),
 audience:z.enum(['all','new','returning']),delaySeconds:z.number().int().min(0).max(86400),dailyCap:z.number().int().min(1).max(10),
 timezone:z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'Use an IANA timezone'),
 quietHours:z.object({enabled:z.boolean(),start:z.number().int().min(0).max(23),end:z.number().int().min(0).max(23)}).strict(),
}).strict()
export type Campaign=z.infer<typeof campaignSchema>
export function campaignClock(config:Campaign,now:number){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now)
 const part=(name:string)=>parts.find(p=>p.type===name)!.value
 const hour=Number(part('hour')),q=config.quietHours
 return {day:`${part('year')}-${part('month')}-${part('day')}`,quiet:q.enabled&&(q.start===q.end|| (q.start<q.end?hour>=q.start&&hour<q.end:hour>=q.start||hour<q.end))}
}
export const contextSchema=z.object({path:z.string().max(500).regex(/^\/(?!\/)[^?#\r\n]*$/),elapsedSeconds:z.number().finite().min(0).max(86400),scrollPercent:z.number().finite().min(0).max(100),exitIntent:z.boolean(),cartValue:z.number().finite().min(0).max(1000000000).optional(),visitId:z.string().uuid()}).strict()
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
