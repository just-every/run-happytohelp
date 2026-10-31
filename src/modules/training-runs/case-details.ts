import type { Env } from '../../platform/env';

/** Stored metadata alone cannot establish that an artifact is still retained. */
export async function trainingCaseDetails(env: Env, row: Record<string, any>, rounds: Record<string, any>[] = []) {
    return {
        ...row,
        definition: JSON.parse(String(row.definition)),
        checks: row.checks ? JSON.parse(String(row.checks)) : null,
        usage: row.usage ? JSON.parse(String(row.usage)) : null,
        provider_rounds: rounds.map(round => ({request_id: round.request_id, model: round.model, observed: Boolean(round.observed), usage: round.usage_json ? JSON.parse(String(round.usage_json)) : null})),
        artifact_available: Boolean(row.output_key && await env.FILES.head(row.output_key)),
    };
}
