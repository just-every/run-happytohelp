# Scoped implementation notes

Run Edit Run fleet · 2026-11-17

- D1/D24 reuse WebsiteAddress on the Code and Settings tabs. A changed address disables every installation-code Copy control until saving; the developer email includes the saved address. Developer syntax is collapsed. The address field preserves the native widget options.
- D2 stores one recent rejected address using existing project settings, throttled to one diagnostic write per five minutes. A signed-in workspace administrator confirms an approval. Additional approved addresses are stored separately from the primary address, with shared checks in CORS, widget settings/session admission, legacy resolution and conversation sockets. The Settings field exposes their removal. Anonymous or foreign owners cannot approve addresses. A public contact-only endpoint exposes no session or widget configuration.
- D3 saves the signed-in person’s customer-facing name, without changing their email, password or time zone. A placeholder is never pre-filled. Real names are pre-filled. The native Profile page retains optional photo upload. The launcher always uses the bubble icon. The header names an actual reply author; system notices do not impersonate a person, and only AI replies carry an AI label.
- D17 replaces the unavailable local request form with a chat route. The reusable local-mail banner appears on staff Widget and request-form settings.
- D19 reuses the existing alias table and authorized alias save route. It suggests a readable address from the actual workspace name and saves explicitly. Existing aliases remain in use. The Knowledge list and article editor use labelled links rather than workspace IDs in prose.
- D23 retains the required-email admission rules. The initial panel has a plain ask, cannot be dismissed while required, and Send reports the required-email error before admitting a message.

Truthfulness adjustment: “Chat only works on this site” is reduced to “Chat works on this site and your other allowed addresses” when the workspace has explicitly approved additional addresses. “Saving replaces the previous address” then also explains that the additional addresses stay. The real browser journey confirms admission on both addresses after approval.

No migration, release metadata, pins, Base refresh, CONTRACT.md clause judgments, generated acceptance views or sibling-page design changes are part of this candidate. The new name step wraps Setup without editing its counter or observation/confirmation code.

The Inbox diagnostic lives outside its screen-reader-only title. A measured notice height keeps the inbox panes and mobile conversation below the visible notice. The browser checks that the approval control is the actual hit target, then cancels its Inbox confirmation before testing approval in Setup.

The retained public-route fixture now explicitly configures the existing synthetic mail edge, like the configured-mail browser fixture. Its form/template, email verification and tenant assertions remain intact. Local email-off chat behavior is separately covered by owner-installation and local portal browser proofs. No production behavior is changed by this fixture follow-up.
