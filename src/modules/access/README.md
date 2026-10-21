# Access

Workspace roles beyond the membership's base role (`memberships.role` stays
owner, admin or operator so older archives restore unchanged):

- `catalogue.ts`: the permission keys, what each built-in role holds, and
  `customPermissions` (a custom role only narrows its base).
- `member_roles` holds the collaborator role (on an operator membership) or a
  custom role id from `project_roles`.
- `route-permissions.ts`: the permission every mutating door needs, keyed by
  `METHOD registered-path`. `gate.ts` applies it from `requireActor` for anyone who
  holds a collaborator or custom role anywhere; built-in roles keep the handlers'
  own checks. A collaborator is refused any mutating door the table does not
  classify, and `tests/journeys/identity.mjs` fails while one exists.
- `assign.ts`: role changes (step-up, last-owner protection, audit).
- `routes.ts`: Settings → Roles and conversation follow.

Collaborators cannot reply by email either (`integrations/inbound-authority.ts`), never count as online for
presence-based away (`reply-sql.ts` is the shared rule),
and a delegated reply needs the operator's reply permission at send time
(`src/edition/local-computer.ts`). Tests: `tests/journeys/identity.mjs`,
`tests/journeys/identity-browser.mjs`.
