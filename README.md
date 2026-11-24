<div align="center">
  <img src="apps/desktop/assets/supahelp-macos.png" width="80" alt="">
  <h1>Supahelp</h1>
  <p>The open-source desktop app for investigating and resolving support cases.</p>
  <p><a href="https://supahelp.app">Website</a> · <a href="https://supahelp.app/download">Download</a> · <a href="#getting-started">Run from source</a></p>
</div>

Supahelp brings your support tools, AI chats, cases, and Playbooks into one desktop app. Connect with your own Claude or ChatGPT subscription or an API key. Review and approve changes before Supahelp writes to a connected tool.

## Features

- **Investigate cases** with connected help desks, issue trackers, and incident tools. Save findings and resolutions in a case document.
- **Build reusable Playbooks** with Markdown, reviewed screenshots, drafts, and publishing.
- **Work locally** with personal chats, cases, and Playbooks saved on your computer. A Supahelp account is optional for personal work. AI requests go to the model provider you choose.
- **Connect your tools** with provider sign-in, an API key, or a custom MCP server or REST API. The full catalog stays visible in Settings → Connections. New connections that are pending provider review are marked there. Some OAuth connections require a free Supahelp account and use the hosted exchange for authorization and renewal.
- **Work with a team** with shared cases and Playbooks, workspace membership, and organization billing. These features use the hosted Supahelp service and a Team plan. This repository contains the desktop app and its shared API contracts.

## Demo

Open the app to take the quick tour through a sample case. You can replay it from the account menu. The tour uses sample data and requires no provider sign-in.

## Tech stack

- **Desktop** · Electron, Electron Forge, and Vite
- **Interface** · React, TypeScript, and Tailwind CSS
- **Local data** · SQLite and OS encryption for credentials
- **AI and tools** · Claude Code, Codex, and the Model Context Protocol (MCP)

## Getting started

### Install the app

The desktop release targets **Apple Silicon macOS** and **Windows x64**. Get the available installers on the [download page](https://supahelp.app/download).

For an ad-hoc signed macOS release, open the DMG and drag Supahelp to Applications. If you already have Supahelp, quit it first and replace the app in Applications. Your existing local profile stays in place. If macOS blocks the first launch, verify the download came from the [official release page](https://github.com/jimmy-jang/supahelp/releases) and follow [Apple’s instructions for approving an app in Privacy & Security](https://support.apple.com/en-us/102445). Install subsequent Mac updates manually while releases use ad-hoc signing.

An unsigned Windows installer may trigger a Microsoft Defender SmartScreen warning. Download the installer from the official Supahelp release page.

### Run from source

1. Clone or download this repository, then open `apps/desktop` in a terminal.
2. Select **Node.js 24**. Use `nvm use` if you use nvm on macOS, or select Node 24 with your Windows version manager.
3. Install dependencies and start the development app.

   ```sh
   npm ci
   npm start
   ```

4. In **Settings → Models**, choose Claude or ChatGPT, then select subscription sign-in or API key. Follow the setup for the installed Claude Code or Codex runtime.

To test account sign-in, Team, billing, or registered OAuth apps, create `apps/desktop/.env.local` with the public client configuration for your build. The [release workflow](.github/workflows/desktop.yml) lists the supported build settings. Restart the development app or rebuild the package after changes. Hosted account, sync, and billing behavior depend on the configured API. Private credentials belong on the server. Source builds check for updates only when built with an HTTPS `SUPAHELP_UPDATE_FEED` configured.

## Contributing

Run `npm run typecheck`, `npm run lint`, and `npm test` from `apps/desktop`. These checks work without hosted credentials. See [Contributing](CONTRIBUTING.md) for the test layout and process boundaries. Report vulnerabilities using the [security policy](SECURITY.md).

## License

Supahelp Desktop is maintained by UnifyIT Limited and licensed under [Apache-2.0](LICENSE). See the [copyright notice](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md) for attribution and branding terms.
