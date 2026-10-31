// The journal subpath is public; rer currently ships declarations only for its
// main portability entry. Keep this adapter limited to the two D1 operations.
declare module '@runeditrun/rer/modules/portability/journal' {
  export function redactionStatements(db:D1Database):Promise<D1PreparedStatement[]>
  export function invalidateTransfersStatements(db:D1Database):Promise<D1PreparedStatement[]>
}
