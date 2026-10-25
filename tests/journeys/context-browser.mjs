import test from 'node:test'
import {proactiveWidgetBrowser} from '../helpers/proactive-widget-browser.mjs'
import {collectionPrivacyBrowser} from '../helpers/context/collection-privacy-browser.mjs'

// Proactive help in the emitted Worker and Chromium; only the model and crawler providers are fixtures.
test('at 1440 and 390 a visitor consents in the widget, real clicks are collected and analysed by the queued native model, the insight is offered, answered or dismissed and stops on revocation, while operators manage assistants through their ordinary controls; excluded regions, passwords and typed personal data never leave the page, and nothing is collected after the visitor stops sharing',async()=>{await proactiveWidgetBrowser();await collectionPrivacyBrowser()})
