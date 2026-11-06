import { d1NativeLimits } from '../../../d1-transport/limits.mjs';
import type { PlanEntry, TargetRow } from '../types.ts';
import type { D1ImportContext, D1Sql } from './types.ts';

const key = (kind: string, id: string): string => JSON.stringify([kind, id]);
export interface ApplyReads {
  sources: Map<string, any>;
  predecessors: Map<string, any>;
  targets: Map<string, { row: TargetRow | undefined; guards?: D1Sql[] }>;
}
export const targetReadKey = key;

/** Only this publication's candidate entries. No observation survives atomic().
 * Failure discards the entire snapshot, including any earlier successful set. */
export async function applyReads(entries: PlanEntry[], context: D1ImportContext): Promise<ApplyReads | undefined> {
  const { database: db, targets } = context.storage;
  const staged = context.maxBatchBytes !== undefined && !!targets.stagingRead;
  if (staged ? !targets.stagingReadMany : !targets.readMany) return;
  try {
    const sources = new Map<string, any>(), predecessors = new Map<string, any>();
    const identities = [...new Set(entries.map(entry => entry.identity))];
    for (let i = 0; i < identities.length; i += d1NativeLimits.variableNumber) {
      const part = identities.slice(i, i + d1NativeLimits.variableNumber);
      const { results } = await db.prepare(`SELECT * FROM ik_sources WHERE identity IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      for (const row of results) sources.set(row.identity, row);
    }
    const keys = [...new Map(entries.flatMap(entry => entry.effects.map(effect => [key(effect.targetKind, effect.targetId), { kind: effect.targetKind, id: effect.targetId }] as const))).values()];
    const snapshots: { row: TargetRow | undefined; guards?: D1Sql[] }[] = staged
      ? await targets.stagingReadMany!(db, context.destination, keys)
      : (await targets.readMany!(db, context.destination, keys)).map(row => ({ row }));
    if (snapshots.length !== keys.length) throw new Error('IMPORT_NATIVE_STAGING_GUARD_REQUIRED');
    const native = new Map<string, { row: TargetRow | undefined; guards?: D1Sql[] }>();
    for (const [i, selected] of keys.entries()) {
      const snapshot = snapshots[i];
      if (staged && !snapshot.guards?.length) throw new Error('IMPORT_NATIVE_STAGING_GUARD_REQUIRED');
      native.set(key(selected.kind, selected.id), snapshot);
    }
    const size = Math.floor((d1NativeLimits.variableNumber - 1) / 2);
    for (let i = 0; i < keys.length; i += size) {
      const part = keys.slice(i, i + size);
      const { results } = await db.prepare(`SELECT * FROM ik_provenance WHERE destination=? AND (target_kind,target_id) IN (${part.map(() => '(?,?)').join(',')}) AND reversed=0`).bind(context.destination, ...part.flatMap(k => [k.kind, k.id])).all();
      for (const row of results) predecessors.set(key(row.target_kind, row.target_id), row);
    }
    return { sources, predecessors, targets: native };
  } catch {
    return undefined;
  }
}
