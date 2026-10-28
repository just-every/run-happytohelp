# Source authoring proof boundary

**Gap:** The authoring CLI and source-integrity checks exist and the capability graph is maintained.

`tests/helpers/installer/edition-authoring.mjs`, editionAuthoringJourney, runs inside the existing release-artifact test in `tests/journeys/installer.mjs` (Verify runtime-and-identity shard).

It exercises CLI origin, local drift and executable-mode refusals, selected licensed release, excluded local credentials/private fixtures, clean-source refusal and receipt verification.

Source integrity does not assert a product build or deployment; exact-SHA Verify remains required.
