# Contract document commands

`CONTRACT.md` is the only acceptance text and status source. Follow the format
under "Contract status" in `SEED-COMMAND-CONTRACT.md`. Keep `contract-docs.mjs`
and its relative imports beside the existing `seed-contract.mjs`; use that
actual directory in every command below. Run from the runnable seed root.

## Generate and check

```sh
node src/base/contract-docs.mjs write
node src/base/contract-docs.mjs check
node src/base/contract-docs.mjs check-prose
rer check
```

`write` regenerates `ACCEPTANCE.md`, `docs/CLAIMS.md` and the three Status
summary rows. Never edit these outputs by hand. `check` is read-only and fails
on stale outputs; run it in CI. Commit generated outputs with each contract
change. `rer check` validates parser structure and existing evidence paths;
it does not prove acceptance. Report Core done and full-target done together.

Follow `platform/CONTRACT-STANDARD.md` for the governing contract standard.
`check` also runs `check-prose`. The latter reads CONTRACT.md and, when present,
docs/contract/COVERAGE.json and its recorded old Git commit. Keep that commit
available locally. Each finding names its clause id, family and source location:

- ERROR a: acceptance prose mapped to `generated`, including an `also`
  destination. Only recognized status/count statements are exempt. Coverage
  initialization places unique clause acceptance at its clause, not generated.
- ERROR c: a Markdown tool-table row has no fleet class, including a missing
  class column or a placeholder. A populated declaration's semantic completeness
  still needs judgment; this check does not infer classes from action names.
- WARN b/d: literal phrases below match clause bodies or Status Gaps. Matching
  ignores case, Markdown formatting and whitespace. Output includes the actual
  matched phrase and its judgment source. Warnings alone exit zero. They ask for
  review; they do not authorize removing seed-specific obligations.

The 28 October 2026 judgments read for these rules are the following task reports
(`VERDICT.md` in each named task's directory):

- Strap: `ct-cleanup-judge-strap-819f84b-20261028-1015-cx2`.
- Orbit: `ct-cleanup-judge-orbit-97681f8-20261028-0950-cx2` (blocked before
  substantive judgment) and `ct-cleanup-judge-orbit-d4a8bf1-20261028-1130-cx2`.
- Mango: `ct-cleanup-judge-mango-9d0c381-20261028-1155-cx2`.
- Nook: `ct-cleanup-judge-nook-bf244ee-20261028-1030-cx2`.

Every warning pattern is verbatim from those reports; keep new patterns in
`contract-prose-patterns.mjs` with their source. Strap's phrases describe the
candidate rather than quoting a complete candidate sentence.

| Family | Literal pattern | Report source |
| --- | --- | --- |
| b | Assignment never grants access | Orbit d4a8bf1 F5, line 70 |
| b | Permission changes apply on the next request | Orbit d4a8bf1 F5, line 70 |
| b | untrusted source text | Strap F5, line 65 |
| b | authorized job handles | Strap F5, line 65 |
| d | This target-contract round leaves the approved homepage and app interface untouched | Orbit d4a8bf1 F8, line 76 |
| d | This deliberately replaces the former dedicated hosted-record walkthrough | Orbit d4a8bf1 F8, line 76 |
| d | Full verification includes the delegation D1, archive and native-browser regressions as well as all retained contract gates. | Orbit d4a8bf1 F8, line 76 |
| d | Run pnpm test:push | Nook finding 7, line 79 |
| d | ct pattern 1 | Mango finding 6, line 84 |

## Rewrite records

```text
node src/base/contract-docs.mjs convert --old <ref> [--old-acceptance <ref>] [--claim-map <file>]
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

### Historical claim references

`convert --old` reads the recorded snapshot, including its handwritten claims
files. Editing the working contract or claims file does not change that input.
Conversion uses the largest original homepage claims source; errors name its
file, original line and exact claim. Valid product links need no mapping.

The observed claim columns are `Claim`, `Claims`, `Claim on the page`,
`What the page claims` and `Claim text`; clause columns accept `Clause`,
`Clauses`, `Clause(s)` and `Clause id(s)`. Other homepage table headings
refuse conversion. Clause-status appendices are separate from claim tables.
Every converted row retains its exact source text and historical status in
`contract-claim-source`; generated claims show history separately from current
derived status. Both `check` and `coverage check` name missing or changed
original claims, including older conversions with a coverage record.

Coverage ignores leading Markdown blockquote prefixes when comparing source
fragments. Conversion removes those prefixes from clause prose while retaining
the words. A changed or dropped sentence still fails reconstruction.

For historical aliases, boundary labels or empty cells with a real product
obligation, pass a reviewed JSON claim map. Its `old` must be the full original
SHA. Each entry identifies
one selected source row by `file`, one-based `line` and exact `claim` cell text;
`clauses` lists distinct product IDs defined in that original contract. Supply
one entry per row needing repair. Unknown rows/IDs, duplicate entries, changed
text, empty lists, stale SHAs and unresolved claims refuse before output writes.
The caller must establish that each link represents the actual obligation;
the tool checks identity and existence, not semantic equivalence. An ownership
or boundary statement without a corresponding product obligation cannot be
made valid by inventing a link or assigning it a completed status.

Here is a complete example from a seed root with the synthetic legacy sample's
`docs/CLAIMS.md`: its identity claim cites `OWN-01`, its private-drafts claim
cites `Honest boundaries`, and its archive claim has an em dash. The original
contract actually requires identity/owner preservation in `E1`, private drafts
in `PUBLISH-01`, and readable archives in `AUTH-HOST-01`. Adjust these reviewed
claim/ID pairs to the real obligations when applying this procedure elsewhere.

```sh
export CONTRACT_OLD="$(git rev-parse main)"
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const old = process.env.CONTRACT_OLD, file = 'docs/CLAIMS.md'
const lines = execFileSync('git', ['show', `${old}:${file}`], { encoding: 'utf8' }).split('\n')
const reviewed = [
  ["Keep each entry's identity", ['E1']],
  ['Draft entries stay private', ['PUBLISH-01']],
  ['Archived entries remain readable', ['AUTH-HOST-01']],
]
const claims = reviewed.map(([claim, clauses]) => {
  const matches = lines.flatMap((text, index) => text.split('|')[2]?.trim() === claim ? [index + 1] : [])
  if (matches.length !== 1) throw Error(`Expected exactly one original row for ${claim}`)
  return { file, line: matches[0], claim, clauses }
})
writeFileSync('claim-map.json', JSON.stringify({ schema: 1, old, claims }, null, 2) + '\n')
JS
node src/base/contract-docs.mjs convert --old "$CONTRACT_OLD" --claim-map claim-map.json
node src/base/contract-docs.mjs check
node src/base/contract-docs.mjs id-map --old "$CONTRACT_OLD"
node src/base/contract-docs.mjs coverage check --old "$CONTRACT_OLD"
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = name => JSON.parse(readFileSync(`docs/contract/${name}.json`, 'utf8'))
assert.equal(read('ID-MAP').old, process.env.CONTRACT_OLD)
assert.equal(read('COVERAGE').old.commit, process.env.CONTRACT_OLD)
JS
```

Keep the same original SHA for conversion, ID map and coverage. Preserve the
map for review alongside the rewrite. Conversion retains all claim text/rows,
archives historical references in `CHANGELOG.md` and coverage, and changes only
the selected claims' clause cells. Final `write`/`check` still require existing
product IDs and compute statuses from the unchanged clause statuses.

### Source-bound non-product facts

The ct ruling of 28 October 2026 permits an explicit non-product extension to
the standard's claims and rewrite records, including the 07:40Z boundary ruling.
A historical license, launcher identity, hosted-demo action or stated negative
scope boundary with no faithful product clause remains a
Homepage claims row. Its current derived status is **unassessed**. Its original
status remains historical, including an original `done`; this adds no product
ID, acceptance point or proof and changes no clause or tier counts.

Use the same `convert --old FULL_SHA --claim-map claim-map.json` command. For
each reviewed non-product row, supply `nonProduct` instead of `clauses`:

```json
{
  "schema": 1,
  "old": "6426e9696bc64efac2780c607fe6ff6cf0bc4903",
  "claims": [
    {
      "file": "CONTRACT.md",
      "line": 339,
      "claim": "\"100% free, open source alternative to Expensify, SAP Concur and Emburse\"",
      "nonProduct": "license/public-repository ownership"
    },
    {
      "file": "CONTRACT.md",
      "line": 384,
      "claim": "\"100% free and open source. MIT licensed.\"",
      "nonProduct": "license/public-repository ownership"
    }
  ]
}
```

The supported bases are deliberately bounded:

| `nonProduct` value | Required original meaning and text |
| --- | --- |
| `license/public-repository ownership` | The complete `100% free, open source alternative to …`, `100% free and open source. MIT licensed.` or standalone `MIT license`/`MIT licensed` fact (optional quotation marks). Coaster's original `OWN` means MIT/license/public repository; it is not a product clause. |
| `launcher identity` | The complete literal `` `npx -y @runeditrun/rer dev …` starts <product name> `` action, optionally prefixed `Terminal:`, identifying the launcher and product; no installation, capacity or runtime duty is inferred. |
| `hosted-demo action` | The literal `"Try the demo" opens the hosted demo` action; no product or hosting proof is inferred. |
| `boundary` | A complete `Limits: "No …"` negative-scope claim whose original clause cell explicitly says `none needed: a boundary, true of the code` (optional final period). This records a limit true of the code, without inventing a product obligation. |

For the first three bases, original references must be empty, an em dash or the
historical `OWN` token. The `boundary` basis requires the explicit original
boundary explanation above; an empty cell, `OWN` or a generic boundary label
does not qualify. No basis permits a real product ID. These are necessary checks after explicit
review, never automatic exemptions inferred from an empty link or unknown ID.
An arbitrary non-product label, a mismatched basis, a real product reference,
or both `clauses` and `nonProduct` refuses conversion. Text matching does not
establish semantic equivalence: the reviewer must confirm the entire original
claim is the named fact. Other ownership/boundary/product promises continue to
need faithful real clause links or a further standard ruling; these four
bases are the entire supported non-product scope.

For Crank original `7231b3fbdc1151210c2af9bbd607370f7c0af3e3`, map only
claim 37 at `CONTRACT.md:1068` to `"nonProduct": "boundary"`, retaining the
exact claim cell `Limits: "No desktop or screen-scraping robots"`. Its original
clause cell is `none needed: a boundary, true of the code` and historical status
is `done`. The final view labels it `Non-product: boundary` with current status
`unassessed`; all 40 claims remain counted. Other rows still need faithful real
links or separately reviewed mappings. An unmapped boundary refuses conversion.

For Nectar original `24303c4b9cfe4d055c4683397ebd7971bb861efb`, use the
same map shape with exact claim cells at `CONTRACT.md:500` (claim 6, license),
`:565` (71, launcher identity), `:567` (73, license) and `:570` (76,
hosted-demo action). Leave product rows, including their real links, untouched.
Do not replace the launch/demo text with a generic installation or scale claim.

Conversion adds a `Basis` column to the contract's claims table. Product rows
say `Product`; a non-product row has an empty `Clauses` cell and, for example,
`Non-product: license/public-repository ownership`. Under that table, inside
the same Homepage claims section, it writes this provenance record:

```text
<!-- contract-claim-source
{
  "schema": 1,
  "old": "<full original Git SHA>",
  "claims": [
    {
      "file": "CONTRACT.md",
      "line": 339,
      "number": "6",
      "claim": "<exact original claim cell>",
      "status": "<exact historical status cell, or empty if absent>",
      "clauses": "<exact original references cell>",
      "text": "<exact entire original table row>",
      "nonProduct": "license/public-repository ownership"
    }
  ]
}
-->
```

The actual record includes **every** selected original row, in original order;
only explicit non-product rows have `nonProduct`. It preserves stable claim
numbers, file/line, text, references and historical status without changing the
old snapshot. It is part of `CONTRACT.md`, not a second editable claims source.
Keep the original Git object available to the generator, including in CI;
missing history fails closed. Existing ID-MAP and COVERAGE originals must
match the record's SHA. The generated view names each non-product basis,
shows historical status separately, and reports its unassessed count outside
the product done/partial/missing totals so all rows reconcile.

Run `write`, `check`, `id-map --old FULL_SHA` and `coverage check --old FULL_SHA`
as above, retaining the same original SHA throughout. `write` and `check`
validate the record against the immutable original, each current claim's
number/text and complete row count. Changed source SHA/file/line/text/status,
dropped rows, missing real product links, invalid IDs and arbitrary exemptions
fail. Coverage still places every original line and ID mapping still retains
every real clause. Generated documents remain reproducible; historical claim
statuses are never promoted to fresh proof. No product contract, homepage copy
or fixed validation gate is changed by this extension.

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

Without a Base checkout, use GitHub's immutable commit/tree/blob API through
an authenticated `gh`:

```sh
node scripts/edition-authoring/cli.mjs record-base src/base/contract-docs.mjs foundation/runtime/contract-docs.mjs FULL_40_HEX_COMMIT --from-api
```

`--from-api` writes the same digest/mode record as `--base` for that commit.
It checks the full commit, rejects truncated trees, verifies blob identities
and refuses unavailable commits before any record write. It cannot be combined
with `--base` or `--offline`. Offline recording requires `--base` and reads
only that checkout's existing objects.

`record-base <path> <origin-path> <revision>` takes no repository positional
argument; `--record <file>` selects a record instead of `base-copies.json`.
It records Base bytes and modes, never copies files or accepts local drift.
Use the existing refresh workflow for an already recorded directory; records
must not overlap. Regenerate outputs, inspect the diff, then lock and check.
