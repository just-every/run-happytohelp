export type InitialWorkspaceOutcome = {result: any} | {
    error: {status?: number; message: string; data?: any; transport?: true};
};
export interface InitialWorkspaceReads {expire(): void}
export function installInitialWorkspaceReads(entries: Record<string, InitialWorkspaceOutcome | Promise<InitialWorkspaceOutcome>>, location: {
    pathname: string; searchStr: string;
}, sessionVersion: number): InitialWorkspaceReads;
export function expireInitialWorkspaceReads(): void;
export function takeInitialWorkspaceRead(path: string, init?: RequestInit): Promise<InitialWorkspaceOutcome | undefined>;
