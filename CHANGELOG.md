# Changelog

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
