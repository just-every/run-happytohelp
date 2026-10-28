import type { Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
export type LocalEnv = { DB: D1Database; FILES: R2Bucket };
export type Principal = { userId: string; projectId: string };
export type Mode = 'investigate' | 'resolve' | 'resolve_reply';
export type DraftInput = { projectId: string; conversationId: string; operatorId: string; jobId: string;
  proposalId: string | null; expectedRevision: number; expectedLastMessageId: string | null; guard?: {sql:string;args:unknown[]} };
export interface Integration {
  authorize(c: Context<any>, projectId: string): Promise<Principal>;
  /** Pairing a computer or approving its authorization installs a credential: the edition may demand more (a recent step-up). */
  authorizeInstall?(c: Context<any>, projectId: string, action: string): Promise<Principal>;
  hasAccess(db: D1Database, userId: string, projectId: string): Promise<boolean>;
  context(db: D1Database, projectId: string, conversationId: string): Promise<Record<string, any>>;
  recordResult(env:LocalEnv, job:Record<string,any>,result:Record<string,any>):Promise<void>;
  deliveryRevision(env:LocalEnv,projectId:string,conversationId:string):Promise<number>;
  prepareDraft(env: LocalEnv, input: DraftInput): Promise<{ body: string; attachments: Record<string, unknown>[] }>;
  deliver(env: LocalEnv, input: { projectId: string; conversationId: string; operatorId: string; requestId: string; expectedRevision:number; expectedLastMessageId: string | null; body: string; attachmentIds: string[]; resolve: boolean; source?: {jobId:string;proposalId:string|null} }): Promise<{ messageId: string }>;
}
export type App = Hono<any>;
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
export async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join(''); }
export function requireValue(value: unknown, message: string, status = 422): asserts value { if (!value) throw new HTTPException(status as 400, {message}); }
export function text(value: unknown, limit=8000): string { requireValue(typeof value === 'string' && value.trim() && value.length <= limit, 'Invalid text'); return value as string; }
export function mode(value: unknown): Mode { requireValue(['investigate','resolve','resolve_reply'].includes(value as string),'Invalid authority mode'); return value as Mode; }
export function present(row: any) { if (!row) return row; const {token_hash, code_hash, ...safe}=row; for(const key of ['capabilities','context','result','working_directories']) if(typeof safe[key]==='string') safe[key]=JSON.parse(safe[key]); return safe; }
