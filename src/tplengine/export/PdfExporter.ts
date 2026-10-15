import loadGlobalScript from "../utils/loadGlobalScript";

/**
 * @namespace tplengine.export
 *
 * Genera il PDF (A4 verticale) dall'HTML già renderizzato di un template tramite html2pdf.js.
 */
export default class PdfExporter {
  /** Spazio in px aggiunto sopra i blocchi che non devono spezzarsi (vedi _addBreakRoom). */
  private static readonly BREAK_ROOM_PX = 3;

  /**
   * Aggiunge un piccolo spazio sopra i blocchi con break-inside:avoid.
   * html2pdf sposta un blocco che attraversa il confine di pagina inserendo uno spaziatore calcolato in px:
   * l'arrotondamento fa cadere il blocco 1-2 px prima del confine e in fondo alla pagina resta una striscia
   * con la parte alta dei caratteri (per esempio il titolo di un quadro). Con lo spazio sopra, la striscia è vuota.
   * @param oContainer contenitore dell'HTML da esportare
   */
  private static _addBreakRoom(oContainer: HTMLElement): void {
    oContainer.querySelectorAll<HTMLElement>("*").forEach((oEl) => {
      const oStyle = window.getComputedStyle(oEl);
      const bAvoid = oStyle.breakInside === "avoid" || oStyle.pageBreakInside === "avoid";
      if (bAvoid && oStyle.display === "block") oEl.style.paddingTop = `${(parseFloat(oStyle.paddingTop) || 0) + PdfExporter.BREAK_ROOM_PX}px`;
    });
  }

  /** Crea un DOM temporaneo dall'HTML e ne avvia il download come PDF; la promise si risolve a download avviato. */
  public static async download(sHtml: string, sFilename: string): Promise<void> {
    if (!sHtml) return;

    const fnHtml2Pdf = await loadGlobalScript("tplengine/thirdparty/html2pdf.bundle.min.js", "html2pdf");

    const oContainer = document.createElement("div");
    oContainer.innerHTML = sHtml;
    document.body.appendChild(oContainer);
    PdfExporter._addBreakRoom(oContainer);
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
