import {version} from '../../package.json'

/** Bundled seed version; the deployment producer alone supplies source provenance. */
export function releaseIdentity(env: {RER_DEPLOY_SOURCE?: string}) {
 return {version,sourceSha:env.RER_DEPLOY_SOURCE??null}
}
