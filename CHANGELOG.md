# Changelog

Research Tech Tree follows [Semantic Versioning](https://semver.org/). Dates use the `YYYY-MM-DD` format.

## [0.1.7] - 2026-08-10

### Added

- Separate add controls for bonuses and penalties, with sensible positive or negative defaults.
- An "Unlocked by technology" selector in the modifier editor that can link a bonus or penalty to any technology in the same research organization.
- Active and passive state labels for every modifier shown on the overview.

### Changed

- The Active Bonuses and Active Penalties panels are now named Bonuses and Penalties and display every modifier.
- Passive, scheduled, expired, and inactive project-scoped modifiers are shown in gray; modifiers currently affecting research retain their bonus or penalty colors.
- Technology completion unlocks linked modifiers through the existing completion workflow, while already completed unlock technologies activate newly linked modifiers immediately.

## [0.1.6] - 2026-08-10

### Added

- Seven-second pulsing highlights and automatic centering when a prerequisite link is opened.
- A GM edit-mode control for setting a technology's researched RP directly; reaching its effective RP cost completes the technology through the normal completion workflow.
- Per-technology SWADE research skill selection in the technology editor.

### Changed

- An organization's general research skill is now the default copied to newly created technologies instead of being the only skill used by the entire tree.
- Existing technologies receive their organization's configured skill during the schema v5 migration, preserving old-world roll behavior.

## [0.1.5] - 2026-08-10

### Added

- Clickable prerequisite chips that switch to the prerequisite's category and open that technology.
- Benny rerolls for recorded SWADE research rolls, including remaining-Benny display and a spend confirmation.
- Persistent Benny reroll count and latest reroll total in the project result.

### Changed

- Benny rerolls use SWADE's native reroll modifiers and keep the higher of the previous best and new total.
- Module-managed SWADE chat rolls disable the system's independent reroll control so every Benny reroll remains synchronized with research progress.

### Fixed

- SWADE Trait Rolls with numeric modifiers and an unreported evaluation flag are now evaluated before their total is recorded.

## [0.1.4] - 2026-08-10

### Added

- Export of the currently selected country, research facility, or personal research as a standalone technology-tree JSON file.
- Additive single-tree import that preserves every technology tree already present in the world.
- Separate full-backup export and destructive full-backup restore controls.

### Changed

- Imported tree IDs are always regenerated and every category, prerequisite, modifier, reward, and scope reference is remapped safely.
- Single-tree transfers intentionally start without projects, progress, roll history, or completion state.

### Fixed

- Importing a technology tree no longer replaces the entire research catalog.

## [0.1.3] - 2026-08-02

### Added

- Per-organization research points for a successful SWADE roll, independently configurable from the per-raise award.
- Success or failure state in project roll results and research chat cards.

### Fixed

- Unevaluated SWADE `TraitRoll` results are now evaluated before reading their total, so successes and raises no longer save as zero.
- Numeric skill modifiers such as `+1` remain part of the native SWADE roll and no longer prevent the result from being recorded.

### Changed

- World schema upgraded to version 4 with a backward-compatible default of 1 RP on success.

## [0.1.2] - 2026-08-02

### Added

- Per-organization research points awarded for each SWADE raise.
- GM toolbar action to reset the counter to Week 1 while preserving project progress.
- Raise count in project roll results and research chat cards.

### Fixed

- Custom skills now resolve by both their SWID and exact embedded Skill name, including duplicate or nonstandard SWIDs.
- SWADE rolls now persist the calculated raise count and research-point award.

### Changed

- World schema upgraded to version 3 with backward-compatible defaults for raise awards and skill names.

## [0.1.1] - 2026-08-01

### Added

- Personal research organizations in the left sidebar.
- Per-organization SWADE skill selection sourced from world actor sheets.
- SWADE-native lead researcher rolls using the assigned actor's embedded Skill item.

### Changed

- World schema upgraded to version 2 with backward-compatible entity and roll-record normalization.
- Untouched legacy `1d20` defaults migrate to the SWADE skill roll mode; custom roll configurations remain unchanged.

## [0.1.0] - 2026-07-31

### Added

- Initial Foundry Virtual Tabletop v13 module release.
- ApplicationV2 and Handlebars-based research workspace.
- World-scoped research catalog, project state, configuration, validation, and schema migration services.
- Country, research facility, category, technology, project, engineer, and modifier workflows.
- Weekly research calculation, Engineering rolls, completion rewards, summaries, and bounded history.
- GM-authoritative module socket workflow and entity visibility controls.
- JSON backup, import, and export workflow.
- English and Turkish localization.
- Node test and PowerShell packaging commands.
