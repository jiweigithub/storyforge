# Versions, upgrades, and data compatibility

## Which version these docs describe

This incremental review covers **main baseline cfc5ed3f on October 14, 2026**, checking user-visible changes since the last successful maintenance baseline `ce1cfd6c`. Each product retains its own guide status; the maintenance date does not raise maturity.

The package version is **4.0.0**. The [formal v4.0.0 release](https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.0) was published on October 13, 2026 at fixed commit `78416965`. The later main-branch changes from [PR #119](https://github.com/yuanbw2025/storyforge/pull/119), including text-adventure recovery, image-preserving revisions, and standalone web export, are **not in those fixed downloads**. Documentation maintenance does not rebuild releases or replace the separately deployed hosted experience.

Two builds both labeled 4.0.0 need not contain identical code. Include the build commit, address, and date when reporting issues.

Live sites may lag deployment. [Tagged releases](https://github.com/yuanbw2025/storyforge/releases) do not automatically gain later main-branch features.

## Before upgrading

1. Export complete JSON in the original environment, and save important prose separately.
2. Preserve original files. If using a disk workspace, explicitly check differences and synchronize.
3. Read data-compatibility notes in the changelog.
4. After updating, check works, chapters, assets, and saving.

With no personal source changes, update following Git's guidance, then run `npm ci` and `npm run dev`. Preserve local changes and resolve conflicts first if present; do not upgrade using forced-overwrite commands.

## Not every old backup can be imported

Current backup validation accepts only the supported current format. Database migration and external-backup import are separate paths. Support for some database migrations does not imply arbitrary old JSON can be imported.

If an old file is rejected:

- Preserve the original backup and the environment that can still open it.
- Record the version and error text.
- If the original environment can read it, export prose separately so you are not left with only one format.
- Submit [feedback](/en/feedback/bug) and wait for an evidence-based compatibility solution.

Do not alter backup version numbers, delete validation fields, or clear the original browser database to bypass an error.

## Rolling back

Reverting source or opening an old release does not guarantee the old program can read newer data. Original pre-upgrade backups and a separate environment provide the recovery basis.

Continue: [Backup and recovery](/en/guides/backup-restore) · [Changelog](/en/updates/changelog).

Implemented on a branch, merged into remote main, and successfully deployed are three separate states. [Pending development](/en/updates/development-status) records work not yet delivered. A documentation review date is not a product release date.
