# Tytus OS Agent Instructions

Read `README.md` and the project docs before broad changes.

## Non-negotiable UI/i18n rule

When adding or changing user-visible UI text, add translation keys in the same change. Do not leave new labels, placeholders, tooltips, empty states, menu items, or button text hardcoded in React render paths.

- Add English keys in `app/src/i18n/locales/en.ts`.
- Add Spanish keys in `app/src/i18n/locales/es.ts`.
- If the Spanish language pack mirrors the app key, update `language-packs/tytus-os-es/tytus-os.es.json` too.
- Run `npm run i18n:check --workspace app` before calling the change done.

Allowed literals: brand names, file extensions, protocol/API literals, and developer-only logs. Everything user-facing goes through i18n.
