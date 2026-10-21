# Workpad

Workpad is a local-first contextual notebook that lives in Chrome's side panel. It keeps page research and general notes beside the website where they matter.

## Features

- Focused This Page and All Notes views for page-linked and general notes
- IndexedDB persistence via Dexie; no backend or account required
- Optional, explicit Supabase note sync with offline queuing and conflict copies
- Debounced auto-save, tags, favourites, local search, and keyboard shortcuts
- Current-page context and graceful handling of restricted Chrome pages
- Right-click selection capture and page-link capture
- On-demand AI summaries, translations, action points, explanations, and custom prompts
- Full-page or selected-text AI input with a review-before-save workflow
- Traceable AI answers with clickable evidence citations that highlight the supporting passage on the page
- Markdown/plain-text single note export and JSON backup/import
- Light, dark, and system themes; first-launch onboarding

## Development

```bash
npm install
npm run dev
```

`npm run dev` watches and rebuilds `dist/`; reload the unpacked extension after changes.

```bash
npm run build
npm test
npm run lint
```

## Load in Chrome

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this project's generated `dist` folder.
7. Pin the Workpad extension.
8. Click its toolbar icon to open the side panel.

For context-menu capture, select text on a normal webpage, right-click, then choose **Save selection to Workpad**. Chrome blocks extension access to internal pages such as `chrome://extensions`; Workpad shows a clear restricted-page state there.

## Architecture

- `src/background`: Manifest V3 service worker, side-panel and context-menu wiring.
- `src/sidepanel`: React application and side-panel entry point.
- `src/db`: Dexie schema and repository abstraction for local-first notes.
- `supabase`: RLS-protected account, optional cloud notes, entitlement, usage, and Stripe subscription backend.
- `src/services`: Chrome API boundary.
- `src/utils`: URL normalization, backup validation, and domain matching logic.
- `tests`: Vitest unit tests.

## Privacy and permissions

Notes remain in IndexedDB on the local device by default. Signed-in users may explicitly enable Supabase cloud sync; signing in alone never uploads notes. Synced notes are protected by per-user database policies but are not end-to-end encrypted. Workpad has no analytics or tracking. AI is optional and hosted: signed-in users get a monthly allowance of token-weighted credits, larger on Pro. When the user chooses an AI action, only the chosen page/selection text, page title, sanitized URL and instruction are sent to the `ai-proxy` Supabase Edge Function. It holds the OpenAI key, chooses the model and limits, enforces quotas, and calls the Responses API with `store: false`. It stores usage counts, not content.

Production builds can enable optional Supabase accounts and a **£1.99/month Workpad Pro** subscription with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Pro unlocks more AI credits, longer AI sources and opt-in Workpad Cloud note sync. Stripe and Supabase secrets remain server-side in Edge Function secrets. See [docs/PRODUCTION.md](docs/PRODUCTION.md).

`activeTab`, `tabs`, and `scripting` provide page context and on-demand text extraction. On Gmail and Outlook, message text is captured only when the user clicks **Save email**. If Chrome's temporary page access is unavailable, Workpad can request optional access to the current website. It does not request permanent access to every website. `sidePanel` opens the notebook, `contextMenus` enables explicit capture, `storage` holds extension state, and `alarms` plus `notifications` power user-created reminders. No remote host permission is required; browsing-history permission is not requested.

See [docs/PRIVACY.md](docs/PRIVACY.md).

## Known limitations

- Chrome keyboard command slots may be customized or unavailable due to browser/OS conflicts.
- Search is in-memory filtering after a local IndexedDB read, which is appropriate for an MVP-sized notebook.
- The built-in editor is plain-text Markdown, not rich text.

## Future roadmap

1. Optional end-to-end encryption for cloud-synced notes.
2. Shared team workspaces and reusable templates.
3. Semantic search, browser-history context, and Notion, Google Docs, and Jira integrations.
