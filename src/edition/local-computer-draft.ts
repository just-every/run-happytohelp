import {ticketScopeSql} from '../modules/access/ticket-scope';
import { requireValue, type DraftInput, type LocalEnv } from '../modules/local-computer/contracts';
import { copyLocalAttachments, type LocalAttachment } from './local-computer-media';

export async function prepareLocalDraft(env: LocalEnv, input: DraftInput) {
    const { projectId, conversationId, operatorId, jobId, proposalId, expectedRevision, expectedLastMessageId } = input;
    // The caller selects a stored proposal, never file ids or storage keys. Keep
    // every authority predicate in the final INSERT too: R2 awaits can race revocation.
    const sql = `SELECT j.* FROM local_jobs j
        JOIN local_devices d ON d.id=j.device_id AND d.user_id=j.operator_id
        JOIN conversations c ON c.id=j.conversation_id AND c.project_id=j.project_id
        JOIN memberships m ON m.project_id=j.project_id AND m.user_id=j.operator_id
        WHERE j.id=? AND j.project_id=? AND j.conversation_id=? AND j.operator_id=?
        AND j.status='completed' AND j.cancel_requested=0 AND d.revoked_at IS NULL
        AND (d.project_id IS NULL OR d.project_id=j.project_id)
        AND (d.grant_id IS NULL OR EXISTS(SELECT 1 FROM local_grants g WHERE g.id=d.grant_id
            AND g.user_id=j.operator_id AND (g.project_id IS NULL OR g.project_id=j.project_id) AND g.revoked_at IS NULL))
        AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=j.project_id
            AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)
        AND ${ticketScopeSql('j.operator_id','c','c.group_id',false)} AND c.revision=? AND c.last_message_id IS ?`;
    const args = [jobId, projectId, conversationId, operatorId, expectedRevision, expectedLastMessageId];
    const job = await env.DB.prepare(sql).bind(...args).first<any>();
    requireValue(job, 'Draft unavailable or conversation changed; review again', 409);
    const result = JSON.parse(job.result);
    const proposal = proposalId === null ? (job.mode !== 'resolve_reply' && result.reply_draft
        ? { body: result.reply_draft, attachment_ids: result.attachment_ids } : null)
        : result.replies?.find((reply: any) => reply.id === proposalId);
    requireValue(proposal, 'Reply proposal not found', 404);
    const receiptGuard = `NOT EXISTS(SELECT 1 FROM local_receipts r WHERE r.job_id=j.id AND r.proposal_id=?
        AND r.kind='reply' AND r.status IN ('sending','sent','uncertain'))`;
    const guard = { sql: sql + ' AND j.result=? AND ' + receiptGuard, args: [...args, job.result, proposalId ?? 'legacy'] };
    requireValue(await env.DB.prepare(guard.sql).bind(...guard.args).first(), 'Reply delivery already started', 409);
    const attachmentIds = proposal.attachment_ids || [];
    requireValue(Array.isArray(attachmentIds) && attachmentIds.length <= 10, 'Invalid draft attachments', 409);
    const attachments: LocalAttachment[] = [];
    for (const attachmentId of new Set(attachmentIds)) {
        const attachment = await env.DB.prepare(`SELECT a.* FROM local_attachments a JOIN local_jobs source ON source.id=a.job_id
            WHERE a.id=? AND a.device_id=? AND source.device_id=? AND source.project_id=? AND source.conversation_id=?
            AND source.operator_id=? AND (a.job_id=? OR EXISTS(SELECT 1 FROM local_attachment_grants g
                WHERE g.attachment_id=a.id AND g.job_id=? AND g.device_id=?))`)
            .bind(attachmentId, job.device_id, job.device_id, projectId, conversationId, operatorId, job.id, job.id, job.device_id)
            .first<LocalAttachment>();
        requireValue(attachment, 'Attachment does not belong to this result', 409);
        attachments.push(attachment);
        // A removed grant/upload during the copy cannot become an owned file.
        guard.sql += ` AND EXISTS(SELECT 1 FROM local_attachments a WHERE a.id=? AND a.job_id=? AND a.device_id=?
            AND a.storage_key=? AND a.size=? AND (a.job_id=j.id OR EXISTS(SELECT 1 FROM local_attachment_grants g
                WHERE g.attachment_id=a.id AND g.job_id=j.id AND g.device_id=j.device_id)))`;
        guard.args.push(attachment.id, (attachment as any).job_id, job.device_id, attachment.storage_key, attachment.size);
    }
    const media = await copyLocalAttachments(env, { projectId, conversationId, operatorId,
        requestId: 'draft:' + jobId + ':' + operatorId }, attachments, guard);
    return { body: proposal.body, attachments: media, authoring: {kind:'local',jobId,proposalId} };
}
