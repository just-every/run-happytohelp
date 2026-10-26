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
            if (typeof issue.input !== 'string') {
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

// Zod 3 bounded strings in UTF-16 units. Keep that public limit and leave
// later checks running, including refinements that add another issue.
export const stringMax = (schema, maximum) => schema.superRefine((value, context) => {
    if (value.length > maximum) context.addIssue({ code: 'too_big', origin: 'string', maximum, inclusive: true });
}).meta({ ...schema.meta(), maxLength: maximum });

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

// Provider errors persist serialized issues, including their property order.
// Resolve the leaf schema so literals and enums (both invalid_value in Zod 4)
// retain their distinct public issue contracts.
const schemaAt = (schema, path) => {
    for (const key of path) {
        while (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) schema = schema.unwrap();
        schema = schema instanceof z.ZodObject ? schema.shape[key]
            : schema instanceof z.ZodArray ? schema.element : undefined;
    }
    while (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) schema = schema.unwrap();
    return schema;
};
export function validationMessage(error, schema) {
    if (!error?.issues) return error?.message;
    // Zod 4 can run an array length check on a wrong-type string. Zod 3
    // aborts that node at invalid_type, so its serialized list stops there.
    const issues = error.issues.filter(issue => !(['too_small', 'too_big'].includes(issue.code)
        && error.issues.some(other => other.code === 'invalid_type'
            && JSON.stringify(other.path) === JSON.stringify(issue.path))));
    return JSON.stringify(issues.map(issue => {
        const { input, ...publicIssue } = issue;
        const leaf = schemaAt(schema, issue.path);
        switch (issue.code) {
            // Refinements already carry the author's property order. In
            // particular, an explicit path may precede the message.
            case 'custom': {
                const number = leaf?.meta()?.type;
                if (number === 'integer' || number === 'number') {
                    if (typeof input !== 'number' || Number.isNaN(input)) return {
                        code: 'invalid_type', expected: 'number', received: typeOf(input), path: issue.path, message: issue.message,
                    };
                    if (number === 'integer' && !Number.isInteger(input)) return {
                        code: 'invalid_type', expected: 'integer', received: 'float', message: issue.message, path: issue.path,
                    };
                }
                // String .refine(message) has no author-supplied path; Zod 4
                // inserts its inherited path before the message instead.
                if (leaf instanceof z.ZodString && leaf._zod.def.checks?.some(check => check._zod.def.type === 'custom')) return { code: issue.code, message: issue.message, path: issue.path };
                return publicIssue;
            }
            case 'invalid_type': return {
                code: issue.code, expected: issue.expected, received: typeOf(input), path: issue.path, message: issue.message,
            };
            case 'too_small':
            case 'too_big': return {
                code: issue.code,
                ...(issue.code === 'too_small' ? { minimum: issue.minimum } : { maximum: issue.maximum }),
                type: issue.origin, inclusive: issue.inclusive, exact: issue.exact ?? false,
                message: issue.message, path: issue.path,
            };
            case 'invalid_value':
                if (leaf instanceof z.ZodLiteral) return {
                    received: input, code: 'invalid_literal', expected: issue.values[0], path: issue.path, message: issue.message,
                };
                if (typeof input !== 'string') return {
                    expected: choices(issue.values), received: typeOf(input), code: 'invalid_type', path: issue.path, message: issue.message,
                };
                return {
                    received: input, code: 'invalid_enum_value', options: issue.values, path: issue.path, message: issue.message,
                };
            case 'unrecognized_keys': return {
                code: issue.code, keys: issue.keys, path: issue.path, message: issue.message,
            };
            case 'invalid_format': return {
                validation: issue.format, code: 'invalid_string', message: issue.message, path: issue.path,
            };
        }
        return publicIssue;
    }), null, 2);
}
export { z };
