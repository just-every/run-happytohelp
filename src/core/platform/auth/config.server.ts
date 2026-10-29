import type { AuthConfig } from "../../../vendor/base/modules/operator-auth/index.mjs"
import type { Bindings } from '../bindings.server'
import { theme } from '../../app/theme'

function list(value: string | undefined): string[] | undefined {
  return value === undefined ? undefined : value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function authConfig(env: Bindings): AuthConfig {
  return {
    origin: env.AUTH_ORIGIN,
    OWNER_EMAIL: env.OWNER_EMAIL,
    SESSION_SECRET: env.SESSION_SECRET,
    INSTALLATION_KEY: env.INSTALLATION_KEY,
    INSTALLATION_KEY_PREVIOUS: env.INSTALLATION_KEY_PREVIOUS,
    SETUP_TOKEN: env.SETUP_TOKEN,
    MAIL_FROM: env.MAIL_FROM,
    local: env.AUTH_LOCAL === 'true',
    branding: { productName: theme.productName, theme: theme.href },
    allowList: list(env.AUTH_ALLOW_LIST),
    ipLimit: env.AUTH_IP_LIMIT === undefined ? undefined : Number(env.AUTH_IP_LIMIT),
    emailLimit: env.AUTH_EMAIL_LIMIT === undefined ? undefined : Number(env.AUTH_EMAIL_LIMIT),
    review: env.AUTH_REVIEW_ENABLED === 'true'
      ? { enabled: true, operatorEmail: env.AUTH_REVIEW_EMAIL ?? env.OWNER_EMAIL }
      : undefined,
    dependencies: true,
    OIDC_TRANSACTION_SECRET: env.OIDC_TRANSACTION_SECRET,
  }
}
