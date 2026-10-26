import { z } from 'zod';

const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array'
    : typeof value === 'number' && Number.isNaN(value) ? 'nan' : typeof value;
const choices = values => values.map(value => typeof value === 'string' ? `'${value}'` : String(value)).join(' | ');

// These messages are part of the public campaign and provider-error contracts.
// Keep schema-specific refinement messages ahead of this shared default map.
z.config({ customError: issue => {
    switch (issue.code) {
        case 'invalid_type':
            return issue.input === undefined ? 'Required' : `Expected ${issue.expected}, received ${typeOf(issue.input)}`;
        case 'invalid_value':
            if (issue.inst instanceof z.ZodLiteral) return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
            if (typeof issue.input !== 'string' && typeof issue.input !== 'number') {
                return issue.input === undefined ? 'Required' : `Expected ${choices(issue.values)}, received ${typeOf(issue.input)}`;
            }
            return `Invalid enum value. Expected ${choices(issue.values)}, received '${issue.input}'`;
        case 'invalid_union':
            return issue.options ? `Invalid discriminator value. Expected ${choices(issue.options)}` : 'Invalid input';
        case 'unrecognized_keys':
            return `Unrecognized key(s) in object: ${issue.keys.map(key => `'${key}'`).join(', ')}`;
        case 'invalid_format':
            return issue.format === 'regex' ? 'Invalid' : `Invalid ${issue.format}`;
        case 'too_small':
        case 'too_big': {
            const small = issue.code === 'too_small', bound = small ? issue.minimum : issue.maximum;
            if (issue.origin === 'number') return `Number must be ${issue.exact ? 'exactly equal to' : small ? (issue.inclusive ? 'greater than or equal to' : 'greater than') : (issue.inclusive ? 'less than or equal to' : 'less than')} ${bound}`;
            if (issue.origin === 'string' || issue.origin === 'array') {
                const string = issue.origin === 'string';
                const relation = issue.exact ? 'exactly' : issue.inclusive ? (small ? 'at least' : 'at most') : small ? (string ? 'over' : 'more than') : (string ? 'under' : 'less than');
                return `${string ? 'String' : 'Array'} must contain ${relation} ${bound} ${string ? 'character(s)' : 'element(s)'}`;
            }
            break;
        }
    }
} });

// JSON numeric literals can overflow to infinity. Validate the number type
// first, then report every configured check in its original order. Zod 4's
// number/int primitives abort on infinity/fractions and add a safe-integer limit.
// The explicit metadata preserves the same bounds in provider JSON schemas.
export const boundedNumber = (minimum, maximum, kind) => z.custom(
    value => typeof value === 'number' && !Number.isNaN(value),
    { error: issue => issue.code === 'custom' ? (issue.input === undefined ? 'Required' : `Expected number, received ${typeOf(issue.input)}`) : undefined },
).superRefine((value, context) => {
    if (kind === 'integer' && !Number.isInteger(value)) context.addIssue({ code: 'custom', message: 'Expected integer, received float' });
    if (kind === 'finite' && !Number.isFinite(value)) context.addIssue({ code: 'custom', message: 'Number must be finite' });
    if (value < minimum) context.addIssue({ code: 'too_small', origin: 'number', minimum, inclusive: true });
    if (value > maximum) context.addIssue({ code: 'too_big', origin: 'number', maximum, inclusive: true });
}).meta({ type: kind === 'integer' ? 'integer' : 'number', minimum, maximum });

// Provider errors include a serialized issue list in training results. Preserve
// the existing field order and received type where those details are public.
export function validationMessage(error) {
    if (!error?.issues) return error?.message;
    return JSON.stringify(error.issues.map(issue => {
        const { input, ...publicIssue } = issue;
        if (issue.code === 'custom') return { code: issue.code, message: issue.message, path: issue.path };
        if (issue.code === 'invalid_type') return {
            code: issue.code, expected: issue.expected, received: typeOf(input), path: issue.path, message: issue.message,
        };
        return publicIssue;
    }), null, 2);
}
export { z };
