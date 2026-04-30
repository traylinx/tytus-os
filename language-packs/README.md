# Tytus OS Language Packs

Tytus OS supports two install paths:

1. Bundled languages shipped with the app (`en`, `es`).
2. Official downloadable packs from the Tytus OS GitHub catalog.

The app intentionally does **not** accept arbitrary language-pack URLs. The catalog URL is pinned in `Settings.tsx`:

```txt
https://raw.githubusercontent.com/traylinx/tytus-os-language-index/main/catalog.json
```

Each catalog entry must point to `https://raw.githubusercontent.com/traylinx/.../*.json`. Optional `sha256` is verified before install.

Repo layout recommendation:

```txt
tytus-os-language-index/
  catalog.json

tytus-os-lang-es/
  tytus-os.es.json
  README.md
```

See `catalog.example.json` and `tytus-os-es/`.
