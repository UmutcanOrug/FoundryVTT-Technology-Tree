# Changelog

Research Tech Tree follows [Semantic Versioning](https://semver.org/). Dates use the `YYYY-MM-DD` format.

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
