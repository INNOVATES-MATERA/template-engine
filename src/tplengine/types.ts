// Le interfacce ricalcano le entità del service OData Template (Groups, Fields, Templates): le colonne di audit non servono al frontend.
export interface TplApp {
  /** Guid dell'app nel service Template. */
  appId: string;
  /** Codice leggibile dell'app (es. "SCHEDE_CEL"): è l'identificativo che le app passano alla libreria. */
  code: string;
  name: string;
}

export interface TplGroup {
  /** Guid dell'app (con LocalTemplateStorage coincide con il codice). */
  appId: string;
  groupId: string;
  groupKey: string;
  label: string;
  isList: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface TplField {
  fieldId: string;
  groupId: string;
  fieldKey: string;
  label: string;
  /** Valore d'esempio già formattato; per i campi di una tabella 3 valori separati da ";". */
  sampleValue: string;
  sortOrder: number;
  isActive: boolean;
}

export interface TplTemplate {
  /** Guid dell'app (con LocalTemplateStorage coincide con il codice). */
  appId: string;
  templateId: string;
  version: number;
  name: string;
  htmlBody: string;
  isDefault: boolean;
}

export interface TplCatalog {
  groups: TplGroup[];
  fields: TplField[];
}

/** Elenco (array) ripetibile nel template: nasce da un gruppo con isList = true, i suoi campi sono le colonne. */
export interface TemplateList {
  key: string;
  columns: string[];
}
