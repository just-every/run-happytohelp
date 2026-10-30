import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,realpath,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {startApp} from './kit/app.mjs'
import {customerFixture} from '../helpers/delegation-journey/fixture.mjs'
import {client,newVisitor,runCase} from '../helpers/delegation-journey/case.mjs'
import {refusals} from '../helpers/delegation-journey/refusals.mjs'
import {push001Outcomes} from '../helpers/delegation/push-001-outcomes.mjs'
import {consentJourney} from '../helpers/delegation/consent.mjs'

// The agent-fix journey runs the real packaged connector, paired to the real
// application on loopback; only the paid Codex CLI is scripted, against a
// disposable customer system.
let app,fixture,scratch,api,actor
before(async()=>{
 app=await startApp({listen:true,bindings:{RER_INSTALLATION_ID:'journey-installation'}});fixture=await customerFixture();scratch=await mkdtemp(join(await realpath(tmpdir()),'h2h-delegation-journey-'))
 const workspace=await app.seedWorkspace('fix',{name:'Agent fix journey',allowedOrigin:app.url});api=client(app.url,workspace.tokens.owner);actor={id:workspace.users.owner,projectId:workspace.projectId}
 await app.presenceAwayOff(workspace.projectId)
 // Work in another conversation never enters a delegated job's evidence.
 await (await newVisitor({origin:app.url,api,projectId:actor.projectId})).say('OUTSIDE SCOPED CONVERSATION')
})
after(async()=>{await fixture?.close();await app?.close();if(scratch)await rm(scratch,{recursive:true,force:true})})

test('a visitor\'s report is investigated read-only, an approved resolve child changes the customer system once, a separate investigation confirms it, and the person\'s Send reaches the visitor exactly once',async()=>{
 const seven=await runCase({origin:app.url,api,actor,fixture,directory:join(scratch,'case')})
 assert.equal(seven.jobs.length,3);assert.equal(seven.fixtureEvents.filter(event=>event.method==='POST').length,1)

 const deliveryFault=enabled=>app.db.prepare(enabled?"CREATE TRIGGER journey_delivery_fault BEFORE UPDATE OF status ON local_receipts WHEN NEW.status='sent' BEGIN SELECT RAISE(ABORT,'Journey simulated receipt acknowledgement outage: delivery unconfirmed'); END":'DROP TRIGGER journey_delivery_fault').run()
 await refusals({origin:app.url,api,actor,fixture,directory:join(scratch,'refusals'),deliveryFault})
 await push001Outcomes({app,api,actor,directory:join(scratch,'push-001')})
})

test('a connected application gets selected access only through native consent with an exact callback, a single-use code and PKCE; it repairs and publishes an article atomically with exact replay, meets stale, category and audience revisions as conflicts, loses erased evidence, and ends with membership loss or revocation',consentJourney)
