import type { RunData } from './base/run-site'
import { runPricing } from './base/run-pricing'
import data from './run.json'

// Use the published HappyToHelp release and its rer version for the public launch command.
const { releaseTag, releaseRer, ...runData } = data
export const run: RunData = {
  ...runData,
  leadLine: `Install and run HappyToHelp ${releaseTag} on your computer.`,
  pricing: runPricing,
}

export const releaseCheckout = `git clone --branch ${releaseTag} --depth 1 ${run.repository} && cd run-happytohelp`
export const releaseInstaller = `curl -fsSL https://runeditrun.com/install.sh | RER_VERSION=${releaseRer} sh`
export const releaseStart = `${releaseCheckout} && ${releaseInstaller} -s -- dev`
export const releasePackage = `@runeditrun/rer@${releaseRer}`
export const releaseNodeStart = `${releaseCheckout} && npx -y ${releasePackage} dev`
