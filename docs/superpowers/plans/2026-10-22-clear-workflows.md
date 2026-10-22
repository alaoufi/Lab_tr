# Clear Workflows Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve the verified rollback branch and archives. Work in the prepared codex/development-20261022-191039 branch.

**Goal:** Deliver a signed APK with clear persistent section tabs, centered titles and optional sending notes.

**Architecture:** Keep the existing ES5 asset application and native SQLite bridge. Add explicit section routes around existing renderers; extend the output functions with an optional notes argument and the sent record with an additive notes column.

**Tech Stack:** Android Java, Gradle 8.9/AGP 8.5.2, JavaScript/HTML/CSS, SQLite, Node assertion harness.

## 1. Baseline and build tools

- [x] Verify original and current backups, remote rollback branch, bundle recovery and 192 baseline tests.
- [ ] Locate or install official Android SDK components required by the existing build, using the existing JDK. Keep installation outside source and local SDK settings ignored.
- [ ] Verify baseline APK signing certificate before replacing the distributed artifact.

## 2. Optional notes and preview stages

Files: app/src/main/assets/app.js output/preview functions, app/src/main/java/me/alaoufi/dalili/DaliliDb.java, tools/test_output_notes.js, docs/DATABASE.md, docs/schema.sql.

- [ ] Write and run failing behavioral tests for blank notes, escaped multiline notes, notes after items, all output calls, canvas rendering, persistence and old records.
- [ ] Extend docBody, printDoc, buildCanvas, listText and their send wrappers with optional trailing notes; carry PV.notes through all paths.
- [ ] Add the recipient-details preview stage with name and notes; retain selected items and edits across stages. Render sharing controls in the final preview stage.
- [ ] Add notes to sent table creation, upgrade/repair, read and write. Reuse existing import/export behavior.
- [ ] Run `node tools/test_output_notes.js` and `node tools/test_store.js`; review native changes for additive migration and compatibility.

## 3. Persistent workflow tabs and centered heading

Files: app/src/main/assets/app.js routing/header/section functions, app/src/main/assets/index.html, tools/test_workflows.js.

- [ ] Write failing navigation tests for tab routing, selected tab, mode isolation, back navigation, custom sections and library availability.
- [ ] Add route-aware section context and a sticky tab strip outside page content. Route manual and sending to existing lists with distinct modes; organization uses existing sort/category/field/group screens.
- [ ] Remove global home mode selection and redundant mixed-purpose section toolbars. Keep legacy callable entry points functional.
- [ ] Center the header using balanced navigation areas, with wrapping/clipping behavior that remains usable on a narrow phone.
- [ ] Validate workflow tests and existing regression tests; update assertions only where the requested UI intentionally changes.

## 4. Integration and APK

- [ ] Review spec compliance, then code quality with a fresh reviewer and address actionable issues.
- [ ] Validate manual/library/order/send paths and optional notes in the browser, including narrow viewport and multiline content.
- [ ] Increment versionCode/versionName consistently, build `assembleRelease`, verify signer matches original APK and packaged assets match final source.
- [ ] Preserve a local APK delivery and test evidence, commit reviewed changes to the development branch, and report exact delivery/remaining physical-device validation limits.
