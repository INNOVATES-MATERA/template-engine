import Filter from "sap/ui/model/Filter";
import FilterOperator from "sap/ui/model/FilterOperator";
import Sorter from "sap/ui/model/Sorter";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type { TplApp, TplCatalog, TplField, TplGroup, TplTemplate } from "../types";
import type ITemplateStorage from "./ITemplateStorage";

// Le entità hanno poche decine di righe per app: una sola richiesta le legge tutte.
const PAGE_SIZE = 1000;

/**
 * @namespace tplengine.storage
 *
 * Catalogo e template dal service OData V4 Template (entità Apps, Groups e Fields, funzione getDefaultTemplate,
 * azione saveTemplate). Usa il model OData V4 dell'app. L'app si indica con il suo codice (Apps.code): il Guid
 * (Apps.appId) si legge dal service una volta sola. La versione di ogni salvataggio la assegna il server.
 */
export default class ODataTemplateStorage implements ITemplateStorage {
  private readonly _mAppIds = new Map<string, Promise<string>>();

  constructor(private readonly _oModel: ODataModel) {}

  public async getCatalog(sAppCode: string): Promise<TplCatalog> {
    const sAppId = await this._getAppId(sAppCode);
    const [groups, fields] = await Promise.all([
      this._readList<TplGroup>(
        "/Groups",
        ["groupId", "appId", "groupKey", "label", "isList", "sortOrder", "isActive"],
        new Filter("appId", FilterOperator.EQ, sAppId),
      ),
      // i campi non hanno l'app: si filtrano attraverso il loro gruppo
      this._readList<TplField>(
        "/Fields",
        ["fieldId", "groupId", "fieldKey", "label", "sampleValue", "sortOrder", "isActive"],
        new Filter("group/appId", FilterOperator.EQ, sAppId),
      ),
    ]);
    return { groups, fields };
  }

  public async getDefaultTemplate(sAppCode: string): Promise<TplTemplate | undefined> {
    const oBinding = this._oModel.bindContext("/getDefaultTemplate(...)");
    oBinding.setParameter("appCode", sAppCode);
    try {
      await oBinding.execute();
    } catch (oError) {
      if (ODataTemplateStorage._isNotFound(oError)) return undefined;
      throw oError;
    }
    return ODataTemplateStorage._toTemplate(oBinding.getBoundContext()?.getObject());
  }

  public async saveTemplate(sAppCode: string, sName: string, sHtml: string, bIsDefault = true): Promise<TplTemplate> {
    const sAppId = await this._getAppId(sAppCode);
    // l'azione aggiunge una versione al template di default: ne indico l'id se esiste già
    const oCurrent = await this.getDefaultTemplate(sAppCode);

    const oBinding = this._oModel.bindContext("/saveTemplate(...)");
    oBinding.setParameter("appId", sAppId);
    if (oCurrent) oBinding.setParameter("templateId", oCurrent.templateId);
    oBinding.setParameter("name", sName);
    oBinding.setParameter("htmlBody", sHtml);
    oBinding.setParameter("isDefault", bIsDefault);
    await oBinding.execute();

    const oSaved = ODataTemplateStorage._toTemplate(oBinding.getBoundContext()?.getObject());
    if (!oSaved) throw new Error("Il service Template non ha restituito il template salvato");
    return oSaved;
  }

  /** Guid dell'app dal suo codice; la richiesta si fa una volta sola per codice (se fallisce si riprova alla chiamata dopo). */
  private _getAppId(sAppCode: string): Promise<string> {
    let pAppId = this._mAppIds.get(sAppCode);
    if (!pAppId) {
      pAppId = this._readList<TplApp>("/Apps", ["appId", "code"], new Filter("code", FilterOperator.EQ, sAppCode)).then((aApps) => {
        if (!aApps.length) throw new Error(`App "${sAppCode}" non trovata nel service Template`);
        return aApps[0].appId;
      });
      pAppId.catch(() => this._mAppIds.delete(sAppCode));
      this._mAppIds.set(sAppCode, pAppId);
    }
    return pAppId;
  }

  /** Righe che rispettano il filtro (e, se hanno sortOrder, solo le attive, ordinate), con le sole proprietà richieste. */
  private async _readList<T>(sPath: string, aProps: string[], oFilter: Filter): Promise<T[]> {
    const bSorted = aProps.includes("sortOrder");
    const oBinding = this._oModel.bindList(
      sPath,
      undefined,
      bSorted ? [new Sorter("sortOrder")] : [],
      bSorted ? [oFilter, new Filter("isActive", FilterOperator.EQ, true)] : [oFilter],
      { $select: aProps },
    );
    const aContexts = await oBinding.requestContexts(0, PAGE_SIZE);
    return aContexts.map((oContext) => oContext.getObject() as T);
  }

  private static _toTemplate(oRow: Partial<TplTemplate> | undefined): TplTemplate | undefined {
    if (!oRow?.templateId) return undefined;
    return {
      appId: oRow.appId!,
      templateId: oRow.templateId,
      version: oRow.version!,
      name: oRow.name!,
      htmlBody: oRow.htmlBody!,
      isDefault: oRow.isDefault!,
    };
  }

  private static _isNotFound(oError: unknown): boolean {
    const o = oError as { status?: number; error?: { code?: string | number } } | undefined;
    return o?.status === 404 || String(o?.error?.code) === "404";
  }
}
