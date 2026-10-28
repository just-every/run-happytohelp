import { z } from 'zod';

export { z };
export declare const stringMax: <T extends z.ZodString>(schema: T, maximum: number) => T;
export declare const lengthBounds: <T extends z.ZodString | z.ZodArray>(schema: T, bounds: { min?: number; max?: number; length?: number }) => T;
export declare const boundedNumber: (minimum: number, maximum: number, kind?: 'integer' | 'finite') => z.ZodType<number>;
export declare function validationMessage(error: unknown, schema?: z.ZodType): string | undefined;
