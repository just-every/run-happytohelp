import test from 'node:test'
import {proactiveWidgetBrowser} from '../helpers/proactive-widget-browser.mjs'
import {collectionPrivacyBrowser} from '../helpers/context/collection-privacy-browser.mjs'
import {identityLinksBrowser} from '../helpers/context/identity-links-browser.mjs'

// Customer context in the emitted Worker and Chromium; only the model and crawler providers are fixtures.
test('at 1440 and 390 a visitor consents in the widget, real clicks are collected and analysed by the queued native model, the insight is offered, answered or dismissed and stops on revocation, while operators manage assistants through their ordinary controls; excluded regions, passwords and typed personal data never leave the page, and nothing is collected after the visitor stops sharing; operators see a reviewed "possibly the same customer" link only as context, linked and unlinked with reviewer, time and evidence, never merged or sent, while each customer keeps only their own session',async()=>{await proactiveWidgetBrowser();await collectionPrivacyBrowser();await identityLinksBrowser()})
