import { SettingsError } from './types.ts';
import type { ManagedMember, Member, Options } from './types.ts';

/** `retiredForms` of each listed address, by address. */
export type Forms = Map<string, string[]>;

/** Project durable identities onto the current roster keys for email-keyed adapters. */
export function projectManaged(stored: ManagedMember[], members: Member[], ownerId: string | null, forms: Forms = new Map()): ManagedMember[] {
  const byId = new Map(stored.filter(row => row.businessId).map(row => [row.businessId, row]));
  const assigned = new Map<ManagedMember, Member>();
  const linked = new Set<Member>();
  const bind = (row: ManagedMember, member: Member) => { assigned.set(row, member); linked.add(member); };
  for (const member of members) {
    const prior = member.id ? byId.get(member.id) : undefined;
    if (prior) bind(prior, member);
  }
  for (const member of members) {
    if (linked.has(member)) continue;
    const named = [member.email, ...forms.get(member.email) ?? []];
    const prior = stored.find(row => named.includes(row.email) && !assigned.has(row));
    if (!prior) continue;
    if (member.id && prior.businessId && member.id !== prior.businessId) throw new SettingsError('business_member_binding_mismatch');
    bind(prior, member);
  }
  const projected = stored.map(row => {
    const member = assigned.get(row);
    return member ? { ...row, email: member.email, businessId: member.id ?? row.businessId, businessRole: member.role } : row;
  });
  // An inactive binding still owns its Business ID. Never displace it to reuse
  // its roster address or let an omitted ID create a second native binding.
  if (new Set(projected.map(row => row.email)).size !== projected.length ||
      projected.some(row => row.businessId && row.businessId === ownerId) || members.some(member => member.id === ownerId)) {
    throw new SettingsError('business_member_binding_mismatch');
  }
  return projected;
}

/** The module owns signed metadata; adapters need only return native identities. */
export function teamRows(rows: ManagedMember[], members: Member[], managed: ManagedMember[]): ManagedMember[] {
  const desired = new Map(members.map(member => [member.email, member]));
  const previous = new Map(managed.map(row => [row.email, row]));
  return rows.map(row => {
    const member = desired.get(row.email), prior = previous.get(row.email);
    return { ...row, businessId: member?.id ?? prior?.businessId ?? null, businessRole: member?.role ?? prior?.businessRole ?? null };
  });
}

/** What the seed's adapter names as the older-release forms of each listed address; nothing when it names none. */
export async function retiredForms(options: Pick<Options, 'team'>, members: Member[]): Promise<Forms | undefined> {
  const named = options.team?.retiredForms;
  return named ? new Map(await Promise.all(members.map(async (member): Promise<[string, string[]]> => [member.email, await named.call(options.team, member.email)]))) : undefined;
}
