import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
// @ts-expect-error The migration collector is JavaScript without declarations.
import {collectMigrations, hostedDemoMigrations} from '../migrations.mjs';

export {hostedDemoMigrations};

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Every production `vite build` (rer build and rer deploy --demo alike) first writes the inputs the Worker
 *  bundle reads: the collected D1 migrations and the public widget and connector download. Once per build. */
export function buildInputs(hostedDemo: boolean): Plugin {
    let prepared: Promise<void> | undefined;
    return {
        name: 'happytohelp:build-inputs',
        apply: 'build',
        buildStart() {
            return prepared ??= (async () => {
                await collectMigrations({hostedDemo});
                for (const script of ['scripts/build-local-agent.cjs', 'scripts/build-widget.mjs']) execFileSync(process.execPath, [script], {cwd: root, stdio: 'inherit'});
            })();
        },
    };
}
