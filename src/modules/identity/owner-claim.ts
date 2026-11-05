import {healImportDoor} from '../move-in/door/authority'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { configuredToken, createNativeOwner, requireSetupOrigin, requireSetupToken, setupAvailable } from './setup'

/** Rer's hosted claim uses installation configuration, never a caller-selected email or password. */
export const ownerClaim = new Hono<AppEnv>()
ownerClaim.post('/bootstrap', async c => {
 requireSetupOrigin(c)
 c.header('Cache-Control', 'no-store')
 // Rer retires the private setup token after this durable claim. Repeats remain closed after retirement.
 if (!await setupAvailable(c.env.DB)){await healImportDoor(c.env);return c.json({error: 'already_initialized'}, 409)}
 if (!configuredToken(c.env)) throw new HTTPException(503, {message: 'Owner setup is awaiting its installation credential'})
 let body: Record<string, unknown>
 try {
  body = await c.req.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
 } catch { throw new HTTPException(400, {message: 'Submit a JSON object'}) }
 await requireSetupToken(c, body.token)
 const email = c.env.H2H_SETUP_OWNER_EMAIL || c.env.OWNER_EMAIL
 if (typeof email !== 'string' || !email.trim()) throw new HTTPException(503, {message: 'Configure the installation owner email'})
 if (email.trim().toLowerCase() === 'owner@run-happytohelp.test') throw new HTTPException(503, {message: 'Configure a real OWNER_EMAIL that can receive hosted sign-in mail; the local trial owner has no mailbox'})
 // An absolute URL may be accepted only on this app's origin; malformed or external destinations go to Setup.
 let returnTo = '/setup'
 if (typeof body.returnTo === 'string') {
  try {
   const destination = new URL(body.returnTo, c.req.url)
   if (destination.origin === new URL(c.req.url).origin && !destination.username && !destination.password && !destination.pathname.startsWith('//'))
    returnTo = destination.pathname + destination.search + destination.hash
  } catch { /* Setup is the safe destination. */ }
 }
 try {
  await createNativeOwner(c, {
   email, allowedOrigin: c.env.WIDGET_ORIGIN || c.env.APP_ORIGIN || new URL(c.req.url).origin,
   // Rer's hosted claim has no owner answers and supplies a generic "Owner".
   // Derive the native name from the actual owner email configured on this Worker.
  }, {emailClaim:true})
 } catch (error) {
  if (error instanceof HTTPException && error.status === 409){await healImportDoor(c.env);return c.json({error: 'already_initialized'}, 409)}
  throw error
 }
 await healImportDoor(c.env)
 return c.redirect(returnTo, 303)
})
