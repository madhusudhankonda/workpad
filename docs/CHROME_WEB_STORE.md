# Chrome Web Store release checklist

## Release package

```bash
npm run build
cd dist
zip -r ../workpad-0.1.0.zip .
```

Upload `workpad-0.1.0.zip` to the Chrome Web Store Developer Dashboard. The ZIP must contain the files inside `dist`, with `manifest.json` at its root.

## Listing copy

**Name:** Workpad

**Short description:** Contextual notes that stay beside the webpage you are working on.

**Full description:**

Workpad is a private, local-first notebook that lives in Chrome's side panel. Keep a global scratchpad, create notes for a specific page or an entire domain, and return to your research with the right context already waiting.

- Create standalone, page, domain, and scratchpad notes
- Save selected webpage text from the right-click menu
- Search, tag, favourite, export, and back up notes locally
- Keep data on your device with no account, analytics, or external API

## Store assets

- `public/icons/icon-128.png`: Chrome Web Store extension icon.
- `public/store-assets/small-promo-440x280.png`: required 440×280 promotional image.
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

Use this permission justification:

| Permission | Justification |
| --- | --- |
| `sidePanel` | Displays Workpad beside the active browser tab. |
| `tabs` | Reads the active tab's title and URL to show requested note context. |
| `activeTab` | Associates a user-created note with the active webpage. |
| `contextMenus` | Lets users explicitly save selected text or a page link. |
| `storage` | Temporarily transfers a user-requested capture from the service worker to Workpad. |

Workpad has no host permissions. It does not collect browsing history, send note content to external services, or use analytics.

## Final manual acceptance test

- Extension loads from `dist` without manifest warnings.
- Toolbar click opens the side panel.
- Page, domain, standalone, and scratchpad notes persist after Chrome restarts.
- Context menu saves selection on an HTTPS website.
- JSON export/import and reset confirmation work.
- Privacy-policy URL is public and functional.
