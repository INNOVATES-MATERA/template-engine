import loadGlobalScript from "../utils/loadGlobalScript";

/**
 * @namespace tplengine.export
 *
 * Genera il PDF (A4 verticale) dall'HTML già renderizzato di un template tramite html2pdf.js.
 */
export default class PdfExporter {
  /** Altezza della pagina A4 in mm. */
  private static readonly PAGE_HEIGHT_MM = 297;

  /** Margine della pagina in mm. */
  private static readonly MARGIN_MM = 10;

  /** Millimetri per pixel CSS (96 dpi). */
  private static readonly MM_PER_PX = 25.4 / 96;

  /**
   * Calcola i margini [alto, sinistra, basso, destra] in mm della pagina A4.
   * html2pdf tronca a un numero intero di px l'altezza utile (277 mm = 1046,98 px) per decidere dove spostare i blocchi,
   * ma il confine reale della pagina resta frazionario: l'errore si accumula a ogni pagina e un blocco può finire a cavallo
   * del confine (una striscia del titolo in fondo alla pagina, la riga della firma tagliata).
   * Il margine inferiore viene quindi ridotto di poco, in modo che l'altezza utile sia un numero intero di px.
   * @returns margini in mm nell'ordine richiesto da html2pdf
   */
  private static _margins(): number[] {
    const nMargin = PdfExporter.MARGIN_MM;
    const nInnerPx = Math.floor((PdfExporter.PAGE_HEIGHT_MM - 2 * nMargin) / PdfExporter.MM_PER_PX);
    const nBottom = PdfExporter.PAGE_HEIGHT_MM - nMargin - (nInnerPx + 0.002) * PdfExporter.MM_PER_PX;
    return [nMargin, nMargin, nBottom, nMargin];
  }

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
          margin: PdfExporter._margins(),
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
