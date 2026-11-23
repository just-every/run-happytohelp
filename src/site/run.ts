import type { RunData } from './base/run-site'
import { runPricing } from './base/run-pricing'
import data from './run.json'

export const run: RunData = {
  ...data,
  leadLine: 'Install and run the latest published HappyToHelp release on your computer.',
  pricing: runPricing,
}

// Resolve the published GitHub release before fetching its exact tag.
const findRelease = String.raw`tag=$(curl -fsS -o /dev/null -w '%{redirect_url}\n' "$repo/releases/latest" | sed -nE 's|^.*/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$|\1|p')`
export const releaseCheckout = `repo=${run.repository}; ${findRelease} && test -n "$tag" && mkdir run-happytohelp && cd run-happytohelp && git init -q && git remote add origin "$repo" && git fetch -q --depth 1 --no-tags origin "refs/tags/$tag:refs/tags/$tag" && git checkout -q --detach "refs/tags/$tag^{commit}"`
export const releaseStart = `${releaseCheckout} && curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev`
export const releaseNodeStart = `${releaseCheckout} && npx -y @runeditrun/rer dev`
