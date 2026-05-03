import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/window-animations.css'
import App from './App.tsx'
import { initDb, getDbMeta } from '@/lib/db'
import { seedBundledAppsAtBoot } from '@/runtime/seed-bundled-apps'
import { migrateLegacyMusicCreatorTables } from '@/runtime/legacy-migrations'
import { I18nProvider } from '@/i18n'

// Boot the SQLite worker before mounting. Failure here is non-fatal:
// the app still renders, repos detect getDb() === null and route to
// the legacy localStorage path until the user reloads in a supported
// browser. This keeps OPFS-less environments (older Safari, some
// privacy-locked-down profiles) functional.
initDb()
  .then(async (db) => {
    const meta = getDbMeta()
    if (meta) {
      console.info(
        `[tytusos] SQLite ready (lib=${meta.libVersion}, schema=v${meta.version}, ` +
          `${meta.persistent ? 'OPFS-persistent' : 'in-memory fallback'})`,
      )
    }
    // One-shot legacy-data migration. Lifts music_creator_* rows
    // into the per-app prefixed namespace BEFORE per-app DBs bind —
    // workspace packages can't see un-prefixed legacy tables. Each
    // step is idempotent via migration_flags so re-runs are no-ops.
    // Failure is non-fatal; per-app gallery just renders empty for
    // pre-existing tracks until the next boot retries.
    try {
      const result = await migrateLegacyMusicCreatorTables(db)
      if (
        result.tracksImported > 0
        || result.settingsImported > 0
        || result.youtubeToLibraryImported > 0
      ) {
        console.info(
          `[tytusos] legacy migration: tracks=${result.tracksImported} settings=${result.settingsImported} yt→library=${result.youtubeToLibraryImported}`,
        )
      }
    } catch (err) {
      console.warn('[tytusos] legacy music_creator_* migration failed', err)
    }
    // Seed installed_apps with bundled manifests (idempotent — re-
    // asserts manifest_json every boot). Failure is non-fatal; App
    // Store + cross-app shares degrade to empty until next boot.
    try {
      await seedBundledAppsAtBoot(db)
    } catch (err) {
      console.warn('[tytusos] bundled-apps seed failed', err)
    }
    // Dev-only debug handle. Lets you poke at the DB from DevTools:
    //   await window.tytusDb.query('SELECT count(*) as n FROM api_history')
    //   await window.tytusDb.query('SELECT * FROM api_collections')
    //   await window.tytusDb.run('DELETE FROM api_history')   // careful!
    // Stripped from production builds by import.meta.env.DEV.
    if (import.meta.env.DEV) {
      const [history, collections, musicLibrary, downloadMod] = await Promise.all([
        import('@/lib/repo/apiHistory'),
        import('@/lib/repo/apiCollections'),
        import('@/lib/repo/musicLibrary'),
        import('@/lib/db/download'),
      ])
      ;(window as unknown as Record<string, unknown>).tytusDb = Object.assign(db, {
        download: downloadMod.downloadDb,
      })
      ;(window as unknown as Record<string, unknown>).tytusRepos = { history, collections, musicLibrary }
      console.info(
        '[tytusos] dev handles: window.tytusDb (raw + .download()), window.tytusRepos (repos)',
      )
    }
  })
  .catch((err) => {
    console.warn('[tytusos] SQLite init failed — repos will use legacy storage', err)
  })

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
)
