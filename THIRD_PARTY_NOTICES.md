# Third-party notices

Supahelp Desktop is licensed under the Apache License 2.0 (see [LICENSE](LICENSE) and [NOTICE](NOTICE)).
It depends on the third-party packages below. Each keeps its own license; the full text ships in the
package itself (`node_modules/<name>/LICENSE*`). The table is generated from
`apps/desktop/package-lock.json` (runtime, non-dev packages only); regenerate it when dependencies change.

## Items that need a human to read

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, license field "SEE LICENSE IN README.md"): proprietary,
  "All rights reserved", used under Anthropic's [legal agreements](https://code.claude.com/docs/en/legal-and-compliance).
  It is **not** covered by this project's Apache-2.0 license and is not stored in this repository (npm installs it).
  Anyone redistributing a build that bundles it must follow Anthropic's terms.
- **Electron** (MIT) bundles Chromium and other components; their notices ship inside the packaged app
  (`LICENSE`, `LICENSES.chromium.html`).
- **JetBrains Mono** (via `@fontsource/jetbrains-mono`) is licensed under the SIL Open Font License 1.1.
- **MPL-2.0** packages (`lightningcss*`) are build-time only and are not shipped in the app.
- **Third-party logos.** The images in `apps/desktop/src/renderer/assets/connections/` are trademarks of their
  respective owners (Slack, Stripe, Zendesk, Salesforce, and others). They identify an integration and are
  **not** licensed under Apache-2.0. They will be removed or replaced at an owner's request.
- **Supahelp name and logo** (`apps/desktop/src/renderer/assets/brand/`, `apps/desktop/assets/`) are trademarks of the
  copyright holder and are not licensed for use as the name or logo of a derivative product (Apache-2.0 section 6).

## Runtime dependencies (220)

| Package | Version | License |
| --- | --- | --- |
| @anthropic-ai/claude-agent-sdk | 0.3.318 | SEE LICENSE IN README.md |
| @anthropic-ai/claude-agent-sdk-darwin-arm64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-darwin-x64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-arm64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-arm64-musl | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-x64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-linux-x64-musl | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-win32-arm64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/claude-agent-sdk-win32-x64 | 0.3.318 | SEE LICENSE IN LICENSE.md |
| @anthropic-ai/sdk | 1.6.0 | Apache-2.0 |
| @babel/runtime | 7.29.13 | MIT |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 |
| @hono/node-server | 2.1.6 | MIT |
| @modelcontextprotocol/sdk | 1.32.2 | MIT |
| @opentelemetry/api | 1.10.0 | Apache-2.0 |
| @stablelib/base64 | 1.0.1 | MIT |
| @types/debug | 4.1.13 | MIT |
| @types/estree | 1.0.10 | MIT |
| @types/estree-jsx | 1.0.5 | MIT |
| @types/hast | 3.0.5 | MIT |
| @types/mdast | 4.0.4 | MIT |
| @types/ms | 2.1.0 | MIT |
| @types/react | 19.3.0 | MIT |
| @types/unist | 3.0.3 | MIT |
| @types/unist | 2.0.11 | MIT |
| @ungap/structured-clone | 1.4.0 | ISC |
| @workos-inc/node | 12.2.0 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| bail | 2.0.2 | MIT |
| body-parser | 2.4.0 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| ccount | 2.0.1 | MIT |
| character-entities | 2.0.2 | MIT |
| character-entities-html4 | 2.1.0 | MIT |
| character-entities-legacy | 3.0.0 | MIT |
| character-reference-invalid | 2.0.1 | MIT |
| comma-separated-tokens | 2.0.3 | MIT |
| content-disposition | 2.0.1 | MIT |
| content-type | 2.1.0 | MIT |
| content-type | 1.0.5 | MIT |
| content-type | 2.1.0 | MIT |
| content-type | 2.1.0 | MIT |
| content-type | 2.1.0 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| csstype | 3.2.3 | MIT |
| debug | 4.4.3 | MIT |
| debug | 2.6.9 | MIT |
| decode-named-character-reference | 1.3.0 | MIT |
| depd | 2.0.0 | MIT |
| dequal | 2.0.3 | MIT |
| devlop | 1.1.0 | MIT |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| electron-squirrel-startup | 1.0.1 | Apache-2.0 |
| encodeurl | 2.0.1 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| escape-html | 1.0.3 | MIT |
| escape-string-regexp | 5.0.0 | MIT |
| estree-util-is-identifier-name | 3.0.0 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.1.1 | MIT |
| express | 5.3.0 | MIT |
| express-rate-limit | 8.7.3 | MIT |
| extend | 3.0.2 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-sha256 | 1.3.0 | Unlicense |
| fast-uri | 3.1.9 | BSD-3-Clause |
| finalhandler | 2.1.1 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.4 | MIT |
| hast-util-to-jsx-runtime | 2.3.7 | MIT |
| hast-util-whitespace | 3.0.0 | MIT |
| hono | 4.13.16 | MIT |
| html-url-attributes | 3.0.1 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.3 | MIT |
| inherits | 2.0.4 | ISC |
| inline-style-parser | 0.2.9 | MIT |
| ip-address | 10.7.6 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| is-alphabetical | 2.0.1 | MIT |
| is-alphanumerical | 2.0.1 | MIT |
| is-decimal | 2.0.1 | MIT |
| is-hexadecimal | 2.0.1 | MIT |
| is-plain-obj | 4.1.0 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jose | 6.2.15 | MIT |
| json-schema-to-ts | 3.1.1 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| longest-streak | 3.1.0 | MIT |
| markdown-table | 3.1.0 | MIT |
| math-intrinsics | 1.1.0 | MIT |
| mdast-util-find-and-replace | 3.0.4 | MIT |
| mdast-util-from-markdown | 2.1.0 | MIT |
| mdast-util-gfm | 3.1.0 | MIT |
| mdast-util-gfm-autolink-literal | 2.1.0 | MIT |
| mdast-util-gfm-footnote | 2.1.0 | MIT |
| mdast-util-gfm-strikethrough | 2.0.1 | MIT |
| mdast-util-gfm-table | 2.0.1 | MIT |
| mdast-util-gfm-task-list-item | 2.0.1 | MIT |
| mdast-util-mdx-expression | 2.0.1 | MIT |
| mdast-util-mdx-jsx | 3.2.1 | MIT |
| mdast-util-mdxjs-esm | 2.0.1 | MIT |
| mdast-util-phrasing | 4.1.0 | MIT |
| mdast-util-to-hast | 13.2.1 | MIT |
| mdast-util-to-markdown | 2.2.3 | MIT |
| mdast-util-to-string | 4.0.0 | MIT |
| media-typer | 1.1.1 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| micromark | 4.0.3 | MIT |
| micromark-core-commonmark | 2.0.4 | MIT |
| micromark-extension-gfm | 3.0.0 | MIT |
| micromark-extension-gfm-autolink-literal | 2.1.0 | MIT |
| micromark-extension-gfm-footnote | 2.1.0 | MIT |
| micromark-extension-gfm-strikethrough | 2.1.0 | MIT |
| micromark-extension-gfm-table | 2.1.2 | MIT |
| micromark-extension-gfm-tagfilter | 2.0.0 | MIT |
| micromark-extension-gfm-task-list-item | 2.1.0 | MIT |
| micromark-factory-destination | 2.0.1 | MIT |
| micromark-factory-label | 2.0.1 | MIT |
| micromark-factory-space | 2.1.0 | MIT |
| micromark-factory-title | 2.0.1 | MIT |
| micromark-factory-whitespace | 2.0.1 | MIT |
| micromark-util-character | 2.1.1 | MIT |
| micromark-util-chunked | 2.0.1 | MIT |
| micromark-util-classify-character | 2.0.1 | MIT |
| micromark-util-combine-extensions | 2.0.1 | MIT |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT |
| micromark-util-decode-string | 2.0.1 | MIT |
| micromark-util-edit-map | 1.0.0 | MIT |
| micromark-util-encode | 2.0.1 | MIT |
| micromark-util-html-tag-name | 2.0.1 | MIT |
| micromark-util-normalize-identifier | 2.0.1 | MIT |
| micromark-util-resolve-all | 2.0.1 | MIT |
| micromark-util-sanitize-uri | 2.0.1 | MIT |
| micromark-util-subtokenize | 2.1.0 | MIT |
| micromark-util-symbol | 2.0.1 | MIT |
| micromark-util-types | 2.0.3 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| ms | 2.0.0 | MIT |
| ms | 2.1.3 | MIT |
| negotiator | 1.1.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| on-finished | 2.4.2 | MIT |
| once | 1.4.0 | ISC |
| parse-entities | 4.0.2 | MIT |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| path-to-regexp | 8.4.2 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| property-information | 7.2.0 | MIT |
| proxy-addr | 2.0.8 | MIT |
| qs | 6.17.1 | BSD-3-Clause |
| range-parser | 1.3.0 | MIT |
| raw-body | 3.0.2 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| react-markdown | 10.1.0 | MIT |
| remark-gfm | 4.0.1 | MIT |
| remark-parse | 11.0.0 | MIT |
| remark-rehype | 11.1.2 | MIT |
| remark-stringify | 11.0.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| router | 2.2.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| scheduler | 0.28.0 | MIT |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.1 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| space-separated-tokens | 2.0.2 | MIT |
| standardwebhooks | 1.1.1 | MIT |
| statuses | 2.0.2 | MIT |
| stringify-entities | 4.0.4 | MIT |
| style-to-object | 2.0.2 | MIT |
| toidentifier | 1.0.1 | MIT |
| trim-lines | 3.0.1 | MIT |
| trough | 2.2.0 | MIT |
| ts-algebra | 2.0.0 | MIT |
| type-is | 2.1.0 | MIT |
| unified | 11.0.5 | MIT |
| unist-util-is | 6.0.1 | MIT |
| unist-util-position | 5.0.0 | MIT |
| unist-util-stringify-position | 4.0.0 | MIT |
| unist-util-visit | 5.2.0 | MIT |
| unist-util-visit-parents | 6.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| vary | 1.1.2 | MIT |
| vfile | 6.0.3 | MIT |
| vfile-message | 4.0.4 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| zod | 4.6.7 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |
| zwitch | 2.0.4 | MIT |
