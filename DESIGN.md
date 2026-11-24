---
# gstack: design-md-format=spec
name: Supahelp Desktop
description: Quiet, native-feeling desktop work tool. Neutral greys and ink, almost no colour; amber appears only when Supahelp needs you.
colors:
  canvas: "#FAFAFB"
  sidebar: "#EFF0F2"
  surface: "#FFFFFF"
  sunk: "#F2F3F5"
  line: "#E3E5E8"
  primary: "#111316"
  on-primary: "#FFFFFF"
  text: "#111316"
  text-muted: "#5B6068"
  text-faint: "#969BA3"
  attention: "#B4690E"
  attention-soft: "#FBF1E2"
  busy: "#4C6A92"
  busy-soft: "#EAF0F7"
  success: "#2E7A55"
  success-soft: "#E5F2EA"
  error: "#B83A2E"
  error-soft: "#F9E7E4"
  dark-canvas: "#151618"
  dark-sidebar: "#1C1D20"
  dark-surface: "#222327"
  dark-sunk: "#2A2C30"
  dark-line: "#33363B"
  dark-text: "#ECEDEF"
  dark-text-muted: "#A3A7AE"
  dark-text-faint: "#6C7078"
  dark-primary: "#ECEDEF"
  dark-on-primary: "#151618"
  dark-attention: "#E3A247"
  dark-attention-soft: "#3A2C15"
  dark-busy: "#8DA9CF"
  dark-busy-soft: "#1F2A38"
  dark-success: "#5FB98A"
  dark-success-soft: "#18301F"
  dark-error: "#E07A6E"
  dark-error-soft: "#3A1D19"
typography:
  heading:
    fontFamily: -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif
    fontWeight: 600
    fontSize: 20px
    letterSpacing: -0.01em
  title:
    fontFamily: -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif
    fontWeight: 600
    fontSize: 15px
  body:
    fontFamily: -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif
    fontSize: 13px
    lineHeight: 1.5
  meta:
    fontFamily: -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif
    fontSize: 12px
  label:
    fontFamily: -apple-system, "SF Pro Text", BlinkMacSystemFont, sans-serif
    fontSize: 11px
  mono:
    fontFamily: JetBrains Mono, ui-monospace, Menlo, monospace
    fontSize: 11.5px
    fontFeature: tnum
rounded:
  chip: 6px
  item: 8px
  card: 12px
  composer: 16px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.item}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
  composer:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.composer}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
  sidebar-item-selected:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.item}"
  user-message:
    backgroundColor: "{colors.sunk}"
    rounded: 14px
  send-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
---

# Supahelp Desktop

## Overview

**Creative North Star:** A quiet, native desktop tool modelled on the Aside desktop app, so that even a messy refund case feels calm and under control.
**Product context:** A chat-first desktop app where support specialists (and the developers they escalate to) resolve support requests end to end across Zendesk, Stripe, New Relic, Linear and more. Used all day beside the helpdesk.
**Mode per surface:** Operate. Chat, the case panel, approvals and settings are all task surfaces.
**Reference:** The Aside desktop app (captured 2026-11-06): translucent grey sidebar, near-white canvas, one floating composer, black send button, small system type.
**Key characteristics:**
- Grey and ink, with almost no colour. It looks like a desktop app, not a SaaS dashboard.
- The only warm colour on screen means "Supahelp needs you".
- Amounts and IDs read like a receipt.
- You can always see which tools a fact came from.

## Colors

**Strategy:** Restrained. Neutrals and ink do almost all the work. The neutrals are true greys with a slight cool tint. No beige or warm greys; the user turned those down as unprofessional.
**Light or dark:** Both. The app follows the system appearance setting.

- **Ink** (`primary`) is the only interaction colour. It's used for primary buttons, the send button and the selected case outline. There is no brand accent.
- **Attention (amber)** is used only for **Needs approval** and **Outcome unknown**. It is never decorative, and never used for links, tags or highlights.
- **Busy (slate blue)** marks Investigating and Running. **Success** marks Resolved. **Error** marks Failed and destructive buttons. **Waiting on customer / engineering** use plain grey (`sunk` with `text-muted`), because nothing is wrong and nothing is needed from you.
- Dark mode keeps the hierarchy instead of just inverting: the canvas is darkest, surfaces sit one step lighter, and the primary button flips to light ink on dark.

## Typography

- One face for everything you read: **SF Pro**, through the system font stack. This matches Aside and macOS, so the app feels native, and there's nothing to load. The usual rule against system fonts is waived here on purpose: this is a native desktop tool, and the user chose SF Pro over Instrument Sans after comparing both.
- **JetBrains Mono** (Google Fonts, SIL OFL 1.1) only for things you check: amounts, charge and customer IDs, ticket numbers, environment names. Always with tabular digits.
- Small scale, like Aside: label 11, meta 12, body 13, title 15, heading 20. Sizes differ by more than weight. Headings only appear in empty states and settings.
- Sentence case everywhere, including sidebar section labels ("Chats", not "CHATS").

## Layout

- A 272px sidebar and a flexible chat area. When a case or Playbook is open, a **document panel** (about 540px, `surface`, separated by a hairline) sits on the right of the chat and can expand to full width.
- Sidebar, top to bottom:
  - collapse button (⌘\)
  - **workspace switcher** (paid only): workspace mark, name, sync state. It opens a menu with the personal workspace and the organization's workspaces. Free users don't see it.
  - **Chats**: New chat, the 4 most recent chats, Show all. No date groups.
  - hairline divider
  - **Cases**: Mine filter, search field, then case rows (status dot, title, time; second line "status · customer", then an ink count badge when an open question is for you, and the owner's avatar), sorted with "needs you" first.
  - hairline divider
  - **Playbooks**: the 3 most recent, Show all.
  - **Customers**: searchable customer records and their cases.
  - footer: account on the left, global search on the right
- Chats and cases are listed separately: a case is a document, and the chats that worked on it stay under Chats.
- When the sidebar is collapsed, the panel button and New chat sit next to the traffic lights.
- The chat reading column and the composer share one centred column, at most 680px wide.
- The chat title lives in the toolbar; the case number and sync state live in the panel header.
- Spacing scale: 4, 8, 12, 16, 24 and 32px. Dense lists (sidebar, panel rows) use 8px gaps; the chat uses 16px between messages.
- Minimum window width is about 1280px with the panel open. Below that, the panel opens full width over the chat.

## Elevation & Depth

- Use soft offset shadows instead of borders, the way Aside does for its selected item and composer:
  - `shadow-1` (`0 1px 2px` at 7% plus a 0.5px hairline) for cards, selected items and tiles
  - `shadow-2` (`0 2px 6px` + `0 12px 32px`) for the composer and floating panels only
- No zero-offset glows, and no borders around cards. Lines are used only to separate the document panel and the header fields from the sections.

## Shapes

- Chips 6px, list items and buttons 8px, cards 12px, composer 16px, user messages 14px, send button and status pills fully round.
- A nested element's radius is the outer radius minus the gap. For example, the receipt block inside an approval card is 8px inside 12px.

## Components

- **Sidebar item:** plain by default. Hover uses the `sunk` background. Selected is a white pill with `shadow-1`. Focus-visible gets a 2px `busy` outline.
- **Tool tile:** square, `surface` background with `shadow-1`. An amber dot in the corner means the connection needs reconnecting.
- **Composer:**
  - placeholder "Ask anything, or paste a ticket link…"
  - chips row below it: `+`, approval mode, repo, model
  - attached items above the text as `sunk` chips: at most one case, any number of Playbooks
  - round ink send button
  - while running, the send button becomes a stop square
- **User message:** a `sunk` bubble, aligned right. **AI message:** plain text with no bubble.
- **Work steps:** a row of small tool marks (Zendesk, Stripe, New Relic, and so on) plus "Checked 3 tools in 14s ›". Click it to expand the steps.
- **Case panel (case document):** header bar with the case number, sync state, Copy as Markdown, expand and close. Then the title (heading size), the case properties, and the numbered sections (Summary, Customer, Problem, Reproduction, Findings, Actions, Open questions, Next step, Resolution). Click any property value or empty placeholder to open its lookup. Ticket and issue references use mono. Empty sections are hidden behind a one-line note with **+ Add section**. Similar cases and a collapsed change log close the document. Approvals stay in the chat.
- **Finding row:** verdict pill (Confirmed = success tint, Ruled out = `sunk`, Guess = hairline outline), the finding, its evidence link in mono, and who added it. A row the AI just changed gets a `sunk` background.
- **"Case updated" line:** in the chat, meta size, muted: document icon, "Case updated · **Section** what changed", then Undo and View as small text buttons.
- **People lookup:** click the owner or contributors value to search the list. Eligible actions appear beside candidates as Make owner or Add.
- **Approval card:**
  - status pill and a title naming the action
  - a mono receipt block: amount, target ID, customer, environment, and how the result will be checked
  - buttons: Approve (primary), Change (secondary), Cancel (ghost)
  - after the action runs, the card shows the checked result
- **Playbook document:** same panel, with a title and a freeform Markdown body. Edit uses one spacious source field; Preview renders headings, lists, tables, checklists and code with no prescribed section order. Drafts require explicit Save and Publish. Reviewed screenshots are managed images that can sit anywhere in the body; imported screenshots require baked-in redaction and a "No customer data" confirmation. History, Copy Markdown and portable `.md` export remain document actions.
- **Status pill:** a dot plus a label on a soft tint of the status colour. Running pulses its dot (no pulse under reduced motion). Outcome unknown uses an amber outline with no fill.
- **Quick tour:** a full-window modal over a built-in sample workspace. A dim layer (`tour-dim`) leaves one target lit with a 1.5px ring. The step card is 340px; welcome and finish are 420px and centered. Primary is Next, secondary Back, ghost Skip tour. Only the sample control for the current step can be clicked. It calls no tools and saves no work.
- **Empty, loading and error states:**
  - Empty chat: a faint logo and the composer, like Aside.
  - Loading: the work-steps row fills in as tools respond.
  - Error: plain language naming the tool and the fix ("New Relic needs reconnecting. Reconnect").

## Do's and Don'ts

- Do keep every colour meaningful. If it isn't a status or the primary action, it's grey.
- Do set every amount, ID and account in mono with tabular digits.
- Do show where a fact came from (tool mark or source link) next to the fact.
- Do let the composer be the only floating element on the canvas, apart from the temporary quick tour.
- Don't add a brand colour, gradient or illustration to the main window.
- Don't use amber for anything except "needs you".
- Don't put cards inside cards, or borders around cards.
- Don't use beige, cream or warm greys.
- Don't approve or run anything from the case panel. Approval details stay in the chat's approval card.

## Motion

- **Approach:** minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80ms (hover, press), short 180ms (case panel, sidebar rows, "Case updated" lines), medium 280ms (expanding work steps).
- **The one designed moment:** when you click Create case, the case panel slides in from the right (180ms) and the case appears at the top of Cases. The chat itself never moves.
- Respect `prefers-reduced-motion`: no pulse, no slide. Changes are instant.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-06 | Initial design system created | Created by /design-consultation, based on screenshots of the Aside desktop app and the approved product design |
| 2026-11-06 | SF Pro (system) over Instrument Sans | User compared both live; native feel matches Aside |
| 2026-11-06 | Cool neutral greys, not warm | User turned down beige backgrounds as unprofessional |
| 2026-11-06 | Kept 3 risks: receipt-style mono, amber only for "needs you", tool marks for work steps | User selected all three |
| 2026-11-06 | Single sidebar: Chats above a divider, Cases below with search; no right case dock, no Connected or Playbooks sections | User picked layout B, then moved Cases under Chats in Aside's style |
| 2026-11-06 | Settings opens in the main area (⌘, or the account menu) with its own nav column and a 640px content column of grouped cards. v1 pages: General, Notifications, Models, Instructions, Connections, Codebase, Playbooks, Privacy & data. Toggles use ink when on. | Approved pages and placement |
| 2026-11-08 | Connections becomes browse-then-detail. Browse: search bar, group chips, a "Connected" group on top (broken ones first, amber), then 2-across cards by group: Helpdesk, Billing, Errors & monitoring, Incidents & on-call, Issue tracking, Docs for playbooks, Customer records, Team chat, Your own tools. Unavailable tools remain visible with disabled setup. Detail: one column with header + Connect/Disconnect, access choice or account card, "Can read" / "Can change (always asks you first)" in plain words with the tool name in mono, then a Details card. | User picked A, A, B, B from the connections mockups |
| 2026-11-08 | Case becomes a document in a right-hand panel beside the chat (replaces the case bar and dock); chats attach one case as a chip; "Case updated" lines with Undo; sidebar adds a workspace switcher (paid) and a Playbooks section; Bring in is a plain member dropdown. Settings shrink to General, Notifications, Models, Connections, Privacy & data, Account & workspace (Instructions, Codebase and Playbooks pages removed; repo moves to the composer chip). The "Docs for playbooks" Connections group leaves the first version. | Approved case document flow and member dropdown |
| 2026-11-08 | The "Docs for playbooks" Connections group stays, renamed "Documentations" | User request after the case-document UI was built |
| 2026-11-13 | Connections becomes your-tools-first: the page lists connected, needs-reconnect and onboarding-picked tools; the full catalog (search, group chips, cards) opens from **Add connection** and is the page only when you have none. Detail pages fold "What it can do" (reads, changes, role notes, granted scopes) and "About this connection" (Details card, credential note). Setup instructions become a folded, numbered "How to set up" with copyable redirect addresses, shared by Settings and the onboarding connect checklist. | User picked A / folded steps / hide abilities, details and scopes, 2026-11-13 |
| 2026-11-23 | First-run quick tour: Welcome, five spotlight steps on sample case #412, then one setup action. Skip or Esc closes it immediately; replay lives in the account menu. | Approved tour flow and UI |
