
import { z, stringMax, lengthBounds } from '../../validation/zod.js';
import { evidenceIdsAreEligible, evidenceIdsAreNew } from './context.js';

const text = z.string().trim();
const optionalText = stringMax(text, 360).nullable();
const evidenceIds = lengthBounds(z.array(lengthBounds(text, { min: 1 })), { min: 1, max: 4 });

const helpTypesFrom = (availableAis) => [...new Set((availableAis || [])
    .map((ai) => (typeof ai?.get === 'function' ? ai.get('type') : ai?.type))
    .filter((type) => typeof type === 'string' && type.trim()))];

const monitoringAnalysisSchema = ({ packet, helpTypes }) => {
    const validHelpTypes = [...new Set(helpTypes || packet?.available_help_types || [])];
    const helpType = validHelpTypes.length > 0 ? z.enum(validHelpTypes) : z.never();

    return z.object({
        decision: z.enum(['no_insight', 'insight']).describe('Use no_insight for ordinary, ambiguous, or already-covered activity. Use insight only for a concrete, attributable help offer.'),
        help_type: helpType.nullable().describe('For insight, choose one value from available_help_types. For no_insight, return null.'),
        evidence_ids: lengthBounds(z.array(lengthBounds(text, { min: 1 })), { max: 4 }).describe('For insight, cite one to four eligible_evidence_ids. For no_insight, return an empty array.'),
        help: optionalText.describe('For insight, describe the concrete help offered. For no_insight, return null.'),
    }).strict().superRefine((result, context) => {
        if (result.decision === 'no_insight') {
            if (result.help_type !== null || result.evidence_ids.length !== 0 || result.help !== null) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'A no_insight decision cannot claim a help type or evidence.',
                });
            }
            return;
        }

        if (!result.help_type || !validHelpTypes.includes(result.help_type)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'An insight must select an available help type.',
                path: ['help_type'],
            });
        }
        if (!evidenceIds.safeParse(result.evidence_ids).success || !evidenceIdsAreEligible(result.evidence_ids, packet)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'An insight must cite one to four eligible observations.',
                path: ['evidence_ids'],
            });
        }
        if (!result.help) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'An insight decision must name the concrete help it offers.',
                path: ['help'],
            });
        }
    });
};

const monitoringInsightSchema = ({ packet, analysis }) => z.object({
    content: stringMax(lengthBounds(text, { min: 1 }), 360),
    buttons: lengthBounds(z.array(z.object({
        text: stringMax(lengthBounds(text, { min: 1 }), 90),
        action: z.enum(['send', 'close']),
    }).strict()), { min: 1, max: 3 }),
    loading: optionalText,
    evidence_ids: evidenceIds,
}).strict().superRefine((result, context) => {
    const sendCount = result.buttons.filter((button) => button.action === 'send').length;
    const closeCount = result.buttons.filter((button) => button.action === 'close').length;
    if (sendCount > 2 || closeCount !== 1) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'An insight needs one close button and at most two send buttons.',
            path: ['buttons'],
        });
    }

    if (!evidenceIdsAreEligible(result.evidence_ids, packet)
        || !evidenceIdsAreNew(result.evidence_ids, packet)
        || !result.evidence_ids.every((id) => analysis?.evidence_ids?.includes(id))) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'An insight must cite new evidence selected by the analysis.',
            path: ['evidence_ids'],
        });
    }
});

const toLegacyCollectorAnalysis = (result, availableAis) => {
    const helpTypes = helpTypesFrom(availableAis);
    const analysis = {
        decision: result.decision,
        already_covered: result.decision === 'no_insight',
        evidence_ids: result.evidence_ids,
        help_type: result.help_type,
        help: result.help,
    };

    helpTypes.forEach((type) => {
        analysis[type] = {
            relevant: result.decision === 'insight' && result.help_type === type,
            insight: result.decision === 'insight' && result.help_type === type ? result.help : null,
            wait_for_more: result.decision !== 'insight' || result.help_type !== type,
            can_continue: result.decision !== 'insight' || result.help_type !== type,
        };
    });

    return analysis;
};

export {
    helpTypesFrom,
    monitoringAnalysisSchema,
    monitoringInsightSchema,
    toLegacyCollectorAnalysis,
};
