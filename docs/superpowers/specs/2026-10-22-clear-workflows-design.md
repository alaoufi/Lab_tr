# Clear section workflows and sending notes

User-approved direction: persistent tabs instead of an action landing page.

## Interface

Each section has four persistent tabs: إضافة يدوية، من المكتبة، الترتيب والإدارة، نسخة الإرسال. Manual entry contains the add button and editable saved items. Library selection has its own screen. Organization contains item ordering and links to categories, fields and groups. Sending contains selection and the path to preview, without editing tools. Tabs remain visible on related section screens and use distinct labels rather than icon-only actions. Sections without a bundled library show an honest empty state with a manual-entry link.

The home page chooses a section without requiring a global mode first. Existing records, groups, custom sections, fields, search and return navigation remain usable. Old internal entry points remain compatible. The application heading is geometrically centered with room reserved for navigation controls. The output document/image title is centered when the existing show-title preference enables it.

## Sending

Sending has explicit selection, recipient details, and preview stages. Recipient details include the existing optional name and new optional multiline notes. Notes belong to this send, appear after all items in HTML preview, PDF, print, image and copied text, and produce no label or empty space when blank or whitespace-only. They are escaped in HTML and preserve newlines. Switching preview formats must retain name, notes and selection. A new send starts with empty recipient details. Reopening a sent record restores its notes; old records default to empty notes.

Persist notes using an additive nullable text column in the existing sent table, with the existing safe schema-repair mechanism. Preserve all previous data and signing identity. No new provider or network feature is needed.

## Delivery and safety

Baseline c1a5b66 (5.8 / 49) is archived outside the repository and retained on GitHub branch codex/backup-before-development-20261022-191039. Original local b4f74de is independently archived. Both archives were verified; the complete Git bundle was restored and fsck checked. Baseline has 192 passing Node tests.

Deliver an updated signed APK with increasing version code and unchanged application ID/signing certificate. Validate regression tests, notes across output formats and history, navigation, narrow-width layout, APK source assets and signature. Building an APK does not establish successful installation on a physical phone.
