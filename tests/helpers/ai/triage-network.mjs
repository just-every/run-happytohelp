import {openaiStream,formatName} from '../openai-stream.mjs'
import suggestions from './suggestion-network.mjs'
// Paid model boundary only. Product admission, classification, validation and routing are real.
export default async request=>{
 if(new URL(request.url).hostname!=='api.openai.com')return new Response('Unexpected outbound provider',{status:599})
 const body=await request.clone().json()
 if(formatName(body)!=='ticket_triage')return suggestions(request)
 const user=body.input.filter(item=>item.role==='user').at(-1),text=typeof user?.content==='string'?user.content:user?.content?.map(c=>c.text??'').join('')??''
 const language=/factura|reembolso|envío|error|Cómo/.test(text)?'es':/remboursement|livraison|facture|erreur|Comment/.test(text)?'fr':'en'
 const intent=/refund|reembolso|remboursement/i.test(text)?'refund':/parcel|envío|livraison/i.test(text)?'shipping':/bill|factura|facture/i.test(text)?'billing':/crash|error|erreur/i.test(text)?'bug':'how_to'
 const quote=text.slice(0,Math.min(text.length,120)),confidence=/not sure/.test(text)?.25:.96
 return openaiStream({intent:{value:intent,confidence,quote},sentiment:{value:'negative',confidence:.93,quote},language:{value:language,confidence:.99,quote}})
}
