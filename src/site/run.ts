import type { RunData } from './base/run-site'
import { runPricing } from './base/run-pricing'
import data from './run.json'

export const run: RunData = { ...data, pricing: runPricing }
