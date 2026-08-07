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
}

export interface ToolDefinition extends ToolMeta {
  Component: LazyExoticComponent<ComponentType>;
}
