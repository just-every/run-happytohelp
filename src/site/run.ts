import type { RunData } from './base/run-site'
import { runPricing } from './base/run-pricing'
import data from './run.json'

export const run: RunData = {
  ...data,
  leadLine: 'Install and run the latest published HappyToHelp release on your computer.',
  pricing: runPricing,
}

export const releaseCheckout = `repo=${run.repository}; release=$(curl -fsS -o /dev/null -w '%{redirect_url}' "$repo/releases/latest") && git clone --branch "\${release##*/}" --depth 1 "$repo" && cd run-happytohelp`
export const releaseStart = `${releaseCheckout} && curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev`
export const releaseNodeStart = `${releaseCheckout} && npx -y @runeditrun/rer dev`
