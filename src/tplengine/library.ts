import Lib from "sap/ui/core/Lib";

/**
 * Motore dei template HTML: segnaposto, elenchi ripetibili, export PDF e Word, storage dei template.
 *
 * @namespace tplengine
 */
const thisLib = Lib.init({
  name: "tplengine",
  version: "${version}",
  dependencies: ["sap.ui.core"],
  types: [],
  interfaces: [],
  controls: [],
  elements: [],
  noLibraryCSS: true,
});

export default thisLib;
