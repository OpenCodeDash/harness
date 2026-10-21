export interface SourceQueryTemplate {
  template: string;
  /** Domain hints this template fits; omitted applies to all. */
  domains?: string[];
  /** Placeholders that must be non-empty for the template to render. */
  requires?: string[];
  /** Optional search-engine site restriction, e.g. "trademe.co.nz". */
  site?: string;
}

export type SourceQueryTemplateInput = string | SourceQueryTemplate;

export interface SourceDiscovery {
  label: string;
  /** How this source is extracted. structured-only web scope skips "html". */
  kind?: "structured" | "html";
  /** Hosts this integration covers, e.g. ["trademe.co.nz"]. */
  sites?: string[];
  queryTemplates?: SourceQueryTemplateInput[];
}

export interface DiscoverySource {
  id: string;
  discovery?: SourceDiscovery;
}
