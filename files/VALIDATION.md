# Local validation receipt

| Item | Value |
| --- | --- |
| Repository | just-every/run-happytohelp |
| Branch | cloud/sd-hh-release-0-4-32 |
| Exact committed source | c9f4904b175366d0226fc2a4c33348d6e4f8ffc9 |
| Candidate base | ea02bafd06b5a123879b5c3a36d14b3d136225c9 |
| Previous published tag commit | e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f |
| UTC metadata date | 2026-11-21 |
| Pinned validation toolchain | Node 22.20.0, pnpm 10.12.4, rer 0.2.127 |

All listed checks exited zero before the product push.

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Installed the unchanged dependency lock. |
| Pinned rer `modules/release/source.mjs` `inspectSource` | Validated a clean committed source. The seed, package and release version fields agree at 0.4.32, and a Verify script exists. |
| CHANGELOG and RELEASE.json parity | The heading date equals the JSON date and UTC stamp. The complete 0.4.32 notes body matches exactly, the previous heading is 0.4.31, and the upgrade instructions and prose-entry dates agree. |
| `pnpm run typecheck` | Route generation and `tsc --noEmit` passed. |
| `pnpm run source:lock` and `pnpm run source:check` | Regenerated after the tracked metadata edits and passed on the candidate. |
| `node src/site/base/contract-docs.mjs check` | Contract prose 0 errors and 0 warnings. Generated documents current. |
| `node scripts/contract-docs.mjs check` | Contract prose 0 errors and 0 warnings. Generated documents current. |
| Pinned rer `check --profile first-party` | Passed. |
| Committed declared project hashes | Only `setup.sha256` is declared. The declared and actual SHA-256 of `rer-setup.json` both equal `8bd451d4b6c5d6f21774055adff082bfdc34e8d4b07dc2e5c34878e702619252`. |
| `git ls-tree -r` SQL inventory and blob comparison | 200 tracked SQL files on each of the published tag and main. Byte-identical and unchanged in the candidate. |
| Scope and commit hygiene | Clean checkout. `git diff --check` passes. Five leased files only. One candidate commit with fleet author and committer and no trailers. |
| Freshness and tag checks | Advertised main matched candidate parent immediately before push, and no remote v0.4.32 tag was present. |
| Product push | Guarded HTTPS push completed on its first transport attempt and published the named branch. |

_Run Edit Run fleet, 2026-11-21._
