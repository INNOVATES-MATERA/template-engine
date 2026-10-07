const mPending = new Map<string, Promise<any>>();

/**
 * Carica uno script UMD vendorizzato (docx, html2pdf) e restituisce l'oggetto globale che espone.
 *
 * Gli script stanno in tplengine/thirdparty invece di essere importati come moduli: ui5-tooling-transpile non
 * bundla le dipendenze npm esterne, e sia l'import diretto sia ui5-tooling-modules falliscono a runtime.
 * Il bundle UMD, se caricato dopo il bootstrap di UI5, si registrerebbe nel loader AMD globale (define.amd
 * esiste sempre in UI5) invece di esporsi su window: per questo window.define si disabilita durante il caricamento.
 *
 * @param sModulePath percorso UI5 dello script (es. "tplengine/thirdparty/docx.bundle.min.js")
 * @param sGlobal nome della proprietà di window che lo script espone
 */
export default function loadGlobalScript(sModulePath: string, sGlobal: string): Promise<any> {
  const w = window as any;
  if (w[sGlobal]) return Promise.resolve(w[sGlobal]);
  const pCached = mPending.get(sGlobal);
  if (pCached) return pCached;

  const pLoad = new Promise<any>((resolve, reject) => {
    const sSrc = sap.ui.require.toUrl(sModulePath);
    const oScript = document.createElement("script");
    const fnPrevDefine = w.define;
    w.define = undefined;

    oScript.src = sSrc;
    oScript.onload = () => {
      w.define = fnPrevDefine;
      if (w[sGlobal]) {
        resolve(w[sGlobal]);
      } else {
        mPending.delete(sGlobal);
        reject(new Error(`${sSrc} caricato ma window.${sGlobal} non è stato esposto`));
      }
    };
    oScript.onerror = () => {
      w.define = fnPrevDefine;
      mPending.delete(sGlobal);
      reject(new Error(`Impossibile caricare ${sSrc}`));
    };
    document.head.appendChild(oScript);
  });

  mPending.set(sGlobal, pLoad);
  return pLoad;
}
