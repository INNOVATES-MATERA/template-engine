import type { TemplateList, TplCatalog } from "./types";

// Marcatori di ripetizione scritti nel testo del template:
//  - riga di tabella: {{#each elenco}} dentro una cella della riga, che viene ripetuta;
//  - blocco: un paragrafo con {{#each elenco}} e uno con {{/each}}, i blocchi in mezzo vengono ripetuti.
const RE_OPEN = /\{\{\s*#each\s+(\w+)\s*\}\}/;
const RE_OPEN_EXACT = /^\{\{\s*#each\s+(\w+)\s*\}\}$/;
const RE_CLOSE_EXACT = /^\{\{\s*\/each\s*\}\}$/;
const RE_OPEN_SPAN = /<span[^>]*>\s*\{\{\s*#each\s+\w+\s*\}\}\s*<\/span>/g;
const RE_OPEN_ALL = /\{\{\s*#each\s+\w+\s*\}\}/g;
const RE_LEFTOVER = /\{\{\s*[#/]each[^}]*\}\}/g;

/**
 * @namespace tplengine
 *
 * Motore dei template: sostituzione dei segnaposto {{campo}} con i dati, ripetizione
 * di righe e blocchi per gli elenchi (array) e stile uniforme delle tabelle. Il catalogo dei campi arriva
 * dallo storage dell'app (ITemplateStorage) tramite setCatalog; ogni editor o documento usa una propria istanza.
 * I valori devono essere già formattati da chi prepara i dati.
 */
export default class TemplateEngine {
    /** Chiavi dei campi singoli inseribili nel template. */
    private _fieldKeys: string[] = [];

    /** Elenchi ripetibili con le chiavi delle loro colonne. */
    private _lists: TemplateList[] = [];

    /** Dati di esempio per l'anteprima, ricavati dai sampleValue del catalogo. */
    private _sampleData: Record<string, unknown> = {};

    /**
     * Impara i campi e gli elenchi dell'app dal catalogo (gruppi e campi letti dallo storage) e ne ricava i dati d'esempio.
     * Gruppo di campi singoli: chiavi dei campi e relativo sampleValue. Gruppo elenco: un array di righe, ricavato dai sampleValue
     * delle colonne (un valore per riga, separati da ";"), e l'elenco con le chiavi delle sue colonne.
     * Va chiamato prima di render.
     */
    public setCatalog(oCatalog: TplCatalog): void {
        const oSample: Record<string, unknown> = {};
        const aKeys: string[] = [];
        const aLists: TemplateList[] = [];

        oCatalog.groups.forEach((oGroup) => {
            const aFields = oCatalog.fields.filter((f) => f.groupId === oGroup.groupId);
            if (!oGroup.isList) {
                aFields.forEach((f) => {
                    aKeys.push(f.fieldKey);
                    oSample[f.fieldKey] = f.sampleValue;
                });
                return;
            }
            // campi di una tabella: sampleValue contiene un valore per riga, separati da ";"
            const aValues = aFields.map((f) => (f.sampleValue ?? "").split(";").map((v) => v.trim()));
            const nRows = Math.max(0, ...aValues.map((a) => a.length));
            oSample[oGroup.groupKey] = Array.from({ length: nRows }, (_, i) =>
                Object.fromEntries(aFields.map((f, c) => [f.fieldKey, aValues[c][i] ?? ""])),
            );
            aLists.push({ key: oGroup.groupKey, columns: aFields.map((f) => f.fieldKey) });
        });

        this._fieldKeys = aKeys;
        this._lists = aLists;
        this._sampleData = oSample;
    }

    /** Elenchi ripetibili con le chiavi delle loro colonne. */
    public getLists(): TemplateList[] {
        return this._lists;
    }

    /** Dati d'esempio per l'anteprima: i campi singoli e, per ogni elenco, l'array delle sue righe. */
    public getSampleData(): Record<string, unknown> {
        return this._sampleData;
    }

    /** Sostituisce &, < e > con le entità HTML, così un valore non può inserire HTML nel documento. */
    private static _escape(s: string): string {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    /** I valori arrivano già formattati: qui si fa solo l'escape e si mostra "—" se mancano. */
    public formatValue(v: unknown): string {
        if (v === null || v === undefined || v === "") return "—";
        return TemplateEngine._escape(String(v));
    }

    /**
     * Sostituisce ogni {{chiave}} con il valore corrispondente nei dati. Le chiavi non presenti in aKeys vengono segnalate
     * in rosso come [chiave?]; con bKeepUnknown restano invariate, per le righe e i blocchi ripetuti dove i campi
     * dell'elenco non sono tra i campi singoli e si risolvono passando le chiavi delle sue colonne.
     */
    private _fillPlaceholders(sHtml: string, oData: Record<string, unknown>, aKeys: string[], bKeepUnknown = false): string {
        return sHtml.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (sMatch, sKey: string) => {
            const bKnown = aKeys.includes(sKey);
            if (!bKnown && bKeepUnknown) return sMatch;
            if (!bKnown) return `<span style="color:#b00020">[${TemplateEngine._escape(sKey)}?]</span>`;
            return this.formatValue(oData[sKey]);
        });
    }

    // ── Ripetizione di righe e blocchi ───────────────────────────────────────────────

    /** Elenco ripetibile con quella chiave; undefined se il catalogo non lo contiene. */
    private _findList(sKey: string): TemplateList | undefined {
        return this._lists.find((l) => l.key === sKey);
    }

    /** Etichetta rossa [elenco chiave?] che prende il posto di una ripetizione su un elenco inesistente. */
    private _unknownList(sKey: string): HTMLElement {
        const oSpan = document.createElement("span");
        oSpan.setAttribute("style", "color:#b00020");
        oSpan.textContent = `[elenco ${sKey}?]`;
        return oSpan;
    }

    /**
     * Blocchi: dal paragrafo "{{#each elenco}}" a quello "{{/each}}" i blocchi in mezzo si ripetono per ogni elemento.
     * Senza paragrafo di chiusura il testo resta com'è e viene segnalato in rosso a fine rendering; con un elenco sconosciuto
     * i blocchi sono sostituiti dall'etichetta rossa.
     */
    private _expandBlocks(oRoot: HTMLElement, oData: Record<string, unknown>): void {
        Array.from(oRoot.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6")).forEach((oStart) => {
            if (!oRoot.contains(oStart)) return;
            const aMatch = RE_OPEN_EXACT.exec((oStart.textContent ?? "").trim());
            if (!aMatch) return;

            const aBody: Element[] = [];
            let oEnd: Element | null = null;
            for (let o = oStart.nextElementSibling; o; o = o.nextElementSibling) {
                if (RE_CLOSE_EXACT.test((o.textContent ?? "").trim())) {
                    oEnd = o;
                    break;
                }
                aBody.push(o);
            }
            if (!oEnd) return; // senza chiusura resta il testo, segnalato in rosso a fine rendering

            const oList = this._findList(aMatch[1]);
            const oOut = document.createElement("div");
            if (!oList) {
                oOut.appendChild(this._unknownList(aMatch[1]));
            } else {
                const sTemplate = aBody.map((o) => o.outerHTML).join("");
                const aItems = (oData[oList.key] as Array<Record<string, unknown>> | undefined) ?? [];
                oOut.innerHTML = aItems
                    .map((oItem) => this._fillPlaceholders(sTemplate, oItem, oList.columns, true))
                    .join("");
            }
            oStart.replaceWith(...Array.from(oOut.childNodes));
            aBody.forEach((o) => o.remove());
            oEnd.remove();
        });
    }

    /**
     * Righe: ogni riga di tabella che contiene "{{#each elenco}}" viene ripetuta per ogni elemento, senza il marcatore.
     * Con un elenco sconosciuto la riga diventa una sola cella con l'etichetta rossa.
     */
    private _expandRows(oRoot: HTMLElement, oData: Record<string, unknown>): void {
        Array.from(oRoot.querySelectorAll("tr")).forEach((oRow) => {
            const aMatch = RE_OPEN.exec(oRow.textContent ?? "");
            if (!aMatch) return;

            const oList = this._findList(aMatch[1]);
            if (!oList) {
                const oCell = document.createElement("td");
                oCell.colSpan = Math.max(oRow.cells.length, 1);
                oCell.appendChild(this._unknownList(aMatch[1]));
                oRow.replaceChildren(oCell);
                return;
            }
            const sClean = oRow.innerHTML.replace(RE_OPEN_SPAN, "").replace(RE_OPEN_ALL, "");
            const aItems = (oData[oList.key] as Array<Record<string, unknown>> | undefined) ?? [];
            const aRows = aItems.map((oItem) => {
                const oClone = oRow.cloneNode(false) as HTMLElement;
                oClone.innerHTML = this._fillPlaceholders(sClean, oItem, oList.columns, true);
                return oClone;
            });
            oRow.replaceWith(...aRows);
        });
    }

    // ── Rendering ────────────────────────────────────────────────────────────────────

    /**
     * Produce l'HTML finale del documento a partire dal template e dai dati (valori già formattati: campi singoli e array per gli elenchi).
     * Espande blocchi e righe ripetute, converte i salti pagina, applica lo stile uniforme a tabelle, titoli e paragrafi
     * (lo stile scelto nell'editor prevale), sostituisce i {{campo}} e segnala in rosso ciò che non torna:
     * campi o elenchi sconosciuti e ripetizioni senza chiusura. Il risultato va a PdfExporter e DocxExporter.
     */
    public render(sTemplateHtml: string, oData: Record<string, unknown>): string {
        const oRoot = document.createElement("div");
        oRoot.innerHTML = sTemplateHtml || "";

        this._expandBlocks(oRoot, oData);
        this._expandRows(oRoot, oData);

        oRoot.querySelectorAll("hr[data-pagebreak]").forEach((oHr) => {
            const oDiv = document.createElement("div");
            oDiv.setAttribute("style", "break-after:page;page-break-after:always;height:0");
            oHr.replaceWith(oDiv);
        });

        // stile di base + stile scelto dall'utente nell'editor (colori, larghezze, allineamenti): quest'ultimo prevale
        const fnStyle = (oEl: Element, sBase: string): void => {
            oEl.setAttribute("style", sBase + (oEl.getAttribute("style") ?? ""));
        };
        oRoot.querySelectorAll("table").forEach((oT) => fnStyle(oT, "width:100%;border-collapse:collapse;margin:6px 0;"));
        oRoot.querySelectorAll("td,th").forEach((oC) =>
            fnStyle(oC, `border:1px solid #222;padding:5px;vertical-align:top;text-align:left;${oC.tagName === "TH" ? "background:#e7e6e6;" : ""}`),
        );
        oRoot.querySelectorAll("tr").forEach((oR) => fnStyle(oR, "break-inside:avoid;page-break-inside:avoid;"));
        oRoot.querySelectorAll("h1").forEach((o) => fnStyle(o, "font-size:18px;margin:0 0 6px;"));
        oRoot.querySelectorAll("h2").forEach((o) => fnStyle(o, "font-size:14px;margin:14px 0 6px;text-align:center;"));
        oRoot.querySelectorAll("h3").forEach((o) => fnStyle(o, "font-size:12px;margin:10px 0 4px;"));
        oRoot.querySelectorAll("p").forEach((o) => fnStyle(o, "margin:4px 0;"));

        const sBody = this._fillPlaceholders(oRoot.innerHTML, oData, this._fieldKeys).replace(
            RE_LEFTOVER,
            `<span style="color:#b00020">[ripetizione incompleta]</span>`,
        );

        // nessuna cornice: il PDF contiene solo il contenuto del template (i margini pagina li dà html2pdf)
        return `<div style="background:white;font-family:Georgia,serif;font-size:11px">${sBody}</div>`;
    }
}
