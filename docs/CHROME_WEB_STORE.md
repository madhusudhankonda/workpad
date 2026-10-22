# Chrome Web Store release checklist

## Release package

```bash
npm run package:release
```

Upload `workpad-0.1.0.zip` to the Chrome Web Store Developer Dashboard. The ZIP must contain the files inside `dist`, with `manifest.json` at its root.

## Listing copy

**Name:** Workpad

**Publisher:** ChocolateMinds

**Support email:** ai@chocolateminds.com

**Short description:** AI research assistant in your side panel: ask about any page, collect sources and get decision briefs with cited evidence.

**Full description:**

Workpad is an AI research assistant in Chrome's side panel. Summarise and question the page you're on, collect pages, selections and emails into research projects, ask across them with every claim cited, and turn them into a decision brief you can defend. Notes and sources stay on your device; page text is sent to Workpad AI only when you choose an AI action.

- Move between a focused This Page view and your complete notes collection
- Save selected webpage text from the right-click menu
- Summarize, translate, explain, or extract action points from a page or selection with Workpad AI, included with a free monthly allowance
- Save an explicitly opened Gmail or Outlook message as a note, then extract actions, draft a reply, schedule a reminder, or track a subscription
- Inspect the evidence behind an AI answer by clicking a citation to highlight its supporting passage on the webpage
- Search, tag, favourite, export, and back up notes locally
- Keep notes on your device, or explicitly enable private cross-device sync; analytics are not used

## Store assets

- `public/icons/icon-128.png`: Chrome Web Store extension icon.
- `store-assets/small-promo-440x280.png`: required 440×280 promotional image. Store artwork is intentionally excluded from the extension ZIP.
- Capture at least one **real** extension screenshot after loading the production build. Chrome accepts 1280×800 or 640×400 screenshots. Do not use the promotional illustration as a screenshot.

Suggested screenshots:

1. Workpad side panel next to a normal webpage, showing the context banner and note list.
2. Note editor with tags, a page-note indicator, and saved status.
3. Settings or context-menu capture result.

## Privacy and permissions disclosure

Privacy policy URL (GitHub Pages):

```text
https://madhusudhankonda.github.io/workpad/privacy.html
```

Source files: `docs/PRIVACY.md` and `docs/privacy.html`.

Other public URLs:

- Terms: `https://madhusudhankonda.github.io/workpad/terms.html`
- Refunds: `https://madhusudhankonda.github.io/workpad/refunds.html`
- Support: `https://madhusudhankonda.github.io/workpad/support.html`
- Account deletion: `https://madhusudhankonda.github.io/workpad/delete-account.html`

Use this permission justification:

| Permission | Justification |
| --- | --- |
| `sidePanel` | Displays Workpad beside the active browser tab. |
| `tabs` | Reads the active tab's title and URL to show requested note context. |
| `activeTab` | Associates a user-created note with the active webpage. |
| `contextMenus` | Lets users explicitly save selected text or a page link. |
| `storage` | Temporarily transfers a user-requested capture from the service worker to Workpad. |
| `scripting` | Reads visible text from the active page only when the user opens Workpad AI or explicitly clicks Save email on supported Gmail or Outlook pages. |
| `identity` | Opens Google sign-in for the Workpad account that Workpad AI and paid plans use. |
| `alarms` | Schedules a reminder only after the user chooses a reminder date for a saved note. |
| `notifications` | Shows a user-created Workpad reminder at its scheduled time. |
| Optional current-site access | Restores page reading when Chrome's temporary `activeTab` grant is unavailable. Requested only after the user clicks Allow access. |
| Optional Supabase project access | Connects to account, entitlement, billing and Workpad AI endpoints after sign-in. Sends a user-chosen page or selection to Workpad AI only after the user chooses an AI action, and transfers saved notes only after the user separately enables cloud sync. |

Workpad does not collect browsing history or use analytics. Workpad AI requires sign-in and sends only user-chosen content to Workpad's AI service, which forwards it to OpenAI without storing it.

## Final manual acceptance test

- Extension loads from `dist` without manifest warnings.
- Toolbar click opens the side panel.
- Page-linked and general notes persist after Chrome restarts.
- Context menu saves selection on an HTTPS website.
- AI can switch between full-page and selected-text input, run every preset, stop a request, inspect cited evidence on the page, and save the result with its evidence as a page note.
- Signed-out users see a sign-in prompt instead of AI actions; the credit counter decreases after each action; an exhausted allowance blocks actions with a clear message.
- JSON export/import and reset confirmation work.
- Signing in does not upload notes; enabling sync merges them, offline changes retry, deletions propagate, and turning sync off preserves both copies.
- Privacy-policy URL is public and functional.
- Account deletion cancels billing, removes cloud data, and leaves local notes intact until the user resets them.
- Gmail and Outlook show **Save email** only in the Workpad panel; saving captures only the opened message, and a scheduled reminder produces a Chrome notification.
