import test from 'node:test'
import {conversationMailJourney} from '../helpers/email/conversation-mail.mjs'
import {suspendedMailJourney} from '../helpers/email/suspended-mail.mjs'
import {rerMailJourney} from '../helpers/email/rer-mail.mjs'

test('one customer mail thread crosses authenticated gateways, carries files and proven replies, notifies current teammates and retains uncertain sends without replay',conversationMailJourney)
test('suspicious mail remains reviewable without customer effects, recovers safely, expires with an audit and is erased with its customer',suspendedMailJourney)
test('managed mail authenticates ingress and threads replies, holds a rotated credential until rebuilt, and reconciles accepted but uncertain sends without replay',rerMailJourney)
