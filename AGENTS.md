# Supahelp Desktop

These rules apply to both Codex and Claude. Read this file before changing the
project. `CLAUDE.md` points here so architecture rules have one owner.

## Product and design

- Read `DESIGN.md` before UI work. Preserve its tokens, layout, accessibility and
  light/dark behavior. Ask before departing from the design.
- New chats can use personal API keys or native Claude subscription login. Native
  ChatGPT subscription authentication is local-only.
  Example chats, cases, tool results and refunds
  are previews. Do not treat preview approval state as authorization for a real
  operation.
- Linear and Zendesk connections configured in Settings and their real-chat approval receipts
  execute through main-owned logic; keep them separate from preview actions.
- The hosted Supahelp server and website are proprietary and live outside this repository. Do not
  add their source, credentials or dependencies here.

## Architecture: processes, then features

Read `docs/architecture.md` for the folder map and rationale. Keep one application
package under `apps/desktop`, using Electron Forge + Vite + React + TypeScript.

- `src/main/`: Electron lifecycle, windows and privileged operations. Keep
  `main.ts` as the entry, `main/app/` as concrete composition/lifecycle wiring,
  and shared sender checks under `main/ipc/`. Add business workflows under `main/features/<feature>/`,
  provider clients under `main/integrations/`, and shared storage mechanisms,
  credentials and local workspace access under `main/platform/`. Feature-owned
  persistence stays with its feature. Cases own the existing SQLite connection
  and migration lifetime; Playbook persistence uses that same active connection.
- `src/preload/`: a thin `contextBridge` API. Expose named operations, never raw
  IPC, unrestricted filesystem access or unrestricted command execution. Keep
  business logic out. Sandbox preloads have limited Node access; the current lint
  policy prohibits Node builtin imports here. Review any required exception.
- `src/renderer/`: browser-only React code. Put feature UI, hooks and local models
  under `features/<feature>/`; application layout under `layout/`; reusable UI
  under `components/`; tokens and global CSS under `styles/`.
- `src/contracts/`: create when an actual IPC boundary needs request, response or
  event definitions. Keep them serializable and independent of React, Electron,
  Node and process implementations. Renderer-only models stay in their feature.
- `packages/contracts/`: neutral desktop/API wire types and pure onboarding
  validation. Keep desktop bridge interfaces and context lifecycle types in the
  desktop. No Node, Electron, React, environment, secrets or implementation imports
  in the neutral package. Its runtime is ordinary JavaScript with declarations,
  so standalone Node 24 does not need TypeScript stripping inside node_modules.
- `src/renderer/fixtures/`: preview records and canned tool/model results. Keep
  the preview state hook explicitly named `usePreviewConversations`. Replace this
  path when real main-owned state is implemented; do not build real persistence
  or credentials into it.
- Main, preload and renderer must not import each other's implementations.
  They communicate through the preload API and IPC using shared contracts.
  Feature modules within one process may import each other's explicit exports;
  avoid cycles and move a helper only when it has a real shared responsibility.
- Keep `App.tsx` focused on composition and navigation. Keep real IPC handlers
  thin: validate sender and input, call feature logic, return a defined result.
- Main-side feature logic owns durable state and real approvals. Validate exact
  target/effect and current permissions at execution; reconcile uncertain remote
  outcomes before retries. UI state is not proof an action is allowed or verified.
- Preserve context isolation, sandboxing and disabled renderer Node integration.
  Never put tokens or secret-bearing clients in renderer code or IPC responses.
- Use asynchronous I/O. Move CPU-heavy work to workers and isolate substantial
  or crash-prone runtimes when needed. A worker/utility process is not by itself
  a sandbox for untrusted commands. Define cancellation and quit behavior when
  introducing background work.
- Create folders when they gain code. Do not add empty feature scaffolds,
  generic service/repository frameworks, dependency injection containers,
  barrel exports or shared packages without a concrete need.

## Verification

Use Node 24 (`apps/desktop/.nvmrc`). From `apps/desktop`:

Never automate real provider subscription login or subscription inference. Native
and real-provider test harnesses must set `SUPAHELP_DISABLE_SUBSCRIPTIONS=1` before
loading application code. Mock subscription flows may be tested with controlled
fixtures. Opt-in real inference tests may use API keys only; do not copy existing
subscription credentials into a test profile or override this guard.

- `npm start`: run the development app.
- `npm run typecheck`: check main/preload/build code and browser code separately.
- `npm run lint`: check imports and formatting. Process boundary rules live in
  `.oxlintrc.json`; do not disable them to work around a misplaced file.
- `npm test`: recursive offline regressions, with subscription guards enabled.
  Unit policy doubles in `tests/support/subscription-policy.mjs` apply only to
  controlled synthetic provider fixtures; never import them into native harnesses.
- `npm run package`: build the packaged app.

Group affected offline tests under `tests/unit/<feature>/`; keep whole-app tests
under `tests/e2e/` and shared fixtures under `tests/support/`. Existing root tests
remain discovered recursively and can move with their next feature change.
Add meaningful checks for new logic.
When moving entry files, update imports, Forge entries, the HTML renderer entry
and affected documentation together. Preserve distinct output filenames
`main.cjs` and `preload.cjs`, and check packaged renderer/preload loading as well
as development startup. Report source checks, runtime checks and OS coverage
separately; do not claim an unperformed check.

For shared UI changes, trace every caller and verify each user entry point in
the actual application. Chat composer changes must cover both New chat and an
existing chat. Component fixtures alone do not establish that the feature is
wired into those screens. Before reporting a visible change as ready, identify
the build being checked (development or packaged) and state explicitly when the
user's packaged app still needs a rebuild.

## Hosted service boundary

The optional hosted Supahelp service (accounts, team sync, billing) is a separate proprietary
server that is not in this repository. The desktop keeps only the client side: authentication
(public PKCE), public configuration, the HTTPS client, shared wire types and team sync.

- The personal workspace must stay fully usable with no Supahelp account and no server. Signing in
  or joining a team must never upload personal chats, cases, Playbooks or screenshots on its own.
- The server is authoritative for membership, roles, seats and subscription entitlements. Client
  code must treat server answers as the only proof of access; never add client-side switches that
  grant paid features.
- `packages/contracts/` holds the neutral wire types and pure onboarding validation shared with the
  server. Keep it free of Node, Electron, React, environment, secrets and implementation imports.
  Maintainers keep the server's copy identical to this one; this repository is the source of truth.
- Keep server keys and database URLs out of the desktop and renderer. Only public values (API origin,
  public client IDs) may be build inputs; see [Build configuration](docs/architecture.md#build-configuration).
- AI provider credentials and inference stay on the user's machine. Never route them through the
  hosted service.
- `npm install` uses `install-links=true` (`apps/desktop/.npmrc`) so `@supahelp/contracts` installs
  as real files. Install from the checkout with `packages/contracts/` present.
- Some e2e smokes (`test:accounts:e2e`, `test:onboarding:e2e`, `test:sync:e2e`,
  `test:collaboration:e2e`) fork fixtures from the private server checkout at `../supahelp-api` and can only
  be run by maintainers. `npm test` and the other scripts do not need it.

## Browsing and collaboration

- Preserve unrelated work. Do not commit, push or deploy unless requested.
- For Claude skill references, Read/Grep/Glob map to shell reads/`rg`; Write/Edit
  map to `apply_patch`; Bash maps to shell execution. Run delegated tasks
  sequentially in the main thread. Batch independent tool reads when possible.
