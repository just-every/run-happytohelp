import type {Env} from '../../../platform/env'
import type {HeaderEntry} from '../email-classification'
import {parseAuthenticationResults} from '../authentication-results'
import {authenticationVerdict,type SenderVerdict} from '../inbound-sender'
import type {MailboxProvider} from './types'

/** These messages must come directly from our authenticated provider API/TLS
 * inbox, preserving header order. Only the first receiving Authentication-Results
 * stamp is eligible; lower sender-supplied copies never rescue a failed stamp.
 * RFC 8601 section 7 describes this receiving-domain trust boundary:
 * https://www.rfc-editor.org/rfc/rfc8601.html#section-7
 * Microsoft's documented Exchange inbound stamp omits an authserv-id:
 * https://learn.microsoft.com/en-us/defender-office-365/message-headers-eop-mdo#authentication-results-message-header
 * Google describes checking its original delivered authentication results:
 * https://support.google.com/mail/answer/180707
 */
export function mailboxAuthentication(env:Env,provider:MailboxProvider,headers:Iterable<HeaderEntry>,from:string|null,envelopeFrom:string):SenderVerdict{
 const all=[...headers]
 if(provider==='gmail')return authenticationVerdict(all,from,envelopeFrom,'mx.google.com')
 if(provider==='imap'){
  // This is an installation-controlled receiving server identity, never a value
  // supplied in an inbound message or in the mailbox connection request.
  const service=String(env.MAILBOX_IMAP_AUTHSERV||'').trim().toLowerCase()
  return service?authenticationVerdict(all,from,envelopeFrom,service):{verified:false,failed:false}
 }
 if(provider!=='microsoft')return {verified:false,failed:false}
 const top=all.find(h=>typeof h?.key==='string'&&h.key.trim().toLowerCase()==='authentication-results')
 if(!top||!from)return {verified:false,failed:false}
 let value=String(top.value).trim()
 // This normalization is restricted to MIME retrieved with the Graph access
 // token. The same unprefixed header from a gateway/forwarder is not trusted.
 if(/^(?:spf|dkim|dmarc)\s*=/i.test(value))value='mx.microsoft.com; '+value
 // Exchange's documented action field is unqualified. Give it its policy
 // namespace before using the strict RFC parser; unknown values remain invalid.
 value=value.replace(/\baction=(none|permerror|temperror|oreject|pct\.quarantine|pct\.reject)(?=\s|;|$)/gi,'policy.action=$1')
 const parsed=parseAuthenticationResults(value)
 if(!parsed||!(/^(?:mx\.microsoft\.com|[a-z0-9.-]+\.protection\.outlook\.com)$/i.test(parsed.authserv)))return {verified:false,failed:true}
 const dmarc=parsed.results.filter(r=>r.method==='dmarc'),spf=parsed.results.filter(r=>r.method==='spf'),compauth=parsed.results.filter(r=>r.method==='compauth')
 const domain=from.split('@')[1]?.toLowerCase(),failed=parsed.results.some(r=>['spf','dkim','dmarc','compauth'].includes(r.method)&&r.result==='fail')
 if(dmarc.length!==1||spf.length>1||compauth.length>1||failed)return {verified:false,failed:true}
 const result=dmarc[0],aligned=result.properties['header.from']?.toLowerCase().replace(/\.$/,'')===domain
 return {verified:result.result==='pass'&&aligned,failed:!aligned||result.result!=='pass'}
}
