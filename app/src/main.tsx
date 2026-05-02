import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/window-animations.css'
import App from './App.tsx'
import { initDb, getDbMeta } from '@/lib/db'
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
