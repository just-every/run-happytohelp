import test from 'node:test'
import {freshInstallJourney} from '../helpers/installer/fresh-install.mjs'
import {readmeRestoreJourney} from '../helpers/installer/readme-restore.mjs'
import {reproducibleBuild} from '../helpers/installer/reproducible.mjs'
import {browserJourney} from '../helpers/delegation-journey/browser.mjs'
import {evidence} from './kit/browser.mjs'

// Slow qualification journeys from fresh checkouts: nightly, release tags and on demand, never on every push.
test('a fresh clone installs with the rer commands, keeps its owner and data through export, import and restore, and resets to a fresh owner',{timeout:60*60_000},freshInstallJourney)
test('the README path from a fresh clone: setup twice, owner entry at 1440, a complete D1 and R2 round trip into another fresh clone, and a confirmed reset',{timeout:60*60_000},readmeRestoreJourney)
test('two fresh installs at unrelated paths build byte-identical delivery artifacts that name no builder path',{timeout:15*60_000},reproducibleBuild)
test('an agent fix from a fresh clone: rer install, setup and dev, the automatic owner entry, then pairing, investigation, approved resolve, independent observation and Send in the browser at 1440',{timeout:60*60_000},async()=>browserJourney((await evidence('delegation-fresh-clone'))('')))

import {platformArchiveJourney} from '../helpers/platform-archive.mjs'
test('a Platform archive restores into Platform and native ledgers; missing, multiple and changed ledgers refuse without writes',{timeout:10*60_000},platformArchiveJourney)

import {rerMailArchiveJourney} from '../helpers/email/rer-archive.mjs'
test('Managed mail archives retain native delivery history and attachments while retiring mailbox authority and erasing private MIME',{timeout:10*60_000},rerMailArchiveJourney)

import {portableRestoreJourney} from '../helpers/recovery/portable-journey.mjs'
test('a native archive refuses damaged, oversized, unconfirmed and populated-target imports without writes, then restores a destroyed installation and re-exports every row and file',{timeout:10*60_000},()=>portableRestoreJourney({archiveQualification:true}))
