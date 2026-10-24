# Send requirements and note formatting

User approved: an editable requirements box below the selected items, followed by optional notes. Identical requirements appear once. Color and bold apply to the entire note. Deliver an in-place signed APK update preserving existing data.

- Collect the explicit `requirements` field of selected labs, imaging and medicines. Add an optional medicine requirements input; never infer requirements from dosage, cautions or other clinical text.
- Deduplicate nonempty lines by trimmed/collapsed horizontal whitespace only, preserving first-seen text/order and different numbers, punctuation or wording. This is text deduplication, not medical equivalence.
- Requirements move to a send footer. Automatic collection honors the existing requirements visibility setting; hiding a field must not leak it into the footer. Enable the new medicine field once with a persisted `med_req_out_done` guard; subsequent hiding and backup restore preserve the choice. Remove the original requirements field from individual output rows, retaining it in item details. Blank footer is omitted. Manual edits affect this send only and are deduplicated on output.
- Details stage: recipient, editable requirements, restore-from-selected-items button, notes, color picker and bold checkbox. Controls preserve typing focus. Formatting applies to the complete note in HTML/PDF/print and Canvas; copied plain text carries content without color/bold markup.
- Automatic requirements track selection/reorder until edited. Preserve manual changes; if selection changes, display a review hint on details and preview with a way to restore current requirements. Do not silently discard edits.
- Send history keeps requirements snapshot and whole-note style in a nullable `send_options` JSON text column. Keep legacy notes intact. Missing metadata uses automatic requirements and dark regular notes. Validate colors to six-digit hex; boolean bold only; escape all text.
- Native schema 12 adds nullable `meds.requirements` and `sent.send_options`. Same package, database name and signing identity. Existing IDs, order, selections, groups and values remain unchanged. New APK version 5.10 (52).
- Rollback is source/archive/APK at commit 11c15e98d0ec35203a046d9d67a0a35dd7dfbcbf, not a backup of the phone's private data. No uninstall is required or recommended.

Validation: behavioral Node tests for dedup/edit/reset/selection/history and every output; SQLite additive migration tests; browser controls and 320px layouts; release build/lint; signature/package/version and packaged assets; remote APK hash. Physical-device install is outside available evidence.
