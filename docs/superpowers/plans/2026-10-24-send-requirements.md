# Send requirements implementation plan

> Execute with subagent-driven-development: isolated native persistence task and independent final reviews.

1. Preserve 5.9.1 source, all-ref bundle, APK and remote rollback branch. Verify bundle and hashes. Done before code changes.
2. Add failing regression tests for new footer, deduplication, edits/selection and formatting. Implement shared send options, requirements collection, details controls and output handling in app.js; modest responsive CSS.
3. Native persistence task: additive schema 12, medicine requirements and sent metadata read/write/import/export, migration tests preserving legacy fixtures. No other files owned by this task.
4. Run all behavioral tests, review spec and code quality, exercise browser at narrow/mobile sizes. Capture output screenshot.
5. Bump release to 5.10/52, assemble/lint, verify same signing certificate and package, verify bundled assets and copy APK. Update draft PR and dev branch, download immutable artifact and compare SHA256. Deliver link, screenshot and concise upgrade guidance.
