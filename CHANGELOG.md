# Changelog

## 0.9.16 - 2026-06-22

- Raised the storage encryption scrypt work factor for newly encrypted local data and encrypted exports from `N=2^15` to `N=2^18`, while keeping older encrypted files readable through per-file KDF metadata.
- Added explicit KDF metadata for newly saved privacy PIN hashes so new or changed PINs can use the stronger scrypt parameters without breaking existing PINs.

## 0.9.15 - 2026-06-22

- Fixed note state persistence for delete, restore, favorite, archive, and pin actions by updating `updatedAt` and flushing those changes to disk immediately.
- Hardened startup reconciliation so per-note shadow files also repair SQLite rows when timestamps match but record state differs, preventing deleted notes from reappearing after restart.

## 0.9.14 - 2026-06-22

- Fixed collapsible-block dragging by turning the drag affordance into a real draggable handle instead of a button that intercepted the pointer event before ProseMirror could start a node drag.

## 0.9.13 - 2026-06-22

- Added a per-note encrypted-compatible shadow file alongside SQLite saves, and startup reconciliation from `notes/*.json`, so newly created or edited notes can be recovered even if the SQLite export path is interrupted.
- Updated local encryption reconfiguration to rewrite the new per-note shadow files as well as backups.
- Fixed crowded note-list panels by preventing note cards from shrinking in the scroll container and allowing compact titles to wrap without being squeezed by action buttons.

## 0.9.12 - 2026-06-22

- Fixed the real persistence regression in the immediate-save path: note writes now always mark the SQLite session dirty before either queued or immediate flush, so newly created notes and edits to existing notes are actually written into `suiji.db` instead of only appearing in the current session.
- Improved compact-sidebar note cards by letting titles wrap to two lines and reserving space for the action buttons, reducing title truncation when the record list gets crowded in the small panel layout.

## 0.9.11 - 2026-06-22

- Tightened auto-save semantics so `notes:save` now flushes the edited note to `suiji.db` before reporting success; the “已保存” state now means the latest edit is already on disk instead of only living in the in-memory SQLite session.

## 0.9.10 - 2026-06-22

- Fixed a persistence gap where newly created notes could still be only in the in-memory database for a short window; new notes and imported notes are now flushed to `suiji.db` immediately so closing the portable app or rebuilding right after creation no longer drops them.

## 0.9.9 - 2026-06-22

- Increased the note-list excerpt area to two visible lines so the正文摘要 under each title no longer gets clipped into an undersized single-line slot.

## 0.9.8 - 2026-06-22

- Refined the in-editor find panel into a clearer floating layout with grouped search, replace, navigation, and close actions so the popup reads more like the rest of the app's layered controls.
- Fixed find next/previous navigation so the editor content area now smoothly scrolls to the active match instead of only changing the text selection.

## 0.9.7 - 2026-06-22

- Extracted application menu and tray menu construction into `src/main/app-shell.ts`, so shell-level actions are no longer embedded directly inside the main process file.
- Added tests for the new app-shell templates to keep menu and tray entry structure stable during later UI and workflow changes.

## 0.9.6 - 2026-06-22

- Split the oversized main-process file by extracting security/encryption helpers into `src/main/security.ts`, HTML export rendering into `src/main/html-export.ts`, and note transfer helpers into `src/main/note-transfer.ts`.
- Kept the existing import/export and privacy behavior unchanged while moving those domains behind clearer module boundaries for later maintenance.
- Expanded the new `vitest` baseline with coverage for security helpers and note transfer parsing utilities.

## 0.9.5 - 2026-06-22

- Added encrypted export import support so `.suiji-note` and `.suiji-export` files can be brought back into the local library instead of being write-only.
- Added a dedicated “导入加密” action in the settings data tools and unified encrypted-file PIN error messages across backup restore and encrypted export import.
- Added a first engineering baseline with `vitest` test scripts and parser coverage for encrypted export bundle detection.

## 0.9.4 - 2026-06-22

- Fixed the settings PIN verification regression caused by font preset changes calling `settings:update` immediately while the settings dialog still had unsaved security drafts.
- Changed font preset updates to stay in local draft state while the settings dialog is open, so security changes continue through the normal Save flow instead of failing early.

## 0.9.3 - 2026-06-22

- Added a plain-vs-encrypted choice to current-note exports so `HTML`、`Markdown`、`TXT`、`JSON` can now be saved as a Suiji-only encrypted note file instead of only plaintext.
- Added the same plain-vs-encrypted choice to batch exports, writing one app-specific encrypted export file when protection is selected instead of a directory of plaintext files.
- Updated export-related messaging so the app now clearly distinguishes local storage encryption, encrypted backups, and optional encrypted exports.

## 0.9.2 - 2026-06-18

- Required re-entering the current PIN before disabling local encryption or changing the privacy PIN, instead of trusting the already-open session.
- Disabled default debug-log file output in packaged builds unless `SUIJI_DEBUG_LOG` is explicitly provided.
- Added idle auto-lock timing, lock-on-suspend behavior, and real encrypted-session teardown when the app locks.
- Added app-specific encrypted backup export and restore flow so full-library backups can be protected outside the local database.

## 0.9.1 - 2026-06-18

- Reworked the settings dialog into clearer Preference, Security, and Data sections with stronger card hierarchy and better scanability.
- Pulled backup retention, encryption, and data-management actions into more deliberate grouped layouts instead of one long stacked form.

## 0.9.0 - 2026-06-18

- Added switches for local history retention so automatic note-version backups can be disabled entirely or capped to a smaller count.
- Added PIN-based local encryption for `suiji.db`, note history files in `backups/`, and full-library backup exports, with startup lock handling for encrypted storage.

## 0.8.10 - 2026-06-18

- Kept the editor `+` insert button anchored in its original position and changed only the menu to float out from the button's right side so it no longer gets clipped by the left edge.
- Fixed the insert-menu interaction regression introduced in `0.8.9`.

## 0.8.9 - 2026-06-18

- Fixed the editor insert menu so it opens toward the document interior and no longer gets clipped or covered by the left edge of the workspace.

## 0.8.8 - 2026-06-18

- Added runtime block hover and current-block focus treatment inside the editor without touching document structure or export output.
- Refined empty-line insert feedback, collapsible block expand and collapse motion, and button press states so editor interactions feel softer and more deliberate.

## 0.8.7 - 2026-06-18

- Replaced the broken system `prompt()` link action with an in-app link dialog that works inside Electron.
- Improved link editing so you can add, update, or remove links without leaving the editor flow, and plain domains now auto-complete to `https://`.

## 0.8.6 - 2026-06-18

- Unified the floating UI system so menus, the format panel, and modal dialogs share one layered surface language with softer Craft-like depth.
- Reworked the format panel into clearer stacked cards and tightened hover, lift, and panel-entry motion across editing overlays.
- Refined settings and history dialogs with structured inner surfaces and a calmer modal backdrop for more consistent transient interactions.

## 0.8.5 - 2026-06-18

- Removed the unstable editor block hover toolbar and block chrome experiment that could leave the renderer on a white screen at startup.
- Kept the earlier global motion and sidebar interaction polish while rolling the editor interaction pass back to the last stable behavior.

## 0.8.4 - 2026-06-18

- Fixed the renderer white screen caused by applying block chrome decorations to collapsible block node views during startup.
- Kept the new editor hover interactions for standard text blocks while avoiding decoration updates on collapsible blocks.

## 0.8.3 - 2026-06-18

- Added editor block chrome so the current block has a softer focus treatment and block hover states feel more intentional.
- Added a left-side hover toolbar for block-level insertion and quick formatting access inside the editor.
- Reworked collapsible block expand and collapse behavior with smoother visual transitions instead of abrupt body show/hide.

## 0.8.2 - 2026-06-18

- Started the first interaction-polish pass across the app with unified motion timing and easing tokens.
- Refined sidebar view switches, note cards, hover states, active states, and quick actions to feel lighter and more layered.
- Added smoother menu and modal entrance motion so transient UI feels closer to a Craft-style interaction rhythm.

## 0.8.1 - 2026-06-17

- Refined in-app scrollbar styling with slimmer, lower-contrast thumb treatment so scrolling feels less visually heavy, especially in dark mode.
- Kept the existing layout and interactions intact while unifying scrollbar appearance across app panels.

## 0.7.3 - 2026-05-29

- Added a collapsible outline panel so the directory can be folded away in small windows.
- Improved long-title truncation in the editor header and sidebar note cards.
- Compressed small-window header controls to reduce title clipping.

## 0.7.2 - 2026-05-29

- Tightened sidebar note-card layout for small windows so titles, actions, metadata, excerpts, and timestamps do not overlap or clip.

## 0.7.1 - 2026-05-29

- Batched SQLite database persistence to reduce full database export/write work during autosave bursts.
- Forced database flushes when hiding, minimizing, changing data directories, and quitting.
- Debounced outline regeneration during editing to reduce long-document typing overhead.
- Tightened Electron renderer security settings, permission checks, webview blocking, and CSP directives.

## 0.7.0 - 2026-05-28

- Replaced per-note JSON file storage with a local SQLite database at `suiji.db`.
- Added an FTS5 index for full-text note search and wired normal keyword search through it.
- Added first-run migration from existing `notes/*.json` files into SQLite while keeping JSON backups for version history.

## 0.6.5 - 2026-05-28

- Fixed outline navigation so clicking a heading scrolls the editor to that heading reliably.

## 0.6.4 - 2026-05-28

- Reworked the editor toolbar so typography controls live inside one cohesive "layout" menu.
- Reduced toolbar clutter while keeping font, font size, line width, and line height adjustments live.

## 0.6.3 - 2026-05-28

- Removed font, font-size, line-width, and line-height controls from the settings dialog.
- Kept typography controls in the toolbar and preserved a compact dark-mode switch in settings.

## 0.6.2 - 2026-05-28

- Made the editor toolbar responsive so controls reflow instead of being covered in smaller windows.
- Kept formatting controls and export actions visible while the rich-text tool group scrolls inside its own area.

## 0.6.1 - 2026-05-28

- Optimized compact-window layout so sidebar note cards, timestamps, and toolbar controls are not clipped.
- Moved editor typography controls into the toolbar, including default font, font size, line width, and line height.
- Added persistent editor font size and line-height settings.

## 0.6.0 - 2026-05-28

- Added Markdown import and batch export for Markdown, HTML, TXT, and JSON.
- Added hotkey recording with conflict checks, plus startup-at-login support.
- Added full-text search highlighting and syntax filters for `tag:`, `folder:`, `fav`, `archive`, and `trash`.
- Added word count, reading time, outline navigation, and heading jump support.
- Added theme, font, line-width, and dark-mode settings.
- Added tray quick-create, clipboard quick-save, and image/screenshot paste support.

## 0.5.1 - 2026-05-28

- Improved sidebar view-switch layout from cramped five-column buttons to wider two-column controls.
- Added configurable data directory selection with optional migration of notes, backups, and settings.
- Adjusted data-management controls to avoid crowded button layout.

## 0.5.0 - 2026-05-28

- Added folders, favorites, archive state, soft-delete recycle bin, and permanent delete.
- Added a recent-edit timeline view in the sidebar.
- Added current-note version history UI backed by existing `backups/` files.
- Extended the note schema with `folder`, `favoriteAt`, `archivedAt`, and `trashedAt` while keeping older notes compatible.

## 0.4.0 - 2026-05-28

- Added note tags with editing, search matching, sidebar filtering, and note-card tag display.
- Changed HTML export to render from TipTap JSON through an allowlisted HTML renderer instead of using cached raw HTML.
- Reduced automatic edit-backup churn by throttling normal save backups while keeping destructive-operation backups immediate.
- Split renderer bundles into React, editor, icons, and vendor chunks to reduce the main entry chunk size.

## 0.3.0 - 2026-05-28

- Added full-note backup export from the settings panel.
- Added backup restore with validation and pre-overwrite local backups.
- Added an "open data folder" action for troubleshooting and manual backup workflows.
- Documented the backup file shape and data-management workflow.

## 0.2.0 - 2026-05-28

- Hardened Electron navigation: external links now open through the system browser, and app windows block unexpected navigation and permission requests.
- Added IPC payload validation for note saving, exporting, settings updates, and external link opening.
- Improved autosave reliability with serialized save operations and stale-save state protection.
- Made note loading tolerant of corrupted note JSON files by isolating bad files instead of blocking the whole app.
- Upgraded Electron and electron-builder, reducing `npm audit` findings to zero in the current lockfile.
- Added a Content Security Policy and enabled renderer sandboxing.
- Made icon generation skip unchanged files and replace changed files through temporary files with retries.
- Bumped the app version to `0.2.0`.
