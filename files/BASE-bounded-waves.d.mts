import type { WaveTotals, WaveBinding } from '../../modules/import-kit/src/door/waves/types.ts';
export interface BoundedApproval { id: string; at: string }
export interface BoundedArrangement {
 protocol: 'rer-bounded-waves/1'; migration: string; revision: string; policy: string;
 catchup?: boolean; parentId?: string;
 parentApproval?: BoundedApproval & { fingerprint: string };
 children?: { ordinal: number; fingerprint: string; approval?: BoundedApproval }[];
}
export interface BoundedAggregate {
 protocol: 'rer-bounded-waves/1'; parentId: string; fingerprint: string;
 aggregateSuccess: true; nativeSuccess: boolean; completeHead: string; counts: WaveTotals;
 goneButRetained: { kind: string; sourceId: string }[]; children: number;
}
export interface BoundedPending {
 parentId: string; state: 'awaiting_parent_approval' | 'awaiting_child_approval' | 'partial';
 aggregateSuccess: false; fingerprint?: string; ordinal?: number; children?: unknown[];
}
export function sendBoundedWaves(options: {
 arrangement: BoundedArrangement; uploadId: string; signal: AbortSignal;
 fresh(action: string, extra: { bounded: WaveBinding }): Promise<unknown>;
 request(grant: unknown, body: Record<string, unknown>, signal: AbortSignal): Promise<any>;
 checkpoint?(progress: Record<string, string | number | boolean | undefined>): Promise<void>;
}): Promise<BoundedAggregate | BoundedPending>;
