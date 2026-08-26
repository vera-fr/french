# Französisch lernen — sito statico (Astro)

Sito statico con 198 pagine di grammatica e vocabolario francese in lingua tedesca:
grammatica, vocabolario (Wortschatz), calligrafia (Schreibschule) e ortografia
(Rechtschreibung). Audio, glossari inline e traduzioni già inclusi, con ricerca
full-text lato client (niente backend).

## Cosa c'è dentro

| Cartella / file       | Descrizione                                                      |
| --------------------- | --------------------------------------------------------------- |
| `src/pages/`          | Pagine Astro: home, `[...slug].astro` (198 pagine), `suche`, 404 |
| `src/content/`        | `meta.json` (titoli, descrizioni, TOC) + pagine HTML trasformate |
| `public/`             | Audio (esempi + TTS), immagini, `search-index.json`              |
| `scripts/transform.mjs` | Pipeline: crawl → HTML pulito + download media (riproducibile)  |
| `scripts/apply-base.mjs` | Riscrive gli URL in `dist/` quando si pubblica in sottocartella |
| `.work/`              | Crawl originale (sezione DE) — input della pipeline              |
| `original/`           | Crawl della sezione IT — solo provenienza, non usato             |

Il sito non contiene parti interattive (Konjugator, esercizi,
Hör-/Leseverstehen, Glossar): le pagine si limitano a spiegazioni, esempi,
liste e tabelle. Tutti i riferimenti e i link al sito originale sono stati
rimossi.

## Sviluppo locale

```bash
npm install            # serve Node 20+ (testato con Node 24)
npm run dev            # http://localhost:4321
```

`npm run dev` rielabora il crawl, poi avvia il server Astro.

## Build

```bash
npm run build          # build alla radice / (dist/)
BASE_PATH=/nome-repo npm run build   # build in sottocartella /nome-repo/
```

La variabile `BASE_PATH` determina l'URL di base: `/` per domini
`*.github.io`, `/nome-repo/` per i repository. I contenuti e i link sono
generati in forma root-absolute e `apply-base.mjs` li riscrive in `dist/`
se serve.

## Deploy su GitHub Pages

Il workflow `.github/workflows/deploy.yml` (GitHub Actions) fa tutto:
compila e pubblica su GitHub Pages. Dopo aver spinto su `main`, in
**Settings → Pages** scegli **Source: GitHub Actions**.
Lo `BASE_PATH` viene calcolato automaticamente dal nome del repository.

```bash
git push origin main
```

## Rielaborare i contenuti

La pipeline è deterministica e idempotente:

```bash
node scripts/transform.mjs
```

Rilegge `.work/de/pages/`, rigenera `src/content/` e `public/` e
scarica i media mancanti. Le traduzioni dei tooltip vengono inlined
direttamente nell'HTML, così non serve alcun JS per leggere le pagine.
