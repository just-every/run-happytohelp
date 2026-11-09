export type TransportFailure = Error & { transport: true; cause: unknown };
export function transportFailure(cause: unknown): TransportFailure;
export function isBusy(error: unknown): boolean;
export function busyWait(error: { retryAfter?: number } | unknown): number;
export function transportFetch(input: RequestInfo | URL, init?: RequestInit, ended?: () => void): Promise<Response>;
