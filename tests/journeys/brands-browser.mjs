import test from 'node:test'
import {brandsBrowser} from '../helpers/inbox/brands-browser.mjs'
test('a shared team serves two brands with isolated settings, senders, inboxes and help hosts, and deliberately selects their aggregate report',{timeout:120_000},brandsBrowser)
