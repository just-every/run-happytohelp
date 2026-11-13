import {version} from '../../package.json'

// Vite replaces this value when it configures a build (or local dev session).
// Direct source harnesses have no build identity; the documented value is null.
declare const __H2H_RELEASE_SOURCE_COMMIT__: string | null
export const release = {
 version,
 sourceCommit: typeof __H2H_RELEASE_SOURCE_COMMIT__ === 'undefined' ? null : __H2H_RELEASE_SOURCE_COMMIT__,
}
