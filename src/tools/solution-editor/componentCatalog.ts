import { fetchAllEntitiesForPicker, fetchGlobalOptionSets, type RecordComponentSource } from "./dataverseOps";
import type { PickableComponent } from "./types";

export type ComponentSource =
  | { kind: "metadata"; load: (connectionId: string) => Promise<PickableComponent[]> }
  | ({ kind: "records" } & RecordComponentSource);

export interface AddableComponentKind {
  key: string;
  label: string;
  group: string;
  componentType: number;
  source: ComponentSource;
}

function workflowKind(key: string, label: string, category: number): AddableComponentKind {
  return {
    key,
    label,
    group: "自动化",
    componentType: 29,
    source: {
      kind: "records",
      entitySet: "workflows",
      idField: "workflowid",
      nameField: "name",
      secondaryField: "primaryentity",
      baseFilter: `type eq 1 and category eq ${category}`,
      orderBy: "modifiedon desc",
    },
  };
}

/** What "Add existing" offers. Metadata types (tables, global choices) are loaded whole and
 *  filtered client-side because metadata entity sets reject `contains()`; everything else is
 *  searched server-side. Security roles are filtered to root-business-unit
 *  copies (`_parentroleid_value eq null`) — each BU gets its own inherited copy of a role, and only
 *  the root one is the solution component. */
export const ADD_EXISTING_KINDS: AddableComponentKind[] = [
  {
    key: "table",
    label: "表（Table）",
    group: "数据",
    componentType: 1,
    source: {
      kind: "metadata",
      load: async (connectionId) =>
        (await fetchAllEntitiesForPicker(connectionId)).map((e) => ({ id: e.metadataId, name: e.displayName, secondary: e.logicalName })),
    },
  },
  {
    key: "optionset",
    label: "全局选项集（Choice）",
    group: "数据",
    componentType: 9,
    source: {
      kind: "metadata",
      load: async (connectionId) =>
        (await fetchGlobalOptionSets(connectionId)).map((o) => ({ id: o.metadataId, name: o.displayName, secondary: o.name })),
    },
  },
  {
    key: "envvar",
    label: "环境变量（Environment Variable）",
    group: "数据",
    componentType: 380,
    source: {
      kind: "records",
      entitySet: "environmentvariabledefinitions",
      idField: "environmentvariabledefinitionid",
      nameField: "displayname",
      secondaryField: "schemaname",
      orderBy: "displayname",
    },
  },
  {
    key: "webresource",
    label: "Web Resource",
    group: "界面",
    componentType: 61,
    source: {
      kind: "records",
      entitySet: "webresourceset",
      idField: "webresourceid",
      nameField: "name",
      secondaryField: "displayname",
      baseFilter: "ishidden/Value eq false",
      orderBy: "modifiedon desc",
    },
  },
  {
    key: "appmodule",
    label: "Model-driven App",
    group: "界面",
    componentType: 80,
    source: { kind: "records", entitySet: "appmodules", idField: "appmoduleid", nameField: "name", secondaryField: "uniquename", orderBy: "name" },
  },
  {
    key: "canvasapp",
    label: "Canvas App",
    group: "界面",
    componentType: 300,
    source: { kind: "records", entitySet: "canvasapps", idField: "canvasappid", nameField: "displayname", secondaryField: "name", orderBy: "displayname" },
  },
  {
    key: "sitemap",
    label: "Site Map",
    group: "界面",
    componentType: 62,
    source: { kind: "records", entitySet: "sitemaps", idField: "sitemapid", nameField: "sitemapname", secondaryField: "sitemapnameunique", orderBy: "sitemapnameunique" },
  },
  {
    key: "dashboard",
    label: "仪表板（Dashboard）",
    group: "界面",
    componentType: 60,
    source: { kind: "records", entitySet: "systemforms", idField: "formid", nameField: "name", baseFilter: "type eq 0 or type eq 10", orderBy: "name" },
  },
  {
    key: "pluginassembly",
    label: "Plugin Assembly",
    group: "插件",
    componentType: 91,
    source: {
      kind: "records",
      entitySet: "pluginassemblies",
      idField: "pluginassemblyid",
      nameField: "name",
      secondaryField: "version",
      baseFilter: "ishidden/Value eq false",
      orderBy: "modifiedon desc",
    },
  },
  {
    key: "pluginstep",
    label: "Plugin Step",
    group: "插件",
    componentType: 92,
    source: {
      kind: "records",
      entitySet: "sdkmessageprocessingsteps",
      idField: "sdkmessageprocessingstepid",
      nameField: "name",
      baseFilter: "ishidden/Value eq false",
      orderBy: "modifiedon desc",
    },
  },
  workflowKind("workflow", "Workflow（经典工作流）", 0),
  workflowKind("action", "Action（操作）", 3),
  workflowKind("businessrule", "Business Rule（业务规则）", 2),
  workflowKind("bpf", "Business Process Flow（业务流程）", 4),
  workflowKind("cloudflow", "Cloud Flow（云端流）", 5),
  {
    key: "role",
    label: "安全角色（Security Role）",
    group: "安全",
    componentType: 20,
    source: { kind: "records", entitySet: "roles", idField: "roleid", nameField: "name", baseFilter: "_parentroleid_value eq null", orderBy: "name" },
  },
  {
    key: "fieldsecurityprofile",
    label: "字段安全配置文件（Field Security Profile）",
    group: "安全",
    componentType: 70,
    source: { kind: "records", entitySet: "fieldsecurityprofiles", idField: "fieldsecurityprofileid", nameField: "name", orderBy: "name" },
  },
  {
    key: "emailtemplate",
    label: "邮件模板（Email Template）",
    group: "更多",
    componentType: 36,
    source: { kind: "records", entitySet: "templates", idField: "templateid", nameField: "title", orderBy: "title" },
  },
  {
    key: "connectionrole",
    label: "连接角色（Connection Role）",
    group: "更多",
    componentType: 63,
    source: { kind: "records", entitySet: "connectionroles", idField: "connectionroleid", nameField: "name", orderBy: "name" },
  },
];

export const NEW_KINDS = [
  { key: "table", label: "表（Table）" },
  { key: "webresource", label: "Web Resource" },
] as const;

export type NewKindKey = (typeof NEW_KINDS)[number]["key"];

/** Dataverse's `webresourcetype` choice values, keyed by the file extensions each accepts. */
export const WEB_RESOURCE_TYPES: { value: number; label: string; extensions: string[] }[] = [
  { value: 3, label: "Script (JScript)", extensions: ["js"] },
  { value: 1, label: "Webpage (HTML)", extensions: ["htm", "html"] },
  { value: 2, label: "Style Sheet (CSS)", extensions: ["css"] },
  { value: 4, label: "Data (XML)", extensions: ["xml"] },
  { value: 5, label: "PNG format", extensions: ["png"] },
  { value: 6, label: "JPG format", extensions: ["jpg", "jpeg"] },
  { value: 7, label: "GIF format", extensions: ["gif"] },
  { value: 9, label: "Style Sheet (XSL)", extensions: ["xsl", "xslt"] },
  { value: 10, label: "ICO format", extensions: ["ico"] },
  { value: 11, label: "Vector format (SVG)", extensions: ["svg"] },
  { value: 12, label: "String (RESX)", extensions: ["resx"] },
];

export function webResourceTypeForFileName(fileName: string): number | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return WEB_RESOURCE_TYPES.find((t) => t.extensions.includes(ext))?.value ?? null;
}
