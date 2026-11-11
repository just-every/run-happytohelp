export const fields = ['display_name', 'owner_name', 'brand_color', 'logo', 'timezone'] as const;
export type Field = typeof fields[number];
export type Values = Partial<Record<Exclude<Field, 'logo'>, string>>;
export interface BusinessManifest {
  settings: 1;
  values: readonly Field[];
  team?: { roles: { admin: string; member: string } };
}
export interface Trust {
  v: 1; issuer: string; audience: string; subject: string; email?: string;
  keys: Record<string, JsonWebKey>;
}
export type BusinessRole = 'admin' | 'member';
export interface Member { id?: string; email: string; name: string; role: BusinessRole; invite: number }
export interface Logo { sha256: string; type: string; bytes: number }
export interface SettingsDocument {
  v: 1; iss: string; aud: string; sub: string; business: string; email: string;
  jti: string; iat: number; exp: number; rev: number; values: Values;
  logo: Logo | null; team: Member[] | null; owner_id?: string; detached?: true;
}
export interface TeamState { email: string; state: 'invited' | 'active' | 'inactive' | 'conflict' }
export interface ManagedMember extends TeamState {
  operatorId: string | null; invite: number;
  businessId?: string | null; businessRole?: BusinessRole | null;
}
export interface Guard { sql: string; args: unknown[] }
export interface TeamAdapter {
  ownerEmail?(): Promise<string | null>;
  /** One-way forms under which an erasure by an older release of this seed stored a roster address (an opaque
   * placeholder it renamed the `bs_team` row to, for instance). Never the address itself. The module treats a
   * stored row under such a form as the listed person's row, and a tombstone of such a form as theirs, so a
   * signed roster that lists an erased person by address alone is applied as retired, not as a new invitation. */
  retiredForms?(email: string): Promise<string[]>;
  prepare(input: {
    members: Member[]; managed: ManagedMember[]; ownerEmail: string;
    roles: { admin: string; member: string }; guard: Guard;
  }): Promise<{
    statements: Statement[]; rows: ManagedMember[]; afterCommit(): Promise<void>;
    /** `operatorId`s of stored rows whose native identity no longer exists in the seed's own account store (the
     * adapter's own check, in its own id space). Return no row for them: the module retires each person in this
     * apply's batch, so the Business listing them again changes nothing until it sends a larger `invite`. */
    gone?: string[];
  }>;
}
/** `retired` appears only when the revision listed people this installation erased; they were not applied. */
export interface Ack { rev: number; applied: Field[]; overrides: Field[]; logo: string | null; team: TeamState[]; retired?: string[] }
export interface Snapshot {
  document: SettingsDocument | null; rev: number; appliedAt: string | null;
  stopped: boolean; overrides: Field[]; logo: string | null; team: TeamState[];
}
export interface Options {
  db: Database; trust?: string | Trust | null; business: BusinessManifest;
  team?: TeamAdapter;
  /** Optional invitation sender, supplied to a custom adapter by its adopter. */
  mail?: unknown;
}
export class SettingsError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Structural D1 contract; custom adapters need no operator-auth dependency. */
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<Result[]>;
}
export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
  run<T = Record<string, unknown>>(): Promise<Result<T>>;
}
export interface Result<T = Record<string, unknown>> { results: T[]; meta: { changes: number } }
