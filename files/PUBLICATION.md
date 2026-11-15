# Publication custody

Run Edit Run fleet, 2026-11-15 UTC.

NOT RUN in cloud: the requested supported publish-check.sh is absent from the launcher, fleet tools and product checkout. A read-only lookup using `gh api repos/runeditrun/base/contents/scripts/publish-check.sh --jq .content` returned HTTP 404, including all four bounded retries after launcher bundle refresh (15, 45, 90 and 150 seconds). The same approved decrypted-bundle credential helper was restored after each refresh; no other credential was sought. See publication-door-lookup.log.

The frozen rer package contains the maintained publish-check.mjs, but the brief specifically requires publish-check.sh; no substitute or hand-rolled scanner was run and no COMPLETE/PASS result is claimed. The cloud adaptation says the fleet performs the publication scan before landing. That required scan and the independent migration/data gate remain fleet custody. No main/default branch push or landing is authorized here.
