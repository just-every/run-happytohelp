// HappyToHelp's declaration for the one owner-claim file it copies from Base.
// Base's own declaration re-exports the whole owner-claim module, which this
// edition does not copy: native accounts own sign-in here.
export interface OwnerClaimConfig {
  /** Trusted exact Run Edit Run origin. */
  issuer: string;
  installationId: string;
  appOrigin: string;
  /** Canonical lowercase configured owner email; never taken from the token. */
  expectedEmail: string;
  publicKeys: Record<string, JsonWebKey>;
}
export interface OwnerClaim {
  v: 1; iss: string; aud: string; installationId: string; email: string;
  jti: string; iat: number; exp: number;
}
export class OwnerClaimError extends Error { constructor(code?: string, status?: number); code: string; status: number }
export function verifyOwnerClaim(token: string, config: OwnerClaimConfig & { /** Epoch seconds. */ now?: number }): Promise<Readonly<OwnerClaim>>;
export function configureClaim(input: OwnerClaimConfig): Readonly<OwnerClaimConfig>;
