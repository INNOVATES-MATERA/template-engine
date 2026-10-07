import type { TplCatalog, TplGroup, TplField, TplTemplate } from "../types";
import type ITemplateStorage from "./ITemplateStorage";

export interface LocalTemplateStorageOptions {
  /** Catalogo di partenza (tutte le app): i gruppi si filtrano per appId (qui è il codice dell'app) e isActive, i campi per gruppo. */
  seed: { groups: TplGroup[]; fields: TplField[] };
  /** Chiave del localStorage dove stanno le righe dei template, una per versione. */
  storageKey: string;
  /** Id del template di default quando non ce n'è ancora nessuno (default "T01"). */
  defaultTemplateId?: string;
  /** Formato precedente: un solo template salvato come { a: { name, html } } sotto questa chiave, riportato come versione 1. */
  legacy?: { storageKey: string; appCode: string };
}

/**
 * @namespace tplengine.storage
 *
 * Catalogo da un seed passato dall'app e template nel localStorage del browser. Restituisce righe con la stessa
 * struttura delle entità del service Template, quindi è intercambiabile con ODataTemplateStorage.
 */
export default class LocalTemplateStorage implements ITemplateStorage {
  constructor(private readonly _oOptions: LocalTemplateStorageOptions) {}

  public getCatalog(sAppCode: string): Promise<TplCatalog> {
    const byOrder = (a: { sortOrder: number }, b: { sortOrder: number }) => a.sortOrder - b.sortOrder;
    const { groups, fields } = this._oOptions.seed;
    const aGroups = groups.filter((g) => g.appId === sAppCode && g.isActive).sort(byOrder);
    const aGroupIds = new Set(aGroups.map((g) => g.groupId));
    return Promise.resolve({
      groups: aGroups,
      fields: fields.filter((f) => aGroupIds.has(f.groupId) && f.isActive).sort(byOrder),
    });
  }

  public getDefaultTemplate(sAppCode: string): Promise<TplTemplate | undefined> {
    return Promise.resolve(this._latestDefault(this._readAll(), sAppCode));
  }

  public saveTemplate(sAppCode: string, sName: string, sHtml: string): Promise<TplTemplate> {
    const aAll = this._readAll();
    const oCurrent = this._latestDefault(aAll, sAppCode);
    const oNew: TplTemplate = {
      appId: sAppCode,
      templateId: oCurrent?.templateId ?? this._oOptions.defaultTemplateId ?? "T01",
      version: (oCurrent?.version ?? 0) + 1,
      name: sName,
      htmlBody: sHtml,
      isDefault: true,
    };
    return this._writeAll([...aAll, oNew]) ?
        Promise.resolve(oNew)
      : Promise.reject(new Error("Salvataggio nel localStorage non riuscito"));
  }

  private _latestDefault(aRows: TplTemplate[], sAppCode: string): TplTemplate | undefined {
    return aRows.filter((t) => t.appId === sAppCode && t.isDefault).sort((a, b) => b.version - a.version)[0];
  }

  private _readAll(): TplTemplate[] {
    try {
      const sRows = window.localStorage.getItem(this._oOptions.storageKey);
      if (sRows) return JSON.parse(sRows) as TplTemplate[];

      // primo avvio con il nuovo formato: se c'è il vecchio template lo riporto come versione 1
      const oLegacyCfg = this._oOptions.legacy;
      if (oLegacyCfg) {
        const oLegacy = (
          JSON.parse(window.localStorage.getItem(oLegacyCfg.storageKey) ?? "{}") as {
            a?: { name: string; html: string };
          }
        ).a;
        if (oLegacy?.html) {
          return [
            {
              appId: oLegacyCfg.appCode,
              templateId: this._oOptions.defaultTemplateId ?? "T01",
              version: 1,
              name: oLegacy.name,
              htmlBody: oLegacy.html,
              isDefault: true,
            },
          ];
        }
      }
    } catch {
      // storage non disponibile o contenuto non valido: si riparte da vuoto
    }
    return [];
  }

  private _writeAll(aRows: TplTemplate[]): boolean {
    try {
      window.localStorage.setItem(this._oOptions.storageKey, JSON.stringify(aRows));
      return true;
    } catch {
      return false;
    }
  }
}
