const used = { state: 'used', label: 'Used by AI answers' };
const notUsed = { state: 'not_used', label: 'Not used by AI answers' };
const scoped = { state: 'recipient_scoped', label: 'Limited to permitted customers' };
const unknown = { state: 'unknown', label: 'AI use not confirmed' };

// Article publication and AI retrieval are separate facts. The API may report
// retrieval eligibility only when it observes a real published retrieval link.
export function aiAnswerStatus(source, kind) {
    if (source?.aiEligibility === 'recipient_scoped') return scoped;
    if (source?.aiEligibility === 'used') return used;
    if (source?.aiEligibility === 'unknown') return unknown;
    if (source?.aiEligibility === 'not_used') return notUsed;
    if (kind === 'article') return unknown;

    // A current published dataset version is the actual version searched by
    // searchKnowledge. Published articles have no such implication.
    return kind === 'website' && source?.published_version ? used : notUsed;
}
