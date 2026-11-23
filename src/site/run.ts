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
export const releaseCheckout = `(repo=${run.repository}; ${findRelease}; test -n "$tag" || { echo 'No published HappyToHelp release found with a vX.Y.Z tag.' >&2; exit 1; }; checkout=$(mktemp -d ./.happytohelp-release.XXXXXX) && trap 'rm -rf "$checkout"' EXIT && git -C "$checkout" init -q && git -C "$checkout" remote add origin "$repo" && git -C "$checkout" fetch -q --depth 1 --no-tags origin "refs/tags/\${tag}:refs/tags/\${tag}" && mkdir run-happytohelp && mv "$checkout/.git" run-happytohelp/.git && git -C run-happytohelp checkout -q --detach "refs/tags/$tag^{commit}") && cd run-happytohelp`
export const releaseStart = `${releaseCheckout} && curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev`
export const releaseNodeStart = `${releaseCheckout} && npx -y @runeditrun/rer dev`
