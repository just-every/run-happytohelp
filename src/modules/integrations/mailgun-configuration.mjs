/** Native secret binding names only; never accept the separate Mailgun Routes key. */
export function mailgunConfiguration(env) {
 const keyName=env.EMAIL_API_KEY_NAME??'MAILGUN_SENDING_KEY'
 if(keyName!=='MAILGUN_SENDING_KEY')throw new Error('EMAIL_API_KEY_NAME must select MAILGUN_SENDING_KEY for Mailgun')
 const key=env.MAILGUN_SENDING_KEY
 if(typeof key!=='string'||!key.trim()||/[^\x21-\x7e]/.test(key))throw new Error('MAILGUN_SENDING_KEY is unavailable')
 const domain=env.MAILGUN_DOMAIN
 if(typeof domain!=='string'||! /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain))throw new Error('Mailgun requires a valid MAILGUN_DOMAIN')
 const region=env.MAILGUN_REGION===undefined?'us':env.MAILGUN_REGION
 if(region!=='us'&&region!=='eu')throw new Error('MAILGUN_REGION must be us or eu')
 return {key,domain:domain.toLowerCase(),origin:region==='eu'?'https://api.eu.mailgun.net':'https://api.mailgun.net'}
}
