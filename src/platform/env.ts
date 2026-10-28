export interface BaseJob { type: string; id: string; projectId: string; [key: string]: unknown }
/** Reads the workspace's own website once, after creation. Owned by management/site-read. */
export interface SiteReadJob extends BaseJob { type: 'site.read' }
export type Job = BaseJob | SiteReadJob
export interface Env { MAIL_PROVIDER?: string; MAIL_FROM?: string; MAIL_RELAY_URL?: string; MAIL_API_KEY?: string; H2H_RER_MAIL_VERSION?: string; RER_MAILBOX_ID?: string; RER_MAIL_ADDRESS?: string; RER_MAIL_CONTROL_URL?: string; RER_MAIL_INGRESS_KEY?: string; RER_INSTALLATION_ID?: string; H2H_SETUP_TOKEN?: string; H2H_SETUP_OWNER_EMAIL?: string; INBOUND_EMAIL_DOMAIN?: string; ASSETS?: Fetcher; RER_DEPLOY_SOURCE?: string; RER_DEPLOY_FINGERPRINT?: string; RER_VERSION?: { id: string }; DB: D1Database; FILES: R2Bucket; CONVERSATIONS: DurableObjectNamespace; JOBS: Queue<Job>; [key: string]: unknown }
export interface ActorSecurity { factorAt: number|null; factorMethod: 'password'|'email_link'|'totp'|'webauthn'|'recovery'|'installation'|null; hasFactor: boolean; required: boolean; installation: boolean }
export interface Actor { id: string; projectId: string; role: 'owner'|'admin'|'operator'|'contact'; contactId?: string; security?: ActorSecurity }
export type AppEnv = { Bindings: Env; Variables: { actor: Actor; sessionHash: string; roleChecked: boolean } }
