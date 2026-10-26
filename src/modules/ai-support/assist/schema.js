

import { z } from '../../validation/zod.js';
import { replyIconNames } from '../llm/schemas/reply-icons.js';

const responseSchema = z.object({
    button: z.string().trim().min(1).max(80).describe('A short, specific heading, up to four words. Conditional completed-action alternatives must start with the verified prerequisite, such as “After cancelling” or “After refund completion”.'),
    icon: z.string().refine(name => replyIconNames.has(name), 'Use a canonical Lucide icon name.')
        .describe('Canonical Lucide name. Use find_reply_icons if needed.'),
    response: z.string().trim().min(1).describe('The complete customer-facing reply, ready for human review and sending.'),
    use_when: z.string().trim().max(280).describe('Private operator-only prerequisite. Leave empty for a grounded current-state reply. A conditional completed-action draft requires a specific operator-verifiable prerequisite, never a vague phrase such as “if appropriate”.'),
    evidence_ids: z.array(z.string()).describe('IDs of evidence actually supplied or retrieved that support this reply. These are private and never part of the reply text.'),
});

const suggestionsSchema = () => z.object({
    user_goal: z.string().describe('The customer’s current goal, for the operator only.'),
    responses: z.array(responseSchema).min(1).max(4).describe('Best reply first. Add alternatives only for distinct, useful approaches supported by the same facts. One reply is sufficient.'),
    missing_information: z.array(z.string()).describe('Material unknowns the operator should resolve. Empty when none. Do not guess the answers.'),
}).superRefine((value, context) => {
    if (value.responses[0]?.use_when !== '') {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['responses', 0, 'use_when'],
            message: 'The grounded primary reply must have an empty use_when.',
        });
    }
});

const primarySuggestionSchema = () => z.object({
    user_goal: z.string().describe('The customer’s current goal, for the operator only.'),
    responses: z.array(responseSchema.extend({
        use_when: z.literal(''),
        evidence_ids: z.array(z.string()).min(1),
    })).length(1).describe('Exactly one evidence-grounded primary reply.'),
    missing_information: z.array(z.string()).describe('Material unknowns the operator should resolve. Empty when none.'),
});

const alternativesSuggestionsSchema = () => z.object({
    alternatives: z.array(responseSchema).max(3).describe('Zero to three additional useful alternatives. The application has already retained the primary reply, so never repeat it here or add warm/short paraphrases.'),
    missing_information: z.array(z.string()).describe('Material unknowns the operator should resolve. Empty when none.'),
});

export {
    alternativesSuggestionsSchema,
    primarySuggestionSchema,
    responseSchema,
    suggestionsSchema,
};
