import type { AgentType } from "./Agent";
import type { Tier } from "./StateSnapshot";

export interface CatalogAgent {
  id: AgentType;
  name: string;
  tagline: string;
  description: string;
  icon_url: string;
  units: number;
  api_port: number;
  health_port: number;
  health_path: string;
  docs_url: string;
  min_plan: Tier;
}

export interface Catalog {
  version: string;
  agents: CatalogAgent[];
}
