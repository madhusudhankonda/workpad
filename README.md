# Workpad

Workpad is a local-first contextual notebook that lives in Chrome's side panel. It keeps scratch work, page research, and domain-level notes beside the website where they matter.

## Features

- Global scratchpad, standalone, exact-page, and domain notes
- IndexedDB persistence via Dexie; no backend or account required
- Debounced auto-save, tags, favourites, local search, and keyboard shortcuts
- Current-page context and graceful handling of restricted Chrome pages
- Right-click selection capture and page-link capture
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
- `src/db`: Dexie schema and repository abstraction, intentionally isolated for future Supabase sync.
- `src/services`: Chrome API boundary.
- `src/utils`: URL normalization, backup validation, and domain matching logic.
- `tests`: Vitest unit tests.

## Privacy and permissions

All notes remain in IndexedDB on the local device. Workpad has no analytics, tracking, server, or external API calls. `activeTab` and `tabs` are used only to display the current page context and associate a note when requested. `sidePanel` opens the notebook, `contextMenus` enables explicit capture, and `storage` transfers pending context-menu captures between Chrome contexts. No host permissions or browsing-history permission are requested.

See [docs/PRIVACY.md](docs/PRIVACY.md).

## Known limitations

- Chrome keyboard command slots may be customized or unavailable due to browser/OS conflicts.
- Search is in-memory filtering after a local IndexedDB read, which is appropriate for an MVP-sized notebook.
- The built-in editor is plain-text Markdown, not rich text.

## Future roadmap

1. Supabase authentication and encrypted multi-device synchronization.
2. Shared team workspaces and reusable templates.
3. AI summaries, semantic search, task extraction, browser-history context, and Notion, Google Docs, and Jira integrations.
