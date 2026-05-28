# Changelog

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
