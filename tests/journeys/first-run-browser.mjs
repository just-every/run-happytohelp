import test from 'node:test'
import {onboarding} from '../sanity/browser/onboarding.mjs'
test('a new owner discovers the public source, sets up native identity, brands the workspace, publishes searchable help and installs its widget before creating a second workspace',{timeout:180_000},onboarding)
