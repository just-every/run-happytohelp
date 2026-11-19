# HappyToHelp public docs follow-up

Run Edit Run fleet, 19 November 2026

Repository: just-every/run-happytohelp  
Branch: cloud/hh-docs-1  
Product head: d845c2095b61a69df817205a43b612b0c8ec01f3  
Parent: 16ebc0161ae95d337ef9a2d1f4712a5b71e8dfd5

## Plan and results

1. Enumerate every page in the published docs manifest, including the hidden installation reference. Then check the article, header, footer and navigation sources for links to the retired public contact page. The base already contained zero matches across its 39 published Markdown sources and there was no Contact entry in the shared navigation or footer. Added the existing app Help Center’s **Contact support in chat** guidance in Agent Door, Getting Started, Managed Conversation Mail and Support Channels. The homepage, application routes and live site are outside this source change.
2. Mark the installer’s source-development instructions as a contributor checkout. Keep the existing Node and pnpm pins and use the repository’s describe and check scripts after its frozen install. Apply the same distinction in the README and make the prerequisite for the setup guide’s existing scripted commands explicit. The installation reference’s other sections retain their original bytes.
3. Extend the existing public-browser docs journey. At 1440 px it checks the complete rendered document of every manifest route for the retired contact URL and checks the rendered install article for checkout-only commands outside a contributor checkout section. The test covers link destinations and command placement without pinning guide wording. Read the five changed guides from the emitted application at 1440 px and 390 px for the packet.
4. Regenerate the source lock following the repository command, check the committed tree, and keep the checkout to a single parent and single product commit. Record the commands, exit codes and CI conclusions in the accompanying receipts.

## Counts and claims

- The manifest has 39 published docs routes before and after. The amended public-browser test file has three registrations before and after.
- The contract records 4 Done, 71 Partial and 16 Missing across 91 clauses before and after. Core is 4/71/11 (86 total), Agent surface is 0/0/5 (5 total), and Later is 0/0/0.
- PUBLIC-005 and NATIVE-001 remain partial. There are no contract, generated view or status changes.

CLAIM PUBLIC-005 PARTIAL points=none tests=tests/journeys/public-browser.mjs#a new owner finds the source and installation guide from the public product page, and recovers from a missing documentation page

CLAIM NATIVE-001 PARTIAL points=none tests=tests/journeys/public-browser.mjs#a new owner finds the source and installation guide from the public product page, and recovers from a missing documentation page

## Publication and Verify

The guarded push published the single product commit on the named branch on its first attempt. Verify run 44622363158 completed successfully on the exact product SHA. All eight shards, the contract-docs check, the size check and the final Verify gate passed. The slow and nightly jobs were skipped by their existing push-tier conditions. The run lasted 25 minutes and 48 seconds. CI.json records all 16 job conclusions.

The branch had no PR. The publication scan and landing are fleet-side gates.
