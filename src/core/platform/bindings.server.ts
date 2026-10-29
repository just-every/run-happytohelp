import { env } from 'cloudflare:workers'

export interface Bindings {
  DB: D1Database
  JOBS: Queue
  /** Built browser files; hosted deploys run the Worker first (staticAssetResponse). */
  ASSETS?: Fetcher
  /** Reference people files; only the people routes require it. */
  FILES?: R2Bucket
  OWNER_EMAIL: string
  SESSION_SECRET: string
  INSTALLATION_KEY?: string
  INSTALLATION_KEY_PREVIOUS?: string
  SETUP_TOKEN?: string
  AUTH_ORIGIN: string
  AUTH_LOCAL?: string
  RER_DEPLOY_SOURCE?: string
  RER_DEPLOY_FINGERPRINT?: string
  RER_VERSION?: { id: string }
  RER_DEV_ORIGIN?: string
  /** Local runtimes only: the checkout's key gate and dev identity switch. Deploy refuses both. */
  RER_MODELS_SERVICE?: string
  RER_MODELS_KEY?: string
  RER_DEV_KEY?: string
  RER_DEV_IDENTITY?: string
  /** Demo runtimes only (`rer demo`): modules/demo's switch and the demo's end. Deploy refuses RER_DEMO. */
  RER_DEMO?: string
  RER_DEMO_EXPIRES?: string
  /** The signed owner claim's issuer, installation and public keys (JSON {kid: JWK}); set by a hosted demo's front or RER Managed. */
  RER_OWNER_CLAIM_ISSUER?: string
  RER_OWNER_CLAIM_INSTALLATION_ID?: string
  RER_OWNER_CLAIM_APP_ORIGIN?: string
  RER_OWNER_CLAIM_PUBLIC_KEYS?: string
  /** Public Business settings verification ring and installation binding. */
  RER_BUSINESS_TRUST?: string
  RER_INSTALLATION_ID?: string
  RER_MANAGEMENT_ORIGIN?: string
  AUTH_ALLOW_LIST?: string
  AUTH_IP_LIMIT?: string
  AUTH_EMAIL_LIMIT?: string
  AUTH_REVIEW_ENABLED?: string
  AUTH_REVIEW_EMAIL?: string
  MAIL_FROM?: string
  MAIL_PROVIDER?: 'resend' | 'sendgrid' | 'cloudflare' | 'development'
  MAIL_API_KEY?: string
  MAIL_ACCOUNT_ID?: string
  /** The linked Auth install's exact HTTPS issuer (the IDENTITY_PROVIDER answer). Empty: email links only. */
  IDENTITY_PROVIDER?: string
  OIDC_TRANSACTION_SECRET?: string
}

export function requestBindings(): Bindings {
  return requireBindings(env as unknown as Bindings)
}

export function requireBindings(bindings: Bindings): Bindings {
  if (bindings.RER_DEV_ORIGIN && bindings.AUTH_LOCAL === 'true') bindings = { ...bindings, AUTH_ORIGIN: bindings.RER_DEV_ORIGIN }
  const missing = [['DB', bindings.DB], ['JOBS', bindings.JOBS]]
    .filter(([, value]) => !value).map(([name]) => name)
  if (missing.length > 0) throw new Error(`Missing Worker bindings: ${missing.join(', ')}`)
  return bindings
}
