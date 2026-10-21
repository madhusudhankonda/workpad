# Workpad Research Projects and Decision Briefs

## Proposal

Evolve Workpad from a page-linked notebook into a research-to-decision tool.

The core promise is:

> Capture from anywhere. Research in one place. Produce a decision you can defend.

Email capture remains a supporting feature. An opened email is simply another source that a user can deliberately add to a research project. Workpad will not request mailbox-wide access or monitor inboxes.

## Target customer

The first release targets one buyer: **a person evaluating software vendors** (for example “CRM selection” or “Analytics tool shortlist”). This user collects pricing pages, reviews, sales emails and their own notes, and must justify a choice to a manager or team.

Other uses (competitor analysis, job opportunities) will work with the same model but are not designed for in the first release.

## Customer problem

People research decisions across webpages, emails, extracts and personal notes. The material becomes fragmented across tabs, bookmarks and applications. Turning it into a concise, evidence-backed recommendation requires significant manual work, and generic AI tools often separate their answer from the underlying evidence.

Workpad should preserve the connection between source material, analysis and the final decision.

## Positioning

NotebookLM already offers source collections, cited Q&A and briefing documents, and has a web-importer extension. Workpad must not compete as a generic research notebook. Its differentiators are:

- **Capture in the flow of browsing:** the current page, a text selection or an opened email, added in one action without leaving the tab.
- **Local-first privacy:** nothing leaves the device until the user runs an AI action or opts into sync.
- **Frozen, dated evidence:** every citation resolves to the exact text captured on a given date, even after the page changes.
- **A decision, not a summary:** the output is structured around criteria, options and a recommendation.

Lead messaging with “a decision you can defend”, not “research notebook”.

## Product model

- **Research project:** A named collection such as “CRM selection”.
- **Source:** A webpage snapshot, selected passage, deliberately saved email, note snapshot or saved AI result, belonging to exactly one project.
- **Decision brief:** A generated, editable deliverable grounded in the project's sources.

Sources are **copied per project**, not shared across projects. Snapshots are immutable evidence, so duplicating bounded text is cheap, and it avoids a join table, link-row sync tombstones and orphaned-source cleanup. Adding the same material to a second project creates a second snapshot.

## Primary user journey

1. The user encounters useful material in the browser.
2. They select **Add to research**.
3. They choose an existing project or create a new one.
4. Workpad shows a preview of what will be stored, then saves the source title, URL, capture time and a bounded text snapshot or selected extract.
5. The project view shows all captured sources and saved AI results.
6. The user asks questions across selected sources or chooses **Create decision brief**.
7. Workpad produces an editable brief with inspectable citations.
8. The user copies or exports the result.

## MVP scope

### 1. Research projects

- Create, rename and delete projects.
- Display source count and last-updated time.

### 2. Add to research

- Available from the current-page banner, saved emails, selections and existing notes.
- Project picker with **New research project**.
- Deduplicate within a project by normalized URL plus a content hash of the snapshot.
- Adding a note stores a snapshot of the note at that moment; later edits to the note do not change the evidence.

### 3. Stored source evidence

- Save a bounded text snapshot, not only the source URL.
- Preserve the page or email title, URL, domain, capture time and source type.
- Let the user preview exactly what was captured.
- Do not read or store page text until the user deliberately adds the source.
- Apply a per-source size limit and show when content was shortened. The snapshot size limit is separate from the AI context budget.
- **Re-capture:** the user can manually re-capture a source. This adds a new dated version; the original is kept. Existing briefs keep citing the version they were built from.

### 4. Project view

- Sources and saved AI results in one view.
- Select which sources participate in an AI request.
- Remove sources and open the original URL.
- View any stored snapshot with the cited passage highlighted.
- Provide clear empty and loading states.

### 5. Ask across sources

- Build evidence passages from the selected stored snapshots.
- Use stable citation identifiers such as `[S2:P4]`.
- Each citation opens the **stored snapshot** at the cited passage and identifies its original source. It does not depend on the original tab being open or unchanged.
- Enforce a total context budget with a deterministic rule: an equal share per selected source, with unused allowance redistributed to longer sources. Report which sources were shortened or omitted, and by how much.
- Wrap each source in its own delimiter in the prompt and keep the instruction to treat all source text as untrusted data. Emails make prompt injection more likely.

This ships before the brief because it is cheaper and validates multi-source citations first.

### 6. Create Decision Brief

Structure for the vendor-selection customer:

1. Objective
2. Executive summary
3. Decision criteria
4. Key findings
5. Options and comparison (a criteria × options table)
6. Risks, uncertainties and open questions
7. Recommendation
8. Next actions
9. Sources

Citation rules:

- Key findings and Options must cite evidence; a missing citation there is an error.
- Sections that are AI judgement (Recommendation, Next actions) may be uncited and are labelled **Inference**.

Editing:

- The brief remains editable after generation.
- Edits may leave citation identifiers that no longer resolve. These render with a broken-citation badge instead of failing.

### 7. Export

- Copy to clipboard.
- Markdown export.
- PDF can follow after the core workflow is validated.

### Deferred from the first release

- Reusable sources shared across projects.
- Reordering sources.
- Recently used projects.
- Project archiving.
- Supabase sync of projects, sources and briefs (follows in v1.1; the first release is local-only).

## Data model

### `ResearchProject`

- `id`
- `name`
- `description`
- `createdAt`
- `updatedAt`

### `ResearchSource`

- `id`
- `projectId`
- `sourceType`: page, selection, email, note or AI result
- `title`
- `url`
- `normalizedUrl`
- `domain`
- `snapshotText`
- `snapshotTruncated`
- `contentHash`
- `version`
- `previousVersionId`, set when the source was re-captured
- `capturedAt`
- `createdAt`
- `updatedAt`

### `DecisionBrief`

- `id`
- `projectId`
- `title`
- `content`
- `sourceIds`, the exact source versions used to generate the brief
- `createdAt`
- `updatedAt`

## Technical work

Findings from reviewing the current code:

- **Database:** add Dexie version 3 with `projects`, `sources` and `briefs` tables. The change is additive; existing notes are not rewritten.
- **Backup:** add backup version 2 with projects, sources and briefs. Keep importing version 1.
- **Citations:** `validateEvidenceCitations` in `src/services/ai.ts` only accepts `[P#]`, and the prompt assumes a single source. It needs a new identifier format, prompt and validator, plus per-section rules for the brief (required in Key findings and Options, optional in Inference sections).
- **Evidence viewer:** `highlightPageEvidence` in `src/services/pageContent.ts` searches the live active tab. Project citations need a new snapshot viewer that works without the source tab.
- **Output size:** AI requests use `max_output_tokens: 2_500` and low reasoning effort, which will truncate a nine-section brief. Brief generation needs a higher limit (around 8,000), medium effort, or generation per section.
- **Context budget:** `aiMaxSourceCharacters` (40,000) is today's limit for one page. It becomes the total budget across sources, using the allocation rule above.
- Keep existing page-note, email-capture and social-sharing workflows working.

## Privacy boundary

- No Gmail or Outlook API integration.
- No automatic mailbox or browsing-history scanning.
- Source text is captured only after an explicit user action.
- The capture preview tells users what will be stored.
- Nothing is sent to OpenAI until the user runs an AI action.
- Cloud sync remains separately opt-in.
- Email snapshots contain third parties' personal data. Before snapshots sync, update `docs/PRIVACY.md` and the Chrome Web Store data disclosure.
- Synced source snapshots are not end-to-end encrypted, so this must be disclosed clearly.

## Monetization

Users currently supply their own OpenAI API key, and the paid plan unlocks cloud sync. A decision brief therefore cannot be the paid outcome on its own: the AI costs the user nothing extra from Workpad. Options:

1. Gate research projects and decision briefs behind the paid plan regardless of who pays for the AI.
2. Offer hosted AI calls in the paid plan, so no API key is needed, with the brief as the main paid feature.

This is unresolved and must be decided before phase 4.

## Delivery sequence

1. Projects, local persistence and project picker.
2. Explicit page/email/selection/note snapshots, capture preview, project source view and snapshot viewer.
3. Multi-source questions with `[S#:P#]` citations and context-budget reporting.
4. Editable Decision Brief generation and Markdown export.
5. Backup migration and production QA.
6. Supabase sync of projects, sources and briefs (v1.1), with the privacy disclosure updates.

## Success measures

- Percentage of captured sources assigned to a project.
- Projects that reach three or more sources.
- Decision briefs created per active project.
- Citations inspected before a brief is exported.
- Time from first captured source to exported brief.
- Repeat project creation by the same user.

The extension has no analytics today. These measures require privacy-respecting, disclosed usage counts, or they remain goals rather than tracked metrics.

## Out of scope for the first release

- Mailbox-wide Gmail or Outlook access.
- Automatic inbox or browsing-history monitoring.
- Autonomous actions or sending email.
- Team collaboration and permissions.
- Native Google Docs, Notion or project-management integrations.
- Background web-page recrawling.

## Review decisions

1. **Is a decision brief a strong enough paid outcome?** Not while the target user is broad and users bring their own AI key. The first release targets vendor evaluation; the pricing model remains open (see Monetization).
2. **Reusable sources or one project per source?** One project per source, with the snapshot copied when added to another project.
3. **Bounded snapshots?** Yes. Citations cannot be verified later without them. Email snapshots need updated privacy disclosures before they sync.
4. **When a source changes?** Keep the original and offer a manual re-capture that adds a new dated version. Briefs cite the version they were built from.
5. **Brief structure?** Add Decision criteria, make Options a comparison table, and merge Open questions into Risks.
6. **What can be removed?** Reordering, recently used projects, archiving, sources shared across projects, and project sync in the first release. Keep Ask across sources.
7. **What makes it different?** Capture during browsing, local-first privacy, frozen and dated evidence, and decision-shaped output. NotebookLM is the direct comparison, not bookmarks.
