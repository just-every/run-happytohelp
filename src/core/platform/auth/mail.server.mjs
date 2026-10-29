import { createMailSender } from "../../../vendor/base/modules/mail/index.mjs"
import { localDevelopmentEnabled } from './local.server.mjs'
import { createBusinessSettings } from "../../../vendor/base/modules/business-settings/index.ts"
import { parseAddress } from "../../../vendor/base/modules/mail/src/core/validation.mjs"

function businessSender(env, sender) {
  return { async send(message) {
    const settings = createBusinessSettings({ db: env.DB, business: { settings: 1, values: ['display_name'] } })
    const name = await settings.resolve('display_name', null)
    if (typeof name === 'string') {
      // Encode punctuation that the mail facade cannot represent in an unquoted
      // display name. This is RFC 2047 header encoding, not a different value.
      const display = /[<>"\\]/.test(name) ? `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(name)))}?=` : name
      message = { ...message, from: `${display} <${parseAddress(message.from).email}>` }
    }
    return sender.send(message)
  } }
}

// Construct only on a send: first-owner setup never depends on mail credentials.
export function operatorMail(env) {
  if (env.RER_DEMO === '1' || localDevelopmentEnabled(env)) {
    return createMailSender({ provider: 'development', mode: 'development' })
  }
  if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined

  return businessSender(env, {
    async send(message) {
      if (!['resend', 'sendgrid', 'cloudflare'].includes(env.MAIL_PROVIDER)) {
        throw new Error('unsupported_mail_provider')
      }
      return createMailSender({
        provider: env.MAIL_PROVIDER,
        mode: 'production',
        apiKey: env.MAIL_API_KEY,
        ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}),
      }).send(message)
    },
  })
}
