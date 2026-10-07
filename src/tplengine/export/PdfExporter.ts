import loadGlobalScript from "../utils/loadGlobalScript";

/**
 * @namespace tplengine.export
 *
 * Genera il PDF (A4 verticale) dall'HTML già renderizzato di un template tramite html2pdf.js.
 */
export default class PdfExporter {
  /** Crea un DOM temporaneo dall'HTML e ne avvia il download come PDF; la promise si risolve a download avviato. */
  public static async download(sHtml: string, sFilename: string): Promise<void> {
    if (!sHtml) return;

    const fnHtml2Pdf = await loadGlobalScript("tplengine/thirdparty/html2pdf.bundle.min.js", "html2pdf");

    const oContainer = document.createElement("div");
    oContainer.innerHTML = sHtml;
    document.body.appendChild(oContainer);
    try {
      await fnHtml2Pdf()
        .set({
          margin: 10,
          filename: `${sFilename || "Documento"}.pdf`,
          html2canvas: { scale: 2 },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "avoid-all"] },
        })
        .from(oContainer)
        .save();
    } finally {
      document.body.removeChild(oContainer);
    }
  }
}
