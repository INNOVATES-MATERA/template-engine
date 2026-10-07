# template-engine

Libreria UI5 (namespace `tplengine`) per creare e generare documenti da template HTML:

- **template** scritti in un editor di testo ricco con segnaposto `{{campo}}`;
- **elenchi ripetibili** (righe di tabella e blocchi) con `{{#each elenco}}`;
- **export** del documento finale in **PDF** e **Word (.docx)**;
- **storage** dei template e del catalogo dei campi, intercambiabile (service OData `Template` oppure localStorage).

La libreria non conosce i dati di nessuna app: l'app prepara i valori già formattati, la libreria li inserisce nel template.
La struttura delle tabelle del service è descritta in [docs/DATABASE.md](docs/DATABASE.md).

## Struttura del repository

```
template-engine/
├── package.json            dipendenze di sviluppo e script (build, ts-typecheck)
├── package-lock.json       versioni bloccate delle dipendenze
├── ui5.yaml                configurazione UI5 tooling (type: library, transpile TypeScript, esclusione thirdparty dal preload)
├── tsconfig.json           opzioni TypeScript e path alias tplengine/*
├── .gitignore              node_modules e dist
├── docs/
│   └── DATABASE.md         entità del service Template e relazioni
└── src/tplengine/          codice della libreria (namespace tplengine)
    ├── .library            descrittore UI5 della libreria (nome, versione, dipendenze)
    ├── library.ts          inizializzazione della libreria con sap.ui.core.Lib
    ├── types.ts            interfacce dei dati (app, gruppi, campi, template, elenchi)
    ├── TemplateEngine.ts   motore: segnaposto, elenchi ripetibili, stile
    ├── export/
    │   ├── PdfExporter.ts             export PDF
    │   └── DocxExporter.ts            export Word
    ├── storage/
    │   ├── ITemplateStorage.ts        contratto dello storage
    │   ├── ODataTemplateStorage.ts    storage sul service OData Template
    │   └── LocalTemplateStorage.ts    storage locale (seed + localStorage)
    ├── utils/
    │   └── loadGlobalScript.ts        caricamento degli script UMD vendorizzati
    └── thirdparty/
        ├── docx.bundle.min.js         libreria docx (generazione .docx)
        └── html2pdf.bundle.min.js     libreria html2pdf.js (generazione PDF)
```

## Descrizione dei file

### Configurazione

| File | Cosa contiene |
|---|---|
| `package.json` | Solo dipendenze di sviluppo: `@ui5/cli`, `typescript`, `@sapui5/types`, `ui5-tooling-transpile`. Script `build` (typecheck + `ui5 build` in `dist/`), `ts-typecheck`, `start`. |
| `ui5.yaml` | Progetto di tipo `library` chiamato `tplengine`, framework SAPUI5 1.148.0 (`sap.ui.core`). Il task `ui5-tooling-transpile-task` compila il TypeScript. `libraryPreload.excludes` lascia fuori `thirdparty/`: i bundle minificati non sono analizzabili da UI5 e vengono caricati a runtime come file separati. |
| `tsconfig.json` | Target ES2022, `strict`, alias `tplengine/*` → `src/tplengine/*`, tipi da `@sapui5/types`. |

### Descrittori della libreria

| File | Cosa fa |
|---|---|
| `.library` | Descrittore XML richiesto da UI5: nome `tplengine`, versione, dipendenza da `sap.ui.core`. |
| `library.ts` | Registra la libreria con `Lib.init` (senza controlli, senza CSS). Serve perché le app possano dichiararla tra le `libs` del manifest. |

### Dati

| File | Cosa fa |
|---|---|
| `types.ts` | Interfacce condivise: `TplApp`, `TplGroup`, `TplField`, `TplTemplate` (ricalcano le entità del service Template), `TplCatalog` (gruppi + campi di un'app) e `TemplateList` (un elenco ripetibile con le chiavi delle sue colonne). |

### Motore

| File | Cosa fa |
|---|---|
| `TemplateEngine.ts` | Un'istanza per editor o documento. <br>`setCatalog(catalogo)` impara quali campi e quali elenchi esistono e ne ricava i **dati d'esempio** dai `sampleValue`. <br>`getSampleData()` restituisce i dati d'esempio per l'anteprima. <br>`getLists()` restituisce gli elenchi ripetibili. <br>`render(html, dati)` produce l'HTML finale: espande i blocchi `{{#each x}}…{{/each}}`, ripete le righe di tabella che contengono `{{#each x}}`, converte i salti pagina, applica uno stile uniforme a tabelle, titoli e paragrafi (lo stile scelto dall'utente nell'editor prevale), sostituisce i `{{campo}}`. I valori vengono scritti con escape HTML; un valore vuoto diventa «—». I segnaposto sconosciuti, gli elenchi sconosciuti e le ripetizioni senza chiusura sono evidenziati in rosso. |

### Export

| File | Cosa fa |
|---|---|
| `export/PdfExporter.ts` | `download(html, nomeFile)`: monta l'HTML in un contenitore temporaneo e genera un PDF A4 verticale con html2pdf.js (margine 10 mm, interruzioni di pagina CSS). La promise si risolve a download avviato; se fallisce viene rifiutata. |
| `export/DocxExporter.ts` | `download(html, nomeFile)` e `toBlob(html)`: legge l'HTML già renderizzato e costruisce un .docx con la libreria `docx`: titoli, paragrafi, stili inline, elenchi puntati e numerati, tabelle (bordi, sfondi, larghezze, colspan/rowspan, padding) e immagini. Misura le larghezze delle celle come le calcola il browser. Pagina A4 con margini di 2,54 cm. Gli errori arrivano al chiamante. |

### Storage

| File | Cosa fa |
|---|---|
| `storage/ITemplateStorage.ts` | Contratto con tre operazioni: `getCatalog(codiceApp)`, `getDefaultTemplate(codiceApp)`, `saveTemplate(codiceApp, nome, html)`. L'app si indica con il suo **codice** (es. `SCHEDE_CEL`). |
| `storage/ODataTemplateStorage.ts` | Implementazione sul service OData V4 `Template`. Riceve il model OData dell'app. Ricava il Guid dell'app da `Apps.code` (una sola richiesta per codice, poi in memoria), legge `Groups` e `Fields` attivi ordinati per `sortOrder` (i campi si filtrano attraverso il gruppo), chiama la funzione `getDefaultTemplate` e l'azione `saveTemplate`. Se non esiste ancora un template il 404 diventa `undefined`. |
| `storage/LocalTemplateStorage.ts` | Implementazione senza backend: catalogo da un seed passato dall'app, template nel localStorage del browser (una riga per versione). Opzioni: `seed`, `storageKey`, `defaultTemplateId`, `legacy` (migrazione del vecchio formato a template singolo). Utile per sviluppo e mock. |

### Utilità e terze parti

| File | Cosa fa |
|---|---|
| `utils/loadGlobalScript.ts` | Carica uno script UMD vendorizzato e restituisce il suo oggetto globale (`docx`, `html2pdf`). Disattiva temporaneamente `window.define` durante il caricamento, perché UI5 ha sempre `define.amd` e lo script altrimenti si registrerebbe nel loader invece di esporsi su `window`. Le richieste ripetute riusano la stessa promise. |
| `thirdparty/docx.bundle.min.js` | Bundle della libreria npm `docx`, caricato solo al primo export Word. |
| `thirdparty/html2pdf.bundle.min.js` | Bundle di `html2pdf.js`, caricato solo al primo export PDF. |

I bundle stanno qui e non in `node_modules` perché `ui5-tooling-transpile` non include le dipendenze npm esterne e l'import diretto fallisce a runtime.

## Sintassi dei template

| Sintassi | Effetto |
|---|---|
| `{{protocollo}}` | Valore del campo `protocollo`. |
| Cella di una riga di tabella con `{{#each affidatari}}` | Quella riga viene ripetuta per ogni elemento dell'elenco `affidatari`; nella riga si usano i campi dell'elenco (`{{ragioneSociale}}`). |
| Un paragrafo `{{#each affidatari}}`, i blocchi in mezzo, un paragrafo `{{/each}}` | I blocchi in mezzo si ripetono per ogni elemento. |
| `<hr data-pagebreak>` | Salto pagina. |

## Uso in un'app

```ts
import TemplateEngine from "tplengine/TemplateEngine";
import ODataTemplateStorage from "tplengine/storage/ODataTemplateStorage";
import PdfExporter from "tplengine/export/PdfExporter";
import DocxExporter from "tplengine/export/DocxExporter";

const oStorage = new ODataTemplateStorage(this.getOwnerComponent().getModel("Template") as ODataModel);
const oEngine = new TemplateEngine();

oEngine.setCatalog(await oStorage.getCatalog("SCHEDE_CEL"));
const oTemplate = await oStorage.getDefaultTemplate("SCHEDE_CEL");

const sHtml = oEngine.render(oTemplate.htmlBody, oDatiDellApp); // valori già formattati
await PdfExporter.download(sHtml, "Scheda_CEL");
await DocxExporter.download(sHtml, "Scheda_CEL");
```

I dati dell'app sono un oggetto con i campi singoli (`{ protocollo: "…" }`) e, per ogni elenco, un array di oggetti (`{ affidatari: [{ ragioneSociale: "…" }] }`).

## Installazione in un'app

1. `package.json` dell'app: `"template-engine": "file:../template-engine"`, poi `npm install`.
2. `manifest.json`: `"tplengine": {}` tra `sap.ui5/dependencies/libs`.
3. `tsconfig.json` dell'app: `"tplengine/*": ["../template-engine/src/tplengine/*"]` nei `paths`, senza `rootDir`.
4. Sviluppo: il proxy Fiori inoltra `/resources` a ui5.sap.com, quindi serve il middleware `fiori-tools-servestatic` che mappa `/resources/tplengine` su `../template-engine/dist/resources/tplengine`. La libreria va buildata prima.
5. L'app deve avere il model OData V4 `Template` verso `/odata/v4/Template/` (datasource e model nel manifest).

## Build

```
npm install
npm run build   # typecheck + ui5 build → dist/
```
