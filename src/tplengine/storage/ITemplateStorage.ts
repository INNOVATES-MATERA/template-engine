import type { TplCatalog, TplTemplate } from "../types";

/**
 * @namespace tplengine.storage
 *
 * Sorgente di catalogo e template. L'app si indica con il suo codice (es. "SCHEDE_CEL"). La libreria non sa da dove arrivano: ogni app passa l'implementazione
 * (ODataTemplateStorage verso il service Template, LocalTemplateStorage per sviluppo e mock).
 */
export default interface ITemplateStorage {
  /** Gruppi e campi attivi dell'app, ordinati per sortOrder. */
  getCatalog(sAppCode: string): Promise<TplCatalog>;

  /** Template di default dell'app, nella versione più alta; undefined se non ne è stato ancora salvato nessuno. */
  getDefaultTemplate(sAppCode: string): Promise<TplTemplate | undefined>;

  /** Salva una nuova versione del template e la restituisce; se il salvataggio non riesce la promise viene rifiutata. */
  saveTemplate(sAppCode: string, sName: string, sHtml: string): Promise<TplTemplate>;
}
