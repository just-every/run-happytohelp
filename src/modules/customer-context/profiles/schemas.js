import { z, boundedNumber, lengthBounds } from '../../validation/zod.js';

const string = z.string().nullable();
const array = z.array(z.string()).nullable();
const percent = boundedNumber(0,100,'integer').nullable();
const evidenceIds = lengthBounds(z.array(lengthBounds(z.string(), { min: 1 })), { max: 12 });
const profileClaim = (value) => z.object({
    value,
    confidence: percent,
    evidence_ids: evidenceIds.describe('Current packet evidence IDs that support this claim.'),
    evidence_status: z.enum(['supported', 'unknown', 'contradicted']).describe('supported uses current evidence; unknown leaves an uncertain field unset; contradicted retracts an old field with current evidence.'),
}).superRefine((claim, ctx) => {
    const supported = claim.evidence_status === 'supported';
    const contradicted = claim.evidence_status === 'contradicted';
    if (supported && (claim.value === null || claim.confidence === null || claim.evidence_ids.length === 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Supported claims require value, confidence, and evidence IDs.' });
    }
    if (!supported && (claim.value !== null || claim.confidence !== null)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unknown or contradicted claims require null value and confidence.' });
    }
    if (contradicted && claim.evidence_ids.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Contradicted claims require evidence IDs.' });
    }
});


export const projectSchema = () => z.object({
    describe: profileClaim(string.describe('Briefly describe the main products or services this project provides.')),
    short_name: profileClaim(string.describe('Provide a short name that people commonly use for this project.')),
    legal_name: profileClaim(string.describe('Specify the full legal name only when directly present in current evidence.')),
    primary_pages: profileClaim(array.describe('List up to four important URLs explicitly present in current evidence.')),
    type: profileClaim(z.enum(['saas', 'ecommerce', 'news', 'blog', 'education', 'gaming', 'marketplace', 'non_profit', 'portfolio', 'forum', 'social', 'finance', 'healthcare', 'real_estate', 'other']).nullable()),
    business_model: profileClaim(z.enum(['B2C', 'B2B', 'B2B2C', 'D2C', 'B2G', 'non_profit', 'marketplace', 'hybrid', 'other']).nullable()),
    possible_users: profileClaim(z.array(z.enum(['visitor', 'subscriber', 'registered_user', 'customer_client', 'buyer', 'seller', 'content_creator', 'moderator', 'trial_user', 'student', 'teacher', 'administrator', 'support_seeker', 'developer', 'advertiser', 'partner', 'member', 'event_attendee', 'other'])).nullable()),
    brand_personality: profileClaim(string.describe('Describe company tone only from current evidence or trusted configuration.')),
});

export const projectContentOptimizeSchema = () => z.object({
    pages: lengthBounds(z.array(z.object({
        url: lengthBounds(z.string(), { min: 1 }).describe('Page URL'),
        text: lengthBounds(z.string(), { min: 1 }).describe('Exact original text from the cited approved knowledge document'),
        selector: lengthBounds(z.string(), { min: 1 }).describe('CSS selector of that text'),
        evidence_id: lengthBounds(z.string(), { min: 1 }).describe('ID of the approved knowledge document containing the exact text'),
    })), { max: 10 }).describe('Pick only safe, high-value page content. Avoid legal, security, contractual, pricing, and factual-commitment text.'),
});

export const optimizeContentSchema = () => z.object({
    pages: lengthBounds(z.array(z.object({
        url: lengthBounds(z.string(), { min: 1 }).describe('Page URL'),
        text: lengthBounds(z.string(), { min: 1 }).describe('Optimized text'),
        selector: lengthBounds(z.string(), { min: 1 }).describe('CSS selector of that text'),
        content_id: lengthBounds(z.string(), { min: 1 }).describe('ID of the approved site-content item being rewritten'),
        evidence_ids: lengthBounds(z.array(lengthBounds(z.string(), { min: 1 })), { max: 2 }).describe('Optional broad personalization signal IDs used for this rewrite; never cite private records.'),
    })), { max: 10 }),
});

export const agentSchema = () => z.object({
    personality: profileClaim(string.describe('Describe repeated patterns in how this agent writes.')),
    common_greetings: profileClaim(string.describe('Describe repeated greetings. Use {contact_name} instead of a real customer name.')),
    common_sign_off: profileClaim(string.describe('Describe repeated sign-offs without inventing a name.')),
    uniqueness: profileClaim(string.describe('Describe repeated writing quirks or preferences only.')),
});

export const contactSchema = (context) => {
    const project = context.project;
    const defaults = ['visitor', 'buyer', 'subscriber', 'researcher', 'student', 'developer', 'support_seeker', 'administrator', 'partner', 'client_customer', 'influencer', 'other'];
    // Native persisted profiles are ordinary JSON, while imported evaluators may use the original model method.
    const configured = typeof project?.ai_profile === 'function'
        ? project.ai_profile('possible_users', defaults)
        : project?.ai_profile?.possible_users?.value;
    const userTypes = configured ?? defaults;
    if (!Array.isArray(userTypes) || !userTypes.length || !userTypes.every(value => typeof value === 'string' && value)) throw new Error('Invalid configured profile user types');
    return z.object({
        upcoming_events: profileClaim(array.describe('List events only when directly stated in current evidence; do not infer from location, calendar, or personal data.')),
        user_type: profileClaim(z.enum(userTypes).nullable()),
        problem: profileClaim(string.describe('Briefly describe a directly observed support or purchase problem.')),
        solutions_needed: profileClaim(string.describe('Describe directly observed sought outcomes.')),
        job: profileClaim(string.describe('Describe a profession only when explicitly stated.')),
        role: profileClaim(string.describe('Describe decision role only when explicitly stated.')),
        risk_profile: profileClaim(z.enum(['risk_averse', 'cautious', 'balanced', 'opportunistic', 'high_risk', 'unspecified']).nullable()),
        personality: profileClaim(z.enum(['concise', 'informative', 'conversational', 'creative', 'analytical', 'empathetic', 'decisive', 'explorative', 'collaborative']).nullable()),
    });
};

export const summarySchema = () => z.object({
    summary: z.string().describe("Downstream use: this summary replaces raw user activity in later prompts. Keep within the provided word limit and prioritize the user's goal, key actions, and any blockers. Be concise and grounded in observed data."),
});
