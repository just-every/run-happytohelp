import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../platform/env'
import { serverSecret } from '../platform/db'
import { createNativeOwner } from '../modules/identity/setup'
import { OwnerClaimError, verifyOwnerClaim } from '../vendor/base/modules/owner-claim/verify.mjs'
import { company, ownerName } from './team'
import { demoMode } from './mode'

/** The hosted demo's start: Base's native host signs a short-lived owner claim for this visitor's own copy, and the
 * claim becomes the copy's native owner and signed-in session. Only a demo copy holding the host's public keys answers. */
export const demoOwnerClaim = new Hono<AppEnv>()
demoOwnerClaim.post('/owner-claim', async c => {
  const env = c.env
  if (!demoMode(env) || typeof env.RER_OWNER_CLAIM_PUBLIC_KEYS !== 'string') return c.notFound()
  const origin = String(env.APP_ORIGIN || '')
  if (!origin || c.req.header('origin') !== origin) throw new HTTPException(403, { message: 'Owner claims are accepted only from this demo' })
  const email = String(env.OWNER_EMAIL || '').trim().toLowerCase()
  const token = (await c.req.parseBody()).token
  try {
    const issuer = env.RER_OWNER_CLAIM_ISSUER, installationId = env.RER_OWNER_CLAIM_INSTALLATION_ID
    if (typeof issuer !== 'string' || typeof installationId !== 'string') throw new OwnerClaimError('invalid_configuration', 503)
    await verifyOwnerClaim(String(token || ''), { issuer, installationId, appOrigin: origin, expectedEmail: email, publicKeys: JSON.parse(env.RER_OWNER_CLAIM_PUBLIC_KEYS) })
  } catch (error) {
    const claim = error as { code?: string; status?: number }
    return c.json({ error: claim.code ?? 'invalid_claim' }, (claim.status === 503 ? 503 : 403))
  }
  await createNativeOwner(c, { email, password: serverSecret(), allowedOrigin: company.website, name: company.name, ownerName, primaryColor: company.colour })
  c.header('Cache-Control', 'no-store')
  return c.redirect('/conversations', 303)
})
