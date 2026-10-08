import loadGlobalScript from "../utils/loadGlobalScript";

const PAGE_W = 11906; // A4, twips
const PAGE_H = 16838;
const MARGIN = 1440; // 2,54cm, margini standard del Word di riferimento
const TEXT_W = PAGE_W - 2 * MARGIN;
const TWIPS_PER_PX = 15;
const BASE_SIZE = 17; // 11px (font base del template) in mezzi punti
const MAX_IMG_PX = Math.floor(TEXT_W / TWIPS_PER_PX);

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "HR", "BLOCKQUOTE", "SECTION", "ARTICLE", "HEADER", "FOOTER", "PRE"]);
const HEADING_PX: Record<string, number> = { H1: 24, H2: 18, H3: 14, H4: 12, H5: 11, H6: 10 };

interface Ctx {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  font?: string;
  shade?: string;
  sup?: boolean;
  sub?: boolean;
  align?: string;
  indent?: number;
  listLevel?: number;
}

type Item = { text: string; ctx: Ctx } | { br: true } | { img: HTMLImageElement };

interface ImgData {
  data: Uint8Array;
  type: string;
  w: number;
  h: number;
}

interface State {
  d: any;
  images: Map<HTMLImageElement, ImgData>;
  cellW: Map<Element, number>; // larghezze (px) delle celle come le calcola il browser
  listInstance: number;
}

/**
 * @namespace tplengine.export
 *
 * Converte l'HTML già renderizzato di un template (anteprima del PDF) in un .docx costruito
 * con la libreria "docx", percorrendo il DOM: titoli, paragrafi, stili inline, elenchi, tabelle
 * (bordi, sfondi, larghezze, colspan/rowspan, padding) e immagini. Lavora sul contenuto finale,
 * quindi segnaposto e righe ripetute sono già espansi e il template può essere qualunque.
 */
export default class DocxExporter {
  /** Converte l'HTML in .docx e ne avvia il download. Gli errori di conversione arrivano al chiamante. */
  public static async download(sHtml: string, sFilename: string): Promise<void> {
    if (!sHtml) return;

    const oBlob = await DocxExporter.toBlob(sHtml);
    const sUrl = URL.createObjectURL(oBlob);
    const oLink = document.createElement("a");
    oLink.href = sUrl;
    oLink.download = `${sFilename || "Documento"}.docx`;
    document.body.appendChild(oLink);
    oLink.click();
    document.body.removeChild(oLink);
    URL.revokeObjectURL(sUrl);
  }

  public static async toBlob(sHtml: string): Promise<Blob> {
    const d = await loadGlobalScript("tplengine/thirdparty/docx.bundle.min.js", "docx");
    const oDoc = new DOMParser().parseFromString(`<body>${sHtml}</body>`, "text/html");

    const oState: State = { d, images: await DocxExporter._loadImages(oDoc.body), cellW: DocxExporter._measureCells(sHtml, oDoc.body), listInstance: 0 };
    const aChildren = DocxExporter._blocks(oState, oDoc.body, { font: "Georgia", size: BASE_SIZE }, { pageBreak: false });
    if (!aChildren.length) aChildren.push(new d.Paragraph({}));

    const aLevels = (bBullet: boolean): any[] =>
      [0, 1, 2, 3].map((n) => ({
        level: n,
        format: bBullet ? d.LevelFormat.BULLET : d.LevelFormat.DECIMAL,
        text: bBullet ? "•" : `%${n + 1}.`,
        alignment: d.AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540 + n * 360, hanging: 270 } } },
      }));

    const oDocument = new d.Document({
      styles: { default: { document: { run: { font: "Georgia", size: BASE_SIZE } } } },
      numbering: { config: [{ reference: "ul", levels: aLevels(true) }, { reference: "ol", levels: aLevels(false) }] },
      sections: [
        {
          properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
          children: aChildren,
        },
      ],
    });
    return d.Packer.toBlob(oDocument);
  }

  // ── Utilità CSS ─────────────────────────────────────────────────────────────────

  private static _len(s: string): number | undefined {
    const m = /^(-?[\d.]+)(px|pt|cm|mm|in)?$/.exec((s || "").trim());
    if (!m) return undefined;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case "pt":
        return (n * 4) / 3;
      case "cm":
        return n * 37.8;
      case "mm":
        return n * 3.78;
      case "in":
        return n * 96;
      default:
        return n;
    }
  }

  private static _color(s: string): string | undefined {
    if (!s || s === "transparent" || s === "inherit" || s === "initial") return undefined;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(s);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
      return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
    }
    const oCtx = document.createElement("canvas").getContext("2d");
    if (!oCtx) return undefined;
    oCtx.fillStyle = "#000001";
    oCtx.fillStyle = s;
    const sRes = oCtx.fillStyle;
    return /^#[0-9a-f]{6}$/i.test(sRes) ? sRes.slice(1) : undefined;
  }

  private static _ctxFor(el: HTMLElement, p: Ctx): Ctx {
    const c: Ctx = { ...p };
    const t = el.tagName;
    if (t === "B" || t === "STRONG" || t === "TH") c.bold = true;
    if (t === "I" || t === "EM") c.italic = true;
    if (t === "U") c.underline = true;
    if (t === "S" || t === "STRIKE" || t === "DEL") c.strike = true;
    if (t === "SUB") c.sub = true;
    if (t === "SUP") c.sup = true;
    if (t === "A") {
      c.underline = true;
      c.color = "0563C1";
    }
    if (HEADING_PX[t]) {
      c.bold = true;
      c.size = Math.round(HEADING_PX[t] * 1.5);
    }

    const s = el.style;
    if (s.fontWeight) c.bold = s.fontWeight === "bold" || parseInt(s.fontWeight, 10) >= 600;
    if (s.fontStyle) c.italic = s.fontStyle === "italic";
    const sDeco = s.textDecorationLine || s.textDecoration || "";
    if (sDeco) {
      c.underline = /underline/.test(sDeco);
      c.strike = /line-through/.test(sDeco);
    }
    if (s.color) c.color = DocxExporter._color(s.color) ?? c.color;
    if (s.backgroundColor && !BLOCK_TAGS.has(t) && t !== "TD" && t !== "TH") c.shade = DocxExporter._color(s.backgroundColor);
    const nSize = DocxExporter._len(s.fontSize);
    if (nSize) c.size = Math.round(nSize * 1.5);
    if (s.fontFamily) c.font = s.fontFamily.split(",")[0].replace(/["']/g, "").trim() || c.font;
    if (s.textAlign) c.align = s.textAlign;
    if (s.verticalAlign === "super") c.sup = true;
    if (s.verticalAlign === "sub") c.sub = true;
    if (el.getAttribute("align")) c.align = el.getAttribute("align")!;
    return c;
  }

  // ── Blocchi ─────────────────────────────────────────────────────────────────────

  private static _align(d: any, s?: string): any {
    switch (s) {
      case "center":
        return d.AlignmentType.CENTER;
      case "right":
      case "end":
        return d.AlignmentType.RIGHT;
      case "justify":
        return d.AlignmentType.JUSTIFIED;
      default:
        return d.AlignmentType.LEFT;
    }
  }

  private static _blocks(st: State, oParent: HTMLElement, ctx: Ctx, flow: { pageBreak: boolean; mark?: any; top?: number }): any[] {
    const d = st.d;
    const aOut: ({ p: any } | { t: any; mt: number })[] = [];
    let aItems: Item[] = [];
    let nLastAfter = 0;
    let nGap = 0; // margine inferiore dell'ultima tabella (Word non ha spazio dopo le tabelle)

    const fnPush = (opts: any, nMt: number, nMb: number): void => {
      nMt = Math.max(nMt, flow.top ?? 0);
      flow.top = 0;
      const nBefore = Math.max(Math.max(nMt, nGap) - nLastAfter, 0);
      aOut.push({ p: { ...opts, spacing: { before: nBefore, after: nMb, ...(opts.spacing ?? {}) } } });
      nLastAfter = nMb;
      nGap = 0;
    };

    const fnPara = (aIt: Item[], c: Ctx, nMt: number, nMb: number, bForce: boolean): void => {
      const aRuns = DocxExporter._runs(st, DocxExporter._trim(aIt));
      if (!aRuns.length && !bForce) return;
      const opts: any = {
        children: aRuns,
        alignment: DocxExporter._align(d, c.align),
      };
      if (c.indent) opts.indent = { left: c.indent };
      if (flow.pageBreak) {
        opts.pageBreakBefore = true;
        flow.pageBreak = false;
      }
      if (flow.mark) {
        opts.numbering = flow.mark;
        flow.mark = undefined;
      }
      fnPush(opts, nMt, nMb);
    };

    const fnFlush = (): void => {
      fnPara(aItems, ctx, 0, 0, false);
      aItems = [];
    };

    oParent.childNodes.forEach((oNode) => {
      if (oNode.nodeType === Node.TEXT_NODE) {
        aItems.push({ text: (oNode.textContent ?? "").replace(/[ \t\r\n]+/g, " "), ctx });
        return;
      }
      if (oNode.nodeType !== Node.ELEMENT_NODE) return;
      const el = oNode as HTMLElement;
      const t = el.tagName;

      if (t === "BR") {
        aItems.push({ br: true });
        return;
      }
      if (t === "IMG") {
        aItems.push({ img: el as HTMLImageElement });
        return;
      }
      if (!BLOCK_TAGS.has(t)) {
        DocxExporter._inline(el, ctx, aItems);
        return;
      }

      fnFlush();
      const c = DocxExporter._ctxFor(el, ctx);
      const s = el.style;
      const nMt = (DocxExporter._len(s.marginTop) ?? 0) * TWIPS_PER_PX;
      const nMb = (DocxExporter._len(s.marginBottom) ?? 0) * TWIPS_PER_PX;
      const nMl = (DocxExporter._len(s.marginLeft) ?? 0) + (DocxExporter._len(s.paddingLeft) ?? 0);
      if (nMl) c.indent = (c.indent ?? 0) + nMl * TWIPS_PER_PX;

      if (/always|page/.test(`${s.breakAfter} ${s.pageBreakAfter}`)) {
        flow.pageBreak = true;
        return;
      }

      if (t === "HR") {
        fnPush(
          { children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } } },
          nMt,
          nMb,
        );
      } else if (t === "TABLE") {
        if (flow.pageBreak) {
          fnPush({ children: [new d.PageBreak()] }, 0, 0);
          flow.pageBreak = false;
        }
        const nTop = Math.max(nMt, flow.top ?? 0);
        flow.top = 0;
        const last = aOut[aOut.length - 1] as any;
        if (last?.p && nTop) last.p.spacing.after = Math.max(last.p.spacing.after, nTop);
        if (last?.t) {
          // due tabelle una dopo l'altra: il Word le unirebbe, quindi si inserisce un paragrafo minuscolo che porta il margine
          aOut.push({ p: { children: [], run: { size: 2 }, spacing: { before: 0, after: Math.max(nGap, nTop), line: 20, lineRule: "exact" } } } as any);
        }
        aOut.push({ t: DocxExporter._table(st, el as HTMLTableElement, c), mt: nTop });
        nLastAfter = 0;
        nGap = nMb;
      } else if (t === "UL" || t === "OL") {
        const nLevel = Math.min(c.listLevel ?? 0, 3);
        const iInst = t === "OL" ? ++st.listInstance : 0;
        Array.from(el.children).forEach((oLi) => {
          if (oLi.tagName !== "LI") return;
          const cLi = DocxExporter._ctxFor(oLi as HTMLElement, { ...c, listLevel: nLevel + 1, indent: undefined });
          const oMark = { reference: t === "OL" ? "ol" : "ul", level: nLevel, ...(t === "OL" ? { instance: iInst } : {}) };
          const aSub = DocxExporter._blocks(st, oLi as HTMLElement, cLi, { pageBreak: false, mark: oMark });
          aSub.forEach((x) => aOut.push({ p: undefined, raw: x } as any));
          nLastAfter = 0;
        });
      } else if (t === "P" || /^H[1-6]$/.test(t) || t === "LI" || t === "PRE" || t === "BLOCKQUOTE") {
        // contenitore di solo testo/inline → un paragrafo; se contiene blocchi, si scende
        const bHasBlocks = Array.from(el.children).some((x) => BLOCK_TAGS.has(x.tagName));
        if (bHasBlocks) {
          DocxExporter._blocks(st, el, c, flow).forEach((x) => aOut.push({ p: undefined, raw: x } as any));
        } else {
          const aIt: Item[] = [];
          DocxExporter._collect(el, c, aIt);
          fnPara(aIt, c, nMt, nMb, true);
        }
      } else {
        // DIV e simili: contenitore
        const bHasBlocks = Array.from(el.children).some((x) => BLOCK_TAGS.has(x.tagName));
        if (t === "DIV" && !bHasBlocks) {
          // solo testo: un paragrafo, così il Word rispetta i margini del div come il PDF
          const aIt: Item[] = [];
          DocxExporter._collect(el, c, aIt);
          fnPara(aIt, c, nMt, nMb, false);
          return;
        }
        if (s.display === "flex" && /flex-end|^end$|right/.test(s.justifyContent)) {
          // riga flex allineata a destra con figlio di larghezza fissa: il Word non ha il flex, si usa un rientro a sinistra
          const nW = DocxExporter._len((el.firstElementChild as HTMLElement | null)?.style.width ?? "");
          if (nW) c.indent = (c.indent ?? 0) + Math.max(TEXT_W - nW * TWIPS_PER_PX, 0);
        }
        flow.top = Math.max(flow.top ?? 0, nMt);
        const aSub = DocxExporter._blocks(st, el, c, flow);
        flow.top = 0;
        aSub.forEach((x) => aOut.push({ p: undefined, raw: x } as any));
        if (aSub.length) nLastAfter = 0;
      }
    });
    fnFlush();

    return aOut.map((x: any) => (x.raw ? x.raw : x.t ? x.t : new d.Paragraph(x.p)));
  }

  // ── Inline ──────────────────────────────────────────────────────────────────────

  private static _collect(el: HTMLElement, ctx: Ctx, aItems: Item[]): void {
    el.childNodes.forEach((oNode) => {
      if (oNode.nodeType === Node.TEXT_NODE) {
        aItems.push({ text: (oNode.textContent ?? "").replace(/[ \t\r\n]+/g, " "), ctx });
      } else if (oNode.nodeType === Node.ELEMENT_NODE) {
        const c = oNode as HTMLElement;
        if (c.tagName === "BR") aItems.push({ br: true });
        else if (c.tagName === "IMG") aItems.push({ img: c as HTMLImageElement });
        else DocxExporter._inline(c, ctx, aItems);
      }
    });
  }

  private static _inline(el: HTMLElement, ctx: Ctx, aItems: Item[]): void {
    DocxExporter._collect(el, DocxExporter._ctxFor(el, ctx), aItems);
  }

  private static _trim(aItems: Item[]): Item[] {
    const a = aItems.map((x) => ("text" in x ? { ...x } : x));
    let bPrevSpace = true; // spazio iniziale / doppi spazi collassati come in HTML
    a.forEach((x) => {
      if ("text" in x) {
        if (bPrevSpace) x.text = x.text.replace(/^ /, "");
        bPrevSpace = / $/.test(x.text) || x.text === "";
      } else {
        bPrevSpace = "br" in x;
      }
    });
    for (let i = a.length - 1; i >= 0; i--) {
      const x = a[i];
      if (!("text" in x)) break;
      x.text = x.text.replace(/ $/, "");
      if (x.text) break;
    }
    return a.filter((x) => !("text" in x) || x.text !== "");
  }

  private static _runs(st: State, aItems: Item[]): any[] {
    const d = st.d;
    const aRuns: any[] = [];
    aItems.forEach((x) => {
      if ("br" in x) {
        aRuns.push(new d.TextRun({ break: 1 }));
      } else if ("img" in x) {
        const oImg = st.images.get(x.img);
        if (!oImg) return;
        aRuns.push(new d.ImageRun({ type: oImg.type, data: oImg.data, transformation: { width: oImg.w, height: oImg.h } }));
      } else {
        const c = x.ctx;
        aRuns.push(
          new d.TextRun({
            text: x.text,
            bold: c.bold,
            italics: c.italic,
            underline: c.underline ? {} : undefined,
            strike: c.strike,
            color: c.color,
            size: c.size,
            font: c.font,
            superScript: c.sup,
            subScript: c.sub,
            shading: c.shade ? { type: d.ShadingType.CLEAR, fill: c.shade, color: "auto" } : undefined,
          }),
        );
      }
    });
    return aRuns;
  }

  // ── Tabelle ─────────────────────────────────────────────────────────────────────

  /**
   * Renderizza l'HTML fuori schermo alla larghezza utile della pagina (come fa html2pdf per il PDF)
   * e legge la larghezza di ogni cella: così le colonne del Word coincidono con quelle del PDF,
   * qualunque sia il modo in cui il template le definisce (o non le definisce).
   */
  private static _measureCells(sHtml: string, oRoot: HTMLElement): Map<Element, number> {
    const oMap = new Map<Element, number>();
    const oHost = document.createElement("div");
    oHost.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;width:${Math.round(TEXT_W / TWIPS_PER_PX)}px`;
    oHost.innerHTML = sHtml;
    document.body.appendChild(oHost);
    try {
      const aLive = oHost.querySelectorAll("td, th");
      const aDoc = oRoot.querySelectorAll("td, th");
      if (aLive.length === aDoc.length) {
        aDoc.forEach((oCell, i) => oMap.set(oCell, aLive[i].getBoundingClientRect().width));
      }
    } finally {
      document.body.removeChild(oHost);
    }
    return oMap;
  }

  private static _canvas: CanvasRenderingContext2D | null | undefined;

  private static _textPx(sText: string, nPx: number, bBold: boolean, sFont: string): number {
    if (DocxExporter._canvas === undefined) DocxExporter._canvas = document.createElement("canvas").getContext("2d");
    const oCtx = DocxExporter._canvas;
    if (!oCtx) return sText.length * nPx * 0.55;
    oCtx.font = `${bBold ? "bold " : ""}${nPx}px ${sFont}, serif`;
    return oCtx.measureText(sText).width;
  }

  /**
   * Larghezze (twips) delle colonne senza larghezza esplicita, come l'auto layout del browser
   * (quindi come il PDF): ogni colonna ha un minimo (parola più lunga) e un massimo (riga più
   * lunga); se i massimi stanno nello spazio disponibile si ripartisce l'avanzo in proporzione,
   * altrimenti si interpola tra minimi e massimi.
   */
  private static _autoWidths(
    aCells: { el: HTMLTableCellElement; c: number; cs: number }[],
    aW: (number | undefined)[],
    nAvail: number,
    ctx: Ctx,
  ): number[] {
    const n = aW.length;
    const aMin: number[] = new Array(n).fill(0);
    const aMax: number[] = new Array(n).fill(0);
    const nPx = (ctx.size ?? BASE_SIZE) / 1.5;
    const nPad = 12; // padding 5px*2 + bordo

    aCells.forEach((x) => {
      if (x.cs !== 1 || aW[x.c] !== undefined) return;
      const sTxt = new DOMParser()
        .parseFromString(`<body>${x.el.innerHTML.replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")}</body>`, "text/html")
        .body.textContent!;
      const bBold = x.el.tagName === "TH" || x.el.style.fontWeight === "bold";
      const sFont = ctx.font ?? "Georgia";
      let nMax = 0;
      let nMin = 0;
      sTxt.split("\n").forEach((sLine) => {
        const sL = sLine.replace(/\s+/g, " ").trim();
        nMax = Math.max(nMax, DocxExporter._textPx(sL, nPx, bBold, sFont));
        sL.split(" ").forEach((sW) => (nMin = Math.max(nMin, DocxExporter._textPx(sW, nPx, bBold, sFont))));
      });
      aMin[x.c] = Math.max(aMin[x.c], nMin + nPad);
      aMax[x.c] = Math.max(aMax[x.c], nMax + nPad);
    });

    const aIdx = aW.map((w, i) => (w === undefined ? i : -1)).filter((i) => i >= 0);
    const nA = nAvail / TWIPS_PER_PX;
    const nSumMax = aIdx.reduce((a, i) => a + Math.max(aMax[i], 40), 0);
    const nSumMin = aIdx.reduce((a, i) => a + Math.min(Math.max(aMin[i], 30), Math.max(aMax[i], 40)), 0);
    const aOut: number[] = new Array(n).fill(0);
    aIdx.forEach((i) => {
      const nMx = Math.max(aMax[i], 40);
      const nMn = Math.min(Math.max(aMin[i], 30), nMx);
      let nPxW: number;
      if (nSumMax <= nA) nPxW = (nMx / nSumMax) * nA;
      else if (nA <= nSumMin) nPxW = (nMn / nSumMin) * nA;
      else nPxW = nMn + ((nMx - nMn) * (nA - nSumMin)) / (nSumMax - nSumMin);
      aOut[i] = Math.floor(nPxW * TWIPS_PER_PX);
    });
    return aOut;
  }

  private static _table(st: State, oTable: HTMLTableElement, ctx: Ctx): any {
    const d = st.d;
    const aRows = Array.from(oTable.rows);

    // griglia di occupazione (colspan/rowspan)
    const aOcc: boolean[][] = [];
    const aCells: { el: HTMLTableCellElement; r: number; c: number; cs: number; rs: number }[] = [];
    let nCols = 0;
    aRows.forEach((oRow, r) => {
      aOcc[r] = aOcc[r] ?? [];
      let c = 0;
      Array.from(oRow.cells).forEach((oCell) => {
        while (aOcc[r][c]) c++;
        const cs = Math.max(oCell.colSpan || 1, 1);
        const rs = Math.max(oCell.rowSpan || 1, 1);
        for (let i = 0; i < rs; i++) {
          aOcc[r + i] = aOcc[r + i] ?? [];
          for (let j = 0; j < cs; j++) aOcc[r + i][c + j] = true;
        }
        aCells.push({ el: oCell, r, c, cs, rs });
        c += cs;
        nCols = Math.max(nCols, c);
      });
    });
    nCols = Math.max(nCols, 1);

    // larghezza tabella e colonne
    const sTw = oTable.style.width || oTable.getAttribute("width") || "100%";
    let nTable = TEXT_W;
    if (/%/.test(sTw)) nTable = Math.round((parseFloat(sTw) / 100) * TEXT_W);
    else if (DocxExporter._len(sTw)) nTable = Math.min(Math.round(DocxExporter._len(sTw)! * TWIPS_PER_PX), TEXT_W);

    const aW: (number | undefined)[] = new Array(nCols).fill(undefined);
    // larghezze calcolate dal browser (prevalgono: sono quelle del PDF)
    aCells.forEach((x) => {
      const nM = st.cellW.get(x.el);
      if (x.cs === 1 && nM && aW[x.c] === undefined) aW[x.c] = Math.round(nM * TWIPS_PER_PX);
    });
    // larghezze da <colgroup><col>, come le salva l'editor al ridimensionamento delle colonne
    let iCol = 0;
    oTable.querySelectorAll<HTMLElement>("colgroup > col").forEach((oCol) => {
      const nSpan = Math.max(parseInt(oCol.getAttribute("span") ?? "1", 10) || 1, 1);
      const sW = oCol.style.width || oCol.getAttribute("width") || "";
      const nW = /%/.test(sW) ? Math.round((parseFloat(sW) / 100) * nTable) : DocxExporter._len(sW);
      for (let i = 0; i < nSpan && iCol < nCols; i++, iCol++) {
        if (nW && aW[iCol] === undefined) aW[iCol] = /%/.test(sW) ? nW : Math.round(nW * TWIPS_PER_PX);
      }
    });
    aCells.forEach((x) => {
      if (x.cs !== 1) return;
      const sW = x.el.style.width || x.el.getAttribute("width") || "";
      if (/%/.test(sW)) aW[x.c] = aW[x.c] ?? Math.round((parseFloat(sW) / 100) * nTable);
      else if (DocxExporter._len(sW)) aW[x.c] = aW[x.c] ?? Math.round(DocxExporter._len(sW)! * TWIPS_PER_PX);
    });
    const nSet = aW.reduce<number>((a, w) => a + (w ?? 0), 0);
    const nFree = aW.filter((w) => w === undefined).length;
    let aCols: number[];
    if (nFree) {
      const aAuto = DocxExporter._autoWidths(aCells, aW, Math.max(nTable - nSet, nFree * 600), ctx);
      aCols = aW.map((w, i) => w ?? aAuto[i]);
    } else {
      aCols = aW as number[];
    }
    const nSum = aCols.reduce((a, w) => a + w, 0);
    if (nSum > nTable || !nFree) aCols = aCols.map((w) => Math.floor((w * nTable) / nSum));

    const oBorder = (sSide: string, el: HTMLElement): any => {
      const s = el.style as any;
      const sStyle = s[`border${sSide}Style`];
      const nW = DocxExporter._len(s[`border${sSide}Width`]);
      if (sStyle === "none" || sStyle === "hidden" || nW === 0) return { style: d.BorderStyle.NONE, size: 0, color: "auto" };
      if (!sStyle) return undefined;
      return {
        style: sStyle === "dashed" ? d.BorderStyle.DASHED : sStyle === "dotted" ? d.BorderStyle.DOTTED : d.BorderStyle.SINGLE,
        size: Math.max(Math.round((nW ?? 1) * 6), 2),
        color: DocxExporter._color(s[`border${sSide}Color`]) ?? "222222",
      };
    };

    const aTrs = aRows.map((oRow, r) => {
      const aTcs = aCells
        .filter((x) => x.r === r)
        .map((x) => {
          const el = x.el;
          const s = el.style;
          const cCell = DocxExporter._ctxFor(el, { ...ctx, align: undefined });
          const aChildren = DocxExporter._blocks(st, el, cCell, { pageBreak: false });
          if (!aChildren.length) aChildren.push(new d.Paragraph({}));

          const nW = aCols.slice(x.c, x.c + x.cs).reduce((a, w) => a + w, 0);
          const sBg = DocxExporter._color(s.backgroundColor);
          const sVa = s.verticalAlign;
          const pad = (v: string): number => Math.round((DocxExporter._len(v) ?? 0) * TWIPS_PER_PX);
          return new d.TableCell({
            children: aChildren,
            width: { size: nW, type: d.WidthType.DXA },
            columnSpan: x.cs > 1 ? x.cs : undefined,
            rowSpan: x.rs > 1 ? x.rs : undefined,
            shading: sBg ? { type: d.ShadingType.CLEAR, fill: sBg, color: "auto" } : undefined,
            verticalAlign: sVa === "middle" ? d.VerticalAlign.CENTER : sVa === "bottom" ? d.VerticalAlign.BOTTOM : d.VerticalAlign.TOP,
            margins: { top: pad(s.paddingTop), bottom: pad(s.paddingBottom), left: pad(s.paddingLeft), right: pad(s.paddingRight) },
            borders: {
              top: oBorder("Top", el),
              bottom: oBorder("Bottom", el),
              left: oBorder("Left", el),
              right: oBorder("Right", el),
            },
          });
        });
      return new d.TableRow({ children: aTcs, cantSplit: true, tableHeader: oRow.parentElement?.tagName === "THEAD" ? true : undefined });
    });

    return new d.Table({
      rows: aTrs,
      width: { size: nTable, type: d.WidthType.DXA },
      columnWidths: aCols,
      layout: d.TableLayoutType.FIXED,
    });
  }

  // ── Immagini ────────────────────────────────────────────────────────────────────

  private static async _loadImages(oRoot: HTMLElement): Promise<Map<HTMLImageElement, ImgData>> {
    const oMap = new Map<HTMLImageElement, ImgData>();
    await Promise.all(
      Array.from(oRoot.querySelectorAll("img")).map(async (oImg) => {
        try {
          const oBlob = await (await fetch(oImg.src)).blob();
          const sMime = oBlob.type;
          const sType = sMime.includes("png") ? "png" : sMime.includes("jpeg") || sMime.includes("jpg") ? "jpg" : sMime.includes("gif") ? "gif" : sMime.includes("bmp") ? "bmp" : "";
          if (!sType) return;
          const oBmp = await createImageBitmap(oBlob);
          const nAttrW = DocxExporter._len(oImg.style.width || oImg.getAttribute("width") || "");
          const nAttrH = DocxExporter._len(oImg.style.height || oImg.getAttribute("height") || "");
          let w = nAttrW ?? (nAttrH ? (nAttrH * oBmp.width) / oBmp.height : oBmp.width);
          let h = nAttrH ?? (nAttrW ? (nAttrW * oBmp.height) / oBmp.width : oBmp.height);
          if (w > MAX_IMG_PX) {
            h = (h * MAX_IMG_PX) / w;
            w = MAX_IMG_PX;
          }
          oMap.set(oImg, { data: new Uint8Array(await oBlob.arrayBuffer()), type: sType, w: Math.round(w), h: Math.round(h) });
        } catch {
          // immagine non raggiungibile: viene omessa dal documento
        }
      }),
    );
    return oMap;
  }
}
