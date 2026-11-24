# Desktop architecture

Approved direction (2026-11-06): separate Electron processes, then organize by
feature inside each process. Keep one application package. This was chosen over
technical layers (which scatter feature changes) and full clean/hexagonal
architecture (which adds interfaces before there is concrete reuse).

`AGENTS.md` contains the implementation rules for both Claude and Codex.

## Current folder map

```text
apps/desktop/
├── forge.config.mts             # Main/preload entries and packaging
├── vite.*.config.mts            # Separate build targets
├── index.html                  # Renderer HTML entry
├── tsconfig.json               # Main, preload and build-tool types
├── tsconfig.renderer.json      # Browser types without Node globals
├── src/
│   ├── main/
│   │   ├── main.ts             # Electron entry and single-instance startup
│   │   ├── app/                # Service construction, polling, link lifecycle, auto-update
│   │   ├── ipc/                # Shared trusted-sender checks
│   │   ├── window.ts           # Window creation and renderer/preload paths
│   │   ├── forge-env.d.ts
│   │   ├── features/accounts/  # Identity, workspace transitions, scoped IPC and app links
│   │   ├── features/chat/      # Durable local chat owner and validated IPC
│   │   ├── features/cases/     # Case workflows, SQLite owner/recovery, Undo, IPC
│   │   ├── features/playbooks/ # Drafts/publishing, feature persistence and model tools
│   │   ├── features/pilot-metrics/ # Consent, prospective counts, frozen local export; no telemetry
│   │   ├── features/linear/    # Connection, approvals and durable action receipts
│   │   ├── features/zendesk/   # Zendesk connection, grants and guarded ticket operations
│   │   ├── features/connections/ # Catalog setup/lifecycle/IPC and shared approval receipts
│   │   ├── features/tour/      # Per-computer "quick tour seen" flag and IPC
│   │   ├── integrations/       # Provider adapters; connection-api/ owns provider definitions
│   │   └── platform/           # Preferences, resources, OS-encrypted connection storage, case SQLite store
│   ├── preload/
│   │   └── preload.ts          # Named chat and Claude setup operations
│   ├── contracts/              # Serializable chat and connection contracts
│   └── renderer/
│       ├── renderer.tsx        # React entry
│       ├── App.tsx             # Application composition
│       ├── app/                # Panel/unsaved guards and case-link navigation
│       ├── env.d.ts
│       ├── layout/             # Sidebar and the account menu
│       ├── components/         # Icon, Button, Toggle and Select
│       ├── features/
│       │   ├── accounts/       # One account provider, hooks and real settings UI
│       │   ├── chat/           # Chat UI, main-state subscription, preview hook
│       │   ├── cases/          # Case models, presentation and sorting
│       │   ├── tour/           # First-run tour over a static sample workspace
│       │   └── settings/       # Settings view, page parts and the 8 v1 pages
│       ├── fixtures/           # Made-up conversations, cases and settings
│       └── styles/index.css    # Design tokens and global styles
└── tests/                      # Root regressions, unit/<feature>, support and e2e
```

`ChatView.tsx` renders real chats and clearly labeled preview conversations.
`useConversations` reads main-owned snapshots through named preload operations,
discards stale revisions and never owns provider credentials.
`usePreviewConversations` still owns the example cases (labeled "Example") and the
mock refund; its IDs are rejected by the real chat and case services.

Real cases are main-owned in `cases.db` under Electron userData, using the built-in
`node:sqlite` module. `CaseService` creates one case per idle real chat, checks
every durable text write and stores entries, before/after history and committed
versions atomically. Personal work is scoped to the signed-out profile or the
signed-in account. Team documents use the separate sync path described below.

Phase 2 follows the approved policy/plan.
The maintainers deferred D1's human format experiment and authorized the existing
nine sections as provisional; no section keys were changed and no customer
validation is claimed. `CaseService` is the shared main-side masking/authorization
boundary. Masking is pattern-only (`features/cases/masking.ts`: emails, phones,
card numbers, keys/tokens/passwords and credential-bearing links); it needs no
model and cannot time out. Person names, postal addresses and other customer
text are stored as written. The maintainers removed the model check on 2026-11-18
because its failures blocked saves. Finite fixtures test pattern coverage only.

Schema v2 adds system-owned entry protection and each change's applied version;
its version marks completion of the masking policy. Case reads/tools/export stay
blocked until recovery/migration finishes. A v1 upgrade checks current, deleted,
metadata and historical text in memory, builds a compact replacement, checks
integrity/foreign keys/record identities and checkpoints the old WAL before atomic
cutover. IDs, numbering, ownership, timestamps, ordering, links and history remain.
One temporary OS-encrypted raw `.recovery.enc` snapshot is the approved recovery
exception; it is removed after reopen/validation. Interrupted attempts resume
behind the same access block. OS encryption failure, unknown legacy actor names
requiring identity mapping or invalid legacy data block migration without deleting
records. Legacy history stays visible after migration but has no reliable applied
version, so its Undo refuses with “Changed since. Edit it instead.” Older builds
reject v2. Secure deletion/checkpointing cover active SQLite files, not prior APFS
snapshots, backups or freed disk blocks. Only scratch profiles were migrated in
verification; the user's normal profile was not opened.

The authenticated per-chat `supahelp-case` bridge exposes `read_case`, `add_entry`,
`update_entry` and `remove_entry` only when main has an attached case. Model
arguments cannot select a case/workspace/actor or set system authority. Case text
is untrusted data. Findings need recognized stable evidence references for
Confirmed/Ruled out; otherwise they become Guess. Model Actions can only be
Proposed, and system-owned results cannot be edited/removed/undone. External
actions retain their existing approval and outcome-reconciliation paths.
Capabilities/checks end on Stop, turn completion, account/context invalidation,
disconnect or teardown. Attached-case chats reopen their native session each turn
with text context so old capabilities cannot be reused; case-change messages are
excluded from transcript transfer.

Named IPC is `cases:list`, `cases:create`, `cases:undo`, `cases:markdown` and event
`cases:changed`. Preload exposes corresponding named methods with current context
stamps. Main checks trusted sender, exact inputs, current context and local owner.
Only a committed change ID creates a deduplicated real “Case updated” line with
Undo/View. The panel reuses its change log, freshness and section focus. Undo checks
the permitted actor and exact committed version, affects only that entry and
atomically records restoration/undone state; stale or repeated Undo is refused.
Copy formats the current safely stored case in main. Preview examples keep their
separate renderer state and Example labels.

The Claude adapter uses the Agent SDK with an installed, unmodified Claude Code
executable and the user's subscription or API key. CLI-owned status and native login
replace token-file inspection. Auth-source conflicts fail closed. Each live chat
retains one streaming query for context except attached-case chats as described above; Stop drains the interrupted turn before
another send. Quit/window close cancels and closes owned sessions. Personal chats
use `ChatStore` under the active personal profile. `ChatStore` and `TeamStore` share
neutral `EncryptedStore` encryption/SQLite code, with separate database names
and error codes. Startup verifies and migrates the earlier `chats/team.db` file
using its existing key; missing keys or conflicting database files block migration
without replacing saved history. Messages, titles, options and Playbook selections survive
window close and restart; explicit removal deletes the stored chat. Streaming
updates flush with the existing 40 ms publication throttle, and turn completion
flushes immediately. Interrupted replies reopen idle with their saved partial text;
provider sessions and upload contents remain ephemeral. SDK transcript persistence
is disabled. Non-secret model/executable preferences and connected project paths are saved under Electron userData.

The composer selects a provider model and its supported effort for each chat, with
Ask first / Skip confirmation mapped to the provider permission policy. Built-in
tools remain disabled in both modes; connector changes always require approval.
Changing options starts a new provider session
with the text transcript as context. Prior image contents need reattaching after
a model or settings switch.

Projects combine saved Supahelp folders and available Claude Code / Codex recent
project paths. A project sets the provider working directory; it does not grant
file tools. Codex project instruction loading is disabled. Native picker uploads
are limited to five PNG/JPEG/GIF/WebP images or UTF-8 text/code files, 10 MB each.
Main holds the content in memory, exposes opaque IDs and metadata, and sends
content only on message submission. Removed/sent uploads and closed-window state
are cleared; arbitrary renderer file paths are rejected.

Chat has no built-in tools, user skills or external plugins. With services connected,
Claude and Codex receive only authenticated, per-chat loopback MCP endpoints
for the configured connections.
The published CLI's modules with `path: builtin` remain part of the native runtime.
`--disable-slash-commands`, explicit settings sources and disabled hooks/memory
avoid loading the user's workflow into these chats. This is a capability boundary,
not an OS sandbox. Source validation and controlled transport tests do not establish live provider acceptance.

## Personal case correction

Approved 2026-11-10 under the personal correction plan.
`cases:edit` / `editCaseEntry` adds, updates or removes ordinary personal entries;
`cases:cancelEdit` / `cancelCaseEdit` cancels only the matching human request.
Main validates exact action-specific inputs, trusted sender, current context,
local ownership, UUIDs and expected versions. It derives human origin itself;
model arguments cannot select it. Text saves apply pattern masking and need no
model. Removal and Undo reuse safely stored values.

Both human and model writes use CaseService.edit and CaseStore.writeEntry.
Human changes use existing `by=local` with no `onBehalfOf`; model attribution and
optional metrics definitions remain unchanged. New human adds use a stable request
UUID as entry ID and expected version zero, so retry cannot duplicate a committed
entry. The write transaction rejects IDs belonging to another case before upsert.
System results remain protected. The human editor routes Resolution through the
existing draft/confirm workflow; existing model tools and Undo authority remain.

The real panel uses raw CaseEntry IDs/versions rather than flattened section text
or labels. Empty sections stay hidden behind Add section. A modal editor retains
unsaved candidates in memory through failure/cancel/conflict, requires explicit
review/reload after same-entry changes, and publishes no optimistic mutation.
Account/context changes cancel and clear it. Panel history exposes existing guarded
Undo after transcript loss/restart. Stored Markdown now includes optional text/row
details as well as item details, with the same escaping and headings. Real case
links are hidden until actual routing exists; labeled previews remain separate.

`main/window-close.ts` owns dirty-unload confirmation and closing before quit
cleanup. A veto keeps services alive; confirmed discard cancels pending document
writes before closing. The renderer stores no raw autosave/recovery file. Forced
termination loses unsaved typing. No database schema/version, migration or server
API changes accompany correction: v1→v2 recovery and additive v3/v4 remain intact.

## Local Playbooks and Resolve (Phase 3)

Main owns personal
Playbooks and Resolution drafts in `cases.db` schema v3. The upgrade adds
`playbooks` and `resolutions` transactionally after existing v1→v2 masking/recovery
finishes. It does not rewrite Phase 2 records or change the nine provisional
sections. Earlier builds reject v3. The original v2 masking marker, encrypted
legacy recovery, protected entries and guarded Undo retain their meaning.

`features/playbooks/service.ts` validates local ownership, context, exact content,
versions and image references. Every new durable text draft passes the existing
pattern masking. A saved draft is separate from the published
version; publishing is explicit, preserves prior masked publications as history
and rejects stale versions. Discarding an update retains its publication;
discarding a never-published draft removes that abandoned document. Publication
refreshes native chat capabilities. Five explicitly selected published Playbooks
can be attached to a real chat; their read-only bridge returns text without
images, drafts or filesystem paths. Capabilities end with the turn, context or
session. No automatic matching is implemented in this approved slice.

`features/cases/resolve.ts` stores masked, versioned Resolution drafts without
changing case status. User confirmation checks the exact source case and known
pending/running/unknown external actions, then atomically writes Resolution,
change history, Resolved status and the selected used-Playbook association.
Model case tools cannot set status or publish. Reopen is explicit and retains
Resolution and its history. Generic edits and Undo cannot change the Resolution
section. The panel can draft from the saved case without an active chat. In an
attached chat, the model can save a versioned draft and offer that exact version
for user confirmation. Both surfaces use the same main-owned operation.
Team drafts stay in the case owner's encrypted workspace cache. Online
confirmation rechecks the case owner and source version on the API, which
commits the Resolution entry, audit change and status together. Cases can resume
in a new real local chat after restart without reviving old capabilities.
Chat transcripts persist locally as described above.

`ChatModels.draftDocument` opens a separate bounded tool-free, project-free,
ephemeral session through the explicitly selected existing Claude/Codex adapter.
Fixed document instructions request JSON; services validate the candidate and run
the independent D6 check before storage. Drafting and masking cancel on context,
provider or lifecycle changes. No real inference was used in controlled tests.

`platform/playbook-screenshots.ts` stages PNG pixels in memory. A native picker
accepts one PNG at a time, at most 10 MB, 4096 pixels on either side and 8 million
pixels total; at most five images await review. Main decodes and re-encodes from
pixels, discarding original metadata. Only an explicit Insert screenshot
confirmation allows file storage under private `userData/playbook-screenshots`.
Files use generated document/image IDs; preload returns bounded image data, never
paths. Images never enter model prompts. Changing an image requires another
review; screenshots retained by published history remain available.

File finalization precedes the versioned document-reference commit. A failed text
check preserves the saved document; the same confirmed file can be retried.
Startup removes temporary and unreferenced finalized files. Missing or corrupt
referenced images surface an error and block publication. Cancel/discard clears
staged pixels. Confirmation is the author's judgment, not automated detection,
and source files, backups and filesystem snapshots are not erased.

An optional Resolve note uses the existing Zendesk agent/ConnectionActions path:
fresh ticket version, exact internal-note body and tenant in the chat approval,
durable Pending before acknowledgment, Running before submission, safe_update
and audit verification. The receipt retains main-generated case/resolution IDs;
the resolution records its receipt ID. Pending, uncertain or completed notes for
the same resolution cannot be resubmitted with a different body or timestamp.
Denied/canceled proposals can be proposed again. An explicit Checked outcome decision uses the existing reconciliation path before the user can propose a retry. No note closes a Zendesk ticket,
contains a personal case link or runs merely because the case was resolved.

Named IPC is `playbooks:list`, `saveDraft`, `publish`, `discardDraft`,
`chooseScreenshot`, `confirmScreenshot`, `removeScreenshot`,
`screenshot`, `cancel`; `chat:setPlaybooks`; and `cases:resume`, `draftResolution`,
`confirmResolve`, `reopen`, `draftPlaybook`, `proposeResolutionNote`. Main validates
sender and origin context; `playbooks:changed` snapshots are account-scoped and
team projections stay empty. Existing labeled examples keep their separate
renderer state.

## Local pilot counts

**2026-11-18:** the Settings UI for pilot counts was removed (not running a pilot). Main service, IPC and preload operations remain but are unreachable from the UI; `tests/pilot-metrics.test.mjs` and `tests/unit/ipc/pilot-metrics-ipc.test.mjs` still cover them. `test:pilot-metrics:e2e` was deleted with the UI. Restore the UI from git history before running a pilot.

The user approved the metrics plan
on 2026-11-10. `features/pilot-metrics` owns the personal observation lifecycle and
allowlisted report. The five named `pilot-metrics:get/start/finish/export/delete`
operations carry only the current context; sender, personal scope, generation,
document-operation cancellation and exact input keys are checked in main. Team
contexts reject every operation; signing in does not relabel local counts.

Collection defaults Off. Explicit Start adds one `pilot_metrics` table and its
optional singleton state in a schema-v4 transaction after ordinary v1→v2 recovery
and v3 preparation. Metrics never trigger model checking or bypass blocked legacy
access. Existing cases, entries, changes, links, resolutions and Playbooks are
not rewritten. Earlier builds reject v4; deleting counts does not downgrade it.

The active state stores one numeric personal-case-number boundary and two
publication counters. Case creation/attachment, distinct committed resolutions
and case AI changes/Undo are derived from existing records for new local-owner
cases above that boundary. A changed resolution-derived publication and its
counter commit in the same transaction; failed/stale or semantically identical
publication does not count as an update. No measurement event log, extra record
IDs, timestamps, durations or network operations are added. The 24h subset uses
existing change times and an in-memory observation time; invalid clocks fail
reporting rather than producing zeros. Same-chat reuse, hand corrections,
correctness, escalation reduction and resolution time are not established.

Finish atomically freezes ten counts and removes the boundary; repeated exports
use the frozen report. Delete removes only observation state, preserving source
documents and already exported files. Consent continues across restart until
Finish/Delete, and a finished report remains until Delete. The renderer adds one
real group in Privacy & data with explicit consent, definitions, Refresh, Finish,
native export and confirmed deletion. It uses context/unmount/busy guards.

Native export serializes only the validated counts and fixed versions, writes an
exclusive private adjacent temporary file and atomically renames after a final
context/observation guard. Paths stay in main memory. Handled failure cleans the
temporary file; hard interruption can leave a counts-only temporary beside the
chosen destination. SQLite rollback/reopen handles database interruption; no raw
case backup or persistent export-path journal is added.

## Linear connection and execution

Settings > Connections uses Linear's official remote MCP with browser OAuth,
dynamic registration, state validation and PKCE. Read-only uses the dedicated
`https://mcp.linear.app/mcp/readonly` endpoint; read/write uses `/mcp`. Tokens,
client registration and action receipts are atomically stored in `linear.enc`
using Electron safeStorage's asynchronous OS encryption. Linux's plaintext
fallback is rejected. Disconnect deletes local credentials; vendor-side
revocation remains available in Linear. One app instance owns each profile.

Main discovers tools and supplies each chat with a separate random bearer token
for its loopback MCP bridge. Provider processes receive this limited capability,
never Linear credentials. Only the trusted main renderer can manage connections
or decide an approval. Changing a connection cancels sessions and stale bridge
capabilities; the next turn transfers text context into a fresh provider session.

Read-only annotations from the official server identify reads. Unclassified tools
require approval in read/write mode. Main validates tool inputs, persists the
exact pending action, waits for the user's decision, rechecks the active
connection, and persists Running before calling Linear. Stop, disconnect, window
close and quit cancel outstanding work. An interrupted submitted write becomes
Outcome unknown and cannot be repeated with the same tool/inputs until the user
checks its outcome. Restart recovers Running as Outcome unknown and cancels old
pending approvals. Receipts remain visible in Connections even after chats close.

Issue create/update/save operations are read back through `get_issue` when the
server returns a usable issue ID and the tool is available. Verified means the
returned issue and supplied fields matched. Other successful operations are
labeled Linear responded; missing checks and uncertain outcomes are explicit.
The current connection supports one authorized workspace at a time. Identity is
shown only when the server's optional `get_user` lookup provides it.

Validation commands, after `npm run package`:

- `npm run test:linear:e2e`: real Electron renderer/preload/IPC, OS encryption,
  OAuth/PKCE, MCP and controlled external Linear/model servers; no live account.
- `npm run test:linear:runtimes`: installed Claude and Codex MCP discovery with a
  controlled Linear server; no inference request.
- `npm run test:packaged`: production main/preload/renderer loading checks.

## Zendesk connection and shared execution

Zendesk uses its official REST API with a public OAuth client, PKCE and state
validation. Credentials are OS-encrypted in `zendesk.enc`; no API token or client
secret is requested. The registered redirect is
`http://127.0.0.1:49153/oauth/zendesk/callback`. Setup requires a Zendesk workspace
and an admin-provided public client ID, or the public ID configured through
`SUPAHELP_ZENDESK_CLIENT_ID`. Zendesk approval for a global OAuth client is still
required before distribution to multiple customers; local clients are for
internal workspace development/testing. No global registration is provisioned
by this code.

The first API surface covers ticket search, ticket reads, comments, public
replies, internal notes and status changes. Requested scopes are `tickets:read`
and `users:read`, plus `tickets:write` for changes. Settings shows the returned
grant, actual account/role, workspace and available operations. The API continues
to enforce current role and ticket permissions. Token refresh is serialized and
rotated credentials are persisted before any waiting request can use them.

`features/connections/actions.ts` now owns the approval and execution logic used
by both connectors. `platform/connection-store.ts` supplies their existing atomic
OS-encrypted storage format; Linear's `linear.enc` format and credentials remain
compatible. `integrations/connector-agent.ts` exposes separate named, per-chat
capabilities to each provider. Both providers can use both services in one chat.

Zendesk writes include a mandatory version stamp and `safe_update` to reject
concurrent ticket edits. Public replies and internal notes have separate tools;
the author is the connected user. After submission, status is read back from the
ticket, and comments are checked against the exact returned audit ID, body and
visibility. A stored public reply is not proof of email delivery. No write is
automatically retried. Uncertain identical effects stay blocked even when a new
version stamp is supplied. Receipts retain workspace/account context across
disconnects and workspace switches. Redirects are rejected and credentialed API
requests are limited to the configured canonical `*.zendesk.com` tenant.

`test:connectors:e2e` and `test:connectors:runtimes` cover both connectors; the
older `test:linear:*` commands remain compatible. External services are controlled
fixtures for write tests. Production registration, real consent/live writes,
Windows/Linux and signed distribution are separate checks.

Forge's Vite plugin bundles runtime dependencies. Main keeps `main.cjs`, and its
Vite configuration translates `import.meta.url` to the CommonJS file URL so the
SDK's module-relative require works in development and inside app.asar. The native
smoke check loads the actual emitted SDK chunk to catch packaging regressions.

## Catalog setup and execution

The other 31 catalog entries use `features/connections/service.ts` and named
`connections:*` IPC. `integrations/connection-providers.ts` owns provider endpoint,
region, setup field and capability facts. Eighteen use the installed SDK's remote
MCP transport; thirteen use bounded REST operations. The renderer receives public
form definitions, status, tool schemas and receipts, never stored credentials.
`ServiceConnection` preserves the browse/detail layout and supports provider guides,
browser sign-in, credential entry, cancellation and reviewed custom read tools.

Credentials and receipts are atomically encrypted under
`userData/connections/<catalog-id>.enc`. Linear and Zendesk keep their existing
files and implementation. Customers supply their own registered app details when
required. Native OAuth uses state, PKCE where supported, and a registered loopback
callback, normally port 49154. HTTPS-only returns can be pasted back into the
pending sign-in, with exact destination/state and one-use checks. Provider acceptance
of the registered redirect remains an offline setup check; no TLS listener or
hosted callback service is included. Refresh rotation is serialized and waiting
requests cannot use credentials before persistence succeeds.

Known MCP clients filter the discovered capability surface; generic execution
tools are excluded. Custom MCP tools initially require approval. A user-reviewed
read grant is bound to the input schema hash and invalidated by a changed schema.
Custom REST setup defines explicit method/path/schema/classification entries,
pins requests and credentials to the chosen origin and refuses redirects. It has
no universal identity probe: Settings says when only configuration has been saved.

Both model providers receive the same per-chat controlled tool bridge. Changes
reuse `ConnectionActions`; Stop/disconnect/quit cancel pending work, stale
capabilities fail, and uncertain effects cannot be retried silently. Front sends
include the fetched draft body/recipients/version in the approval and re-read it
immediately before sending. Front's send tool has no atomic version condition, so
edits between that check and remote execution remain a vendor limitation.

Stripe uses restricted-key REST with explicit Test/Live selection and constrained
billing tools, rather than a generic API-write tool. Refunds, cancellation,
single-item fixed-price changes and invoice-balance credits recheck identity,
customer, mode and applicable amounts/currency. Every write has a persisted
idempotency key; uncertain duplicates compare the effect independently of that
key. Supported results are independently read back. Plan changes have no immediate
proration; metered, transformed-quantity, scheduled and multi-item plans require
a separate implementation. Other successful provider writes are labeled as
returned results, not independent verification or message delivery.

## Growth without a new framework

Add `main/features/<feature>/` for real workflows, `main/integrations/` for concrete
AI/tool clients, and `main/platform/` for storage, credentials and workspace access.
Create `src/contracts/` when defining the first real preload/IPC API; do not move
preview models there simply because multiple React components use them.

A main-side feature can start with `service.ts`, `ipc.ts` and a meaningful test.
Introduce a repository or an interface only when persistence or substitution
actually requires it. Matching main/renderer feature names are allowed: the two
folders own different sides of a process boundary. Sharing a feature name does
not permit importing the implementation across that boundary.

For real operations the flow is:

```text
React UI -> named preload method -> validated IPC handler -> feature logic
                                                         -> integration/storage
React UI <- progress/result through the preload bridge <---+
```

Preload is an isolated script inside the renderer process, not a third process.
Main owns real authorization and durable execution state. Closing or rerendering
a UI component must not lose the record of an operation already submitted.

## Checks and limits

Oxlint rejects Node builtin imports in renderer/preload/contracts and direct
imports across process implementations. Contracts also reject React and Electron
imports. The regression tests prove both accepted imports and rejected imports.
Separate TypeScript configurations stop browser code relying on ambient Node
globals and keep browser globals out of main/build code.

These are development guardrails, not a security sandbox or a complete proof of
runtime authorization. Review dynamic code loading, new aliases/dependencies and
bridge capabilities explicitly. When adding Node-based tests, keep them out of
the renderer's browser type environment.

Entry source paths can move without changing emitted filenames. Forge still
produces `.vite/build/main.cjs` and `.vite/build/preload.cjs`; `package.json` and
`main/window.ts` refer to those outputs. The root `index.html` points at
`src/renderer/renderer.tsx`. Verify both development and packaged loading after
changing any of these paths.


## Account service and process boundary

The optional hosted Supahelp service (account, team sync and billing) is a separate, proprietary server that is not part of this repository. This repository contains only the client side: the shared wire types and pure onboarding validation in `packages/contracts`, and the desktop code that calls the service. The server is authoritative for identity, organization membership, workspace roles, seats and subscription entitlements; the desktop never grants access or paid features by itself.

Electron main owns AuthKit public PKCE, protected refresh credentials, the pinned HTTPS client and the account controller. Preload exposes named operations only. `AccountProvider` publishes main snapshots and remounts feature UI on context generation changes; feature hooks discard mismatched context even when revisions are newer. `useAccount` is exported alongside the provider to keep one context owner. Settings and the switcher derive from the same snapshot. Main rechecks generation/ownership around IPC, model/session creation and tool calls. Projection revisions include ownership changes even when a provider's source revision has not changed.

The main Vite build embeds only the public account API origin and WorkOS client ID from `apps/desktop/.env.local`; packaged Finder launches can use them without shell variables. A launcher override must supply the complete pair. Server credentials are never build inputs or renderer configuration.

Account switches call existing chat cancellation/bridge closure without deleting personal transcripts/cases. OS-encrypted `local-access.enc` associates local provider/connector grants with an account or anonymous personal use. Reconnect blocks old ownership before contacting the provider and binds only a successful, current attempt. Another account sees a disconnected projection and cannot approve prior receipts; uncertain outcomes remain durable and still block duplicate writes. Personal connections follow the account across Personal and Team workspaces. Team members do not share connector credentials.

The account and sync client reads only public configuration.

## Personal settings and unsaved Playbooks

Personal API keys use `platform/model-credentials.ts`, reusing `ConnectionStore`
with the main-owned OS encryption service. Records bind one provider credential
to a Supahelp account or anonymous local use. The named `models:api-key` IPC
validates before changing ownership and returns no key. Existing Claude/Codex
adapters consume the selected credential: Claude through a filtered subprocess
environment and separate API config directory; Codex through stdio login with
ephemeral runtime credential storage. Settings exposes authentication and billing
explicitly, with no fallback. Connection changes close chat sessions; account
invalidation also closes catalog/authentication processes and rejects late saves.

General, Notifications and Privacy describe implemented behavior rather than
preview controls. Models exposes the existing Claude Code/Codex setup operations;
new document text requires the selected provider for the isolated masking check.
The Playbook panel holds unsaved candidates in memory, guards user navigation and
uses the existing renderer unload/main close confirmation. A record version change
or removal does not overwrite a dirty candidate; stale saves are blocked. Saving
freezes editing until the existing checked operation completes. Voluntary context
switches prompt, while main's externally imposed context invalidation remains
authoritative and clears the old renderer tree. No unmasked recovery file, schema
change or sync behavior is introduced.

## Team content sync source (2026-11-13)

`main/features/sync` coordinates named team document operations, authorization-before-replay, transactional cursors and cache invalidation. `platform/team-store.ts` encrypts complete payloads before SQLite writes with per-account/workspace OS-wrapped keys; it never adds team rows to personal `cases.db`. Existing case and Playbook services route by validated context. `platform/account-cache.ts` supplies OS-protected offline account selection only for the matching retained AuthKit subject; the team lease remains authoritative for cached content.

The hosted service side of sync (storage, maintenance, backups) is proprietary and not in this repository.

## Build configuration

The main Vite build embeds the public account origin, AuthKit client ID,
connector registrations, and an optional HTTPS `SUPAHELP_UPDATE_FEED`. The
[release workflow](../.github/workflows/desktop.yml) lists the variable names
and sets the official macOS and Windows update feed. Source builds default to
local personal work. To opt in to a feed, set it in an ignored
`apps/desktop/.env.local` before packaging.

The connection catalog carries provider review status to the settings and
onboarding screens. Pending providers remain discoverable, and the app keeps
setup unavailable for new connections until review is complete.


## Refactor implemented 2026-11-16

The approved design
and execution record
retain process boundaries and concrete feature modules.

- `main/app/bootstrap.ts` constructs production services; `account-polling.ts`
  and `links.ts` own polling/links. `platform/os-encryption.ts` is reused by
  production and controlled native harnesses. Each entry retains its explicit
  transport/configuration boundaries; there is no production test mode.
- `main/ipc/trusted-sender.ts` owns exact sender/frame/location checks. Feature
  request validation no longer imports another feature's IPC registration.
- `integrations/connection-api/` separates provider configurations, operation
  helpers and Stripe mutations/readback from common authenticated transport.
- `features/chat/document-inference.ts` owns isolated masking/drafting sessions
  and cancellation. Chat tool assembly retains its single session/context owner.
- `features/cases/store.ts` owns the existing personal DB and migration/recovery.
  `features/playbooks/store.ts` receives the active connection rather than a
  captured connection that could become stale after cutover. Cases and Playbooks
  still share transactions. Pilot counters stay with their atomic database owner.
- Case-list graph reads use bounded batched queries. Sync projections read the
  encrypted queue once and compute pending-document membership once per view.
  Snapshot shapes remain unchanged; list/detail APIs and workers need evidence
  before introducing additional contracts or concurrency.
- `renderer/app/` owns document-panel navigation and deep links. `Composer.tsx`
  serves both new and existing chats. Playbook editing/unsaved guards live in
  `usePlaybookEditor.ts`; screenshot review is separate presentation.
- API feature folders own concrete workflows/routes; `app.ts` composes middleware
  and routes in the existing order. Sync authorization/validation and collaboration
  queries have separate owners and retain existing transaction clients/locking.
- `packages/contracts` contains shared wire declarations and ordinary JavaScript
  onboarding validation. Desktop-specific IPC interfaces remain local. The API
  has no runtime or type dependency on desktop source.

Run the desktop's recursive `npm test` for offline regressions. API `npm test`
runs offline tests; `npm run test:integration` requires an explicitly disposable
local `TEST_DATABASE_URL`. Cross-application sync/collaboration tests belong to
that integration suite. Native/Electron and external tests remain separate.

The local contracts package is installed as files with npm `install-links=true`.
The API `npm pack` archive bundles production dependencies and limits its files
so a deployment artifact does not need desktop sources or environment files.
A source checkout install still needs `packages/contracts` alongside the API.
