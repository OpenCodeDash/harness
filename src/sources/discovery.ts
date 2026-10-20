export interface SourceQueryTemplate {
  template: string;
  /** Pack/domain ids this template is relevant to. Omitted applies to all. */
  domains?: string[];
  /** Placeholders that must be non-empty for the template to render. */
  requires?: string[];
  /** Optional search-engine site restriction, e.g. "trademe.co.nz". */
  site?: string;
}

export type SourceQueryTemplateInput = string | SourceQueryTemplate;

export interface SourceDiscovery {
  label: string;
  /** Hosts this integration covers, e.g. ["trademe.co.nz"]. */
  sites?: string[];
  queryTemplates?: SourceQueryTemplateInput[];
}

export interface DiscoverySource {
  id: string;
  discovery?: SourceDiscovery;
}
