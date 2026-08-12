import type { ComponentType, LazyExoticComponent } from "react";

export interface ToolMeta {
  /** Unique slug, used in the URL as /tools/:id */
  id: string;
  /** Display name shown in sidebar and cards */
  name: string;
  /** One-line description shown on the home page card */
  description: string;
  /** Grouping label used in the sidebar (e.g. "Dataverse", "Power Automate") */
  category: string;
  /** A single emoji used as the tool's icon */
  icon: string;
  /** Set false for tools that aren't bound to one Dataverse connection (e.g. the connections
   *  manager itself) — opens as a single un-suffixed tab and hides the per-tab connection
   *  selector, instead of the default per-connection tab identity. Defaults to true. */
  connectionScoped?: boolean;
}

export interface ToolDefinition extends ToolMeta {
  Component: LazyExoticComponent<ComponentType>;
}
