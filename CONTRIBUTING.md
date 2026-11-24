# Contributing

Thanks for helping. Please read [AGENTS.md](AGENTS.md) first: it is the single source for architecture and verification
rules (human and AI contributors alike), including the folder map.

## Set up and check your change

Use Node 24. From `apps/desktop`:

```sh
npm ci
npm run typecheck
npm run lint        # `npm run lint:fix` formats
npm test
```

CI runs these checks on macOS, Linux and Windows. The Windows offline test run is
informational while POSIX-specific fixtures are being migrated. Add a meaningful
test for new logic under `tests/unit/<feature>/`.

## Ground rules

- Keep changes small and focused. Open an issue first for anything large or that changes how the product looks or behaves.
- Preserve the process boundaries (main / preload / renderer) and the lint rules that enforce them.
- Never add server keys, tokens, real customer data or private URLs. Test fixtures must be synthetic.
- Never automate real provider (Claude/ChatGPT) subscription login or inference in tests. Harnesses set
  `SUPAHELP_DISABLE_SUBSCRIPTIONS=1`.
- Personal data must stay local unless the user explicitly shares it; do not add client-side switches that unlock paid or
  team features. The hosted server is authoritative for access.
- UI changes follow [DESIGN.md](DESIGN.md).

## Licensing of contributions

This project is licensed under Apache-2.0. By submitting a contribution you agree it is licensed under the same terms
(Apache-2.0 section 5), and you confirm you have the right to submit it. Sign off your commits (`git commit -s`) to say so.
