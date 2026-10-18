import type {EmailAttachment} from '../email'
export type MailboxProvider='gmail'|'microsoft'|'imap'|'forwarding'
export interface MailboxRow {
 id:string;project_id:string;provider:MailboxProvider;address:string;display_name:string;sender_address:string|null
 status:'connected'|'disconnected'|'reconnect_required'|'needs_backfill'
 credential_cipher:string|null;credential_version:number;cursor_json:string|null
 last_sync_at:number|null;error_code:string|null;connected_by:string
}
export interface OAuthCredential {accessToken:string;refreshToken:string;expiresAt:number}
export interface ImapCredential {
 imapHost:string;smtpHost:string;imapPort?:number;smtpPort?:number;username:string;password:string;smtpUsername?:string;smtpPassword?:string
}
export interface MailboxSendInput {
 projectId:string;mailboxId:string;fromAddress?:string;agentId?:string
 to:string;cc?:readonly string[];bcc?:readonly string[];subject:string;text:string;html?:string
 attachments?:readonly EmailAttachment[];headers?:Readonly<Record<string,string>>;replyTo?:string;idempotencyKey:string
}
export interface MailboxIncoming {
 projectId:string;mailboxId:string;address:string;provider:MailboxProvider;providerMessageId:string;raw:Uint8Array;unavailableReason?:'message_too_large'|'message_unprocessable'
}
/** Must admit idempotently using providerMessageId scoped by mailboxId. A crash
 * between admission and receipt persistence can deliver the same MIME again. */
export type MailboxReceiver=(message:MailboxIncoming)=>Promise<void>
export interface MailboxSyncOptions {backfill?:boolean;actorId?:string}
export interface MailboxAddress {address:string;canSend:boolean;primary?:boolean}
