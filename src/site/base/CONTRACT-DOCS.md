# Contract document commands

`CONTRACT.md` is the only acceptance text and status source. Follow the format
under "Contract status" in `SEED-COMMAND-CONTRACT.md`. Keep `contract-docs.mjs`
and its relative imports beside the existing `seed-contract.mjs`; use that
actual directory in every command below. Run from the runnable seed root.

## Generate and check

```sh
node src/base/contract-docs.mjs write
node src/base/contract-docs.mjs check
rer check
```

`write` regenerates `ACCEPTANCE.md`, `docs/CLAIMS.md` and the three Status
summary rows. Never edit these outputs by hand. `check` is read-only and fails
on stale outputs; run it in CI. Commit generated outputs with each contract
change. `rer check` validates parser structure and existing evidence paths;
it does not prove acceptance. Report Core done and full-target done together.

## Rewrite records

```text
node src/base/contract-docs.mjs convert --old <ref> [--old-acceptance <ref>]
node src/base/contract-docs.mjs id-map --old <ref-or-tracked-file>
node src/base/contract-docs.mjs coverage init --old <ref>
node src/base/contract-docs.mjs coverage check --old <ref>
node src/base/contract-docs.mjs coverage rebase --from <ref> --onto <ref>
```

`convert` starts a current-format rewrite; inspect its proposed placement.
`id-map` generates `docs/contract/ID-MAP.json` from From metadata and retired
rows. Coverage commands manage `docs/contract/COVERAGE.json`: initialize against
the old main revision, place every old sentence and gap, then check. After a
rebase, move coverage from the previous old reference to the new main revision,
place newly changed lines, regenerate the ID map against that same revision,
and check coverage again. A structural rewrite preserves scope, clause status,
evidence and the last judged commit and date; it never promotes status.

## Regenerate before locking

An edition carrying the edition-authoring tool and source lock runs generation
before its lock command. Put these lines in its `AGENTS.md`, using actual paths:

```text
Lander-Regenerate: node src/base/contract-docs.mjs write
Lander-Regenerate: node scripts/edition-authoring/cli.mjs lock
```

Then run the generator's `check` and the edition's source check. Foundation
initialization stamps `BASE_COMMIT` and `BASE_DATE` consistently in the contract
and its generated documents. After editing the contract, run `write` before
checking, locking or publishing. Authoring input folders
are not runnable editions, and placeholders are not a real judged revision.

## Record copied source

Copy the generator and relative imports from one immutable Base commit.
For each new copied file, record the destination, Base origin and full commit:
```sh
node scripts/edition-authoring/cli.mjs record-base src/base/contract-docs.mjs foundation/runtime/contract-docs.mjs FULL_40_HEX_COMMIT --base /absolute/base-checkout
node scripts/edition-authoring/cli.mjs verify-base --base /absolute/base-checkout
```

`record-base <path> <origin-path> <revision>` takes no repository positional
argument; `--record <file>` selects a record instead of `base-copies.json`.
It records Base bytes and modes, never copies files or accepts local drift.
Use the existing refresh workflow for an already recorded directory; records
must not overlap. Regenerate outputs, inspect the diff, then lock and check.
