import { z } from 'zod';

export { z };
export declare const boundedNumber: (minimum: number, maximum: number, kind?: 'integer' | 'finite') => z.ZodType<number>;
export declare function validationMessage(error: unknown): string | undefined;
