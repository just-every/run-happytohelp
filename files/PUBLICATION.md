# Publication boundary

The product clone was deepened to full history with `git fetch --unshallow origin` before publication preparation. There is no supported publish-check.sh or public_hygiene.py in the shipped launcher, fleet tools or product repository. No other repository is authorized for clone/write, and no remote scan was claimed.

REMOTE-NEEDS-LOCAL: run the supported Base publish-check.sh against the exact full-history candidate https://github.com/just-every/run-happytohelp#cloud/hh-delta-lapse-fix-1 before landing. Cloud identity/trailer and diff checks supplement but do not replace the fleet publication scan. No permission to bypass publication scanning is inferred.

Product branch contains only the delta importer fix and regenerated source lock. Reports and receipts remain outside the product tree and are explicitly selected for a separate evidence ref. The exact tree diff and unpublished commit messages are reviewed before product push. Fleet identity and active cleanup hooks are preserved; no OpenAI/Codex co-author trailer is added.
