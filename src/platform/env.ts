export interface BaseJob { type: string; id: string; projectId: string; [key: string]: unknown }
/** Reads the workspace's own website once, after creation. Owned by management/site-read. */
export interface SiteReadJob extends BaseJob { type: 'site.read' }
export type Job = BaseJob | SiteReadJob
export interface Env { RER_INSTALLATION_ID?: string; H2H_SETUP_TOKEN?: string; H2H_SETUP_OWNER_EMAIL?: string; INBOUND_EMAIL_DOMAIN?: string; ASSETS?: Fetcher; RER_DEPLOY_SOURCE?: string; RER_DEPLOY_FINGERPRINT?: string; RER_VERSION?: { id: string }; DB: D1Database; FILES: R2Bucket; CONVERSATIONS: DurableObjectNamespace; JOBS: Queue<Job>; [key: string]: unknown }
export interface ActorSecurity { factorAt: number|null; factorMethod: 'password'|'email_link'|'totp'|'webauthn'|'recovery'|'installation'|'sso'|null; hasFactor: boolean; required: boolean; installation: boolean }
export interface Actor { id: string; projectId: string; role: 'owner'|'admin'|'operator'|'contact'; contactId?: string; security?: ActorSecurity }
export type AppEnv = { Bindings: Env; Variables: { actor: Actor; sessionHash: string; roleChecked: boolean } }
