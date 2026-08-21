import { findChild, findChildren } from "../solution-diff/xmlDiff";

export interface CustomActionSummary {
  kind: "add" | "hide";
  /** CustomAction's own `Id`, or HideCustomAction's `HideActionId`. */
  id: string | null;
  location: string | null;
  /** Only set for kind "add" when the CustomAction carries a nested `<Button>` (the common case —
   *  a CustomAction can in principle wrap other CommandUIDefinition control types, but this app's
   *  own "add a button" guided form only ever generates Button ones, so that's what's worth
   *  surfacing back out). */
  buttonLabelText?: string | null;
  buttonCommand?: string | null;
}

const serializer = new XMLSerializer();

function parseXmlOrThrow(text: string, contextLabel: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error(`${contextLabel} 不是合法的 XML：${parserError.textContent}`);
  return doc;
}

/** Reads every `<CustomAction>`/`<HideCustomAction>` out of a table's `RibbonDiffXml` (the same
 *  text `readRibbonDiffXml` returns) — this is the "diff" layer (only this table's own
 *  customizations), distinct from the merged, read-only tree `parseRibbonTree` builds from the
 *  *effective* ribbon. Returns `[]` for the empty skeleton (no customizations yet), not an error. */
export function parseCustomActions(ribbonDiffXmlText: string): CustomActionSummary[] {
  const doc = parseXmlOrThrow(ribbonDiffXmlText, "RibbonDiffXml");
  const container = findChild(doc.documentElement, "customactions");
  if (!container) return [];

  const results: CustomActionSummary[] = [];
  for (const el of Array.from(container.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === "customaction") {
      const commandUiDef = findChild(el, "commanduidefinition");
      const button = commandUiDef && findChild(commandUiDef, "button");
      results.push({
        kind: "add",
        id: el.getAttribute("Id"),
        location: el.getAttribute("Location"),
        buttonLabelText: button?.getAttribute("LabelText") ?? null,
        buttonCommand: button?.getAttribute("Command") ?? null,
      });
    } else if (tag === "hidecustomaction") {
      results.push({ kind: "hide", id: el.getAttribute("HideActionId"), location: el.getAttribute("Location") });
    }
  }
  return results;
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Builds a `<HideCustomAction>` fragment that removes an existing ribbon element — `location`
 *  must be that element's own real `Id` (e.g. picked from the read-only ribbon tree, not typed
 *  blind), per Dataverse's documented contract ("Define custom actions to modify the ribbon":
 *  HideActionId names this hide action itself, Location must match the Id of the element being
 *  hidden — confirmed against Microsoft's own reference, not guessed). */
export function buildHideCustomAction(params: { hideActionId: string; location: string }): string {
  return `<HideCustomAction HideActionId="${escapeXmlAttr(params.hideActionId)}" Location="${escapeXmlAttr(params.location)}" />`;
}

export interface AddButtonParams {
  /** Unique Id for the new CustomAction wrapper (convention: `<prefix>.<entity>.<name>.CustomAction`). */
  customActionId: string;
  /** Where to insert the button — an existing container's Id + `._children` to add as a new
   *  sibling (e.g. a Tab/Group Id picked from the read-only tree), or an existing button's own Id
   *  to replace it outright. Not validated here — Dataverse itself is the source of truth for
   *  whether a given Location resolves to something real. */
  location: string;
  /** Unique Id for the new CommandDefinition (referenced by the Button's `Command` attribute). */
  commandId: string;
  /** Unique Id for the Button control itself. */
  buttonId: string;
  labelText: string;
  toolTipTitle?: string;
  /** Web resource name exactly as registered, e.g. "new_myscript.js" — this function prefixes
   *  `$webresource:` itself (the literal syntax Dataverse's ribbon engine requires), don't include
   *  it in the input. */
  webResourceName: string;
  functionName: string;
  sequence?: number;
}

/** Builds the two fragments a "call a JS function" button needs — a `<CustomAction>` wrapping the
 *  `<Button>` itself, and its paired `<CommandDefinition>` wiring the button to a
 *  `<JavaScriptFunction>` action. Schema confirmed against Microsoft's own worked example
 *  (Dynamics 365 Customer Service docs, "Configure Link to conversation button" — a real
 *  CustomAction+Button+CommandDefinition+JavaScriptFunction sample for account/case/contact),
 *  field for field, not guessed. Label/tooltip text is written as a plain literal attribute value
 *  rather than a `$LocLabels:` indirection — Dataverse's ribbon engine accepts both, and skipping
 *  LocLabels avoids the case-sensitive Id-matching class of bugs Microsoft's own troubleshooting
 *  docs call out for that path, at the cost of no built-in multi-language support (an accepted
 *  trade-off for this guided v1 form). */
export function buildAddButtonCustomAction(params: AddButtonParams): { customAction: string; commandDefinition: string } {
  const seq = params.sequence ?? 100;
  const button =
    `<Button Id="${escapeXmlAttr(params.buttonId)}" Command="${escapeXmlAttr(params.commandId)}" ` +
    `LabelText="${escapeXmlAttr(params.labelText)}" ` +
    (params.toolTipTitle ? `ToolTipTitle="${escapeXmlAttr(params.toolTipTitle)}" ` : "") +
    `Sequence="${seq}" TemplateAlias="o1" />`;
  const customAction =
    `<CustomAction Id="${escapeXmlAttr(params.customActionId)}" Location="${escapeXmlAttr(params.location)}" Sequence="${seq}">` +
    `<CommandUIDefinition>${button}</CommandUIDefinition></CustomAction>`;
  const commandDefinition =
    `<CommandDefinition Id="${escapeXmlAttr(params.commandId)}"><EnableRules /><DisplayRules /><Actions>` +
    `<JavaScriptFunction FunctionName="${escapeXmlAttr(params.functionName)}" Library="$webresource:${escapeXmlAttr(params.webResourceName)}" />` +
    `</Actions></CommandDefinition>`;
  return { customAction, commandDefinition };
}

/** Appends one or more already-serialized element fragments as new children of `containerTag`
 *  (case-insensitive) inside `ribbonDiffXmlText`, and returns the updated RibbonDiffXml text.
 *  Used to insert a HideCustomAction into `<CustomActions>`, or a CustomAction+CommandDefinition
 *  pair into `<CustomActions>`/`<CommandDefinitions>` respectively — one call per container.
 *  Creates the container if the skeleton/diff doesn't already have one (defensive: every skeleton
 *  this app generates does, per ribbonXml.ts's RIBBON_SKELETON, but a hand-edited or
 *  externally-produced RibbonDiffXml might not). */
export function appendIntoContainer(ribbonDiffXmlText: string, containerTag: string, fragmentXmlTexts: string[]): string {
  const doc = parseXmlOrThrow(ribbonDiffXmlText, "RibbonDiffXml");
  let container = findChild(doc.documentElement, containerTag.toLowerCase());
  if (!container) {
    container = doc.createElement(containerTag);
    doc.documentElement.appendChild(container);
  }
  for (const fragmentText of fragmentXmlTexts) {
    const fragmentDoc = parseXmlOrThrow(fragmentText, "新增的 ribbon 片段");
    container.appendChild(doc.importNode(fragmentDoc.documentElement, true));
  }
  return serializer.serializeToString(doc);
}

/** Every existing CustomAction/HideCustomAction Id already used in this table's RibbonDiffXml —
 *  used to warn on an Id collision before generating a new one (Dataverse itself doesn't reject a
 *  duplicate Id at save time in any obviously diagnosable way; catching it client-side is cheap). */
export function existingCustomActionIds(ribbonDiffXmlText: string): Set<string> {
  const ids = new Set<string>();
  for (const a of parseCustomActions(ribbonDiffXmlText)) {
    if (a.id) ids.add(a.id);
  }
  return ids;
}

/** True if the RibbonDiffXml's `<CommandDefinitions>` already defines `commandId` — same
 *  collision-check spirit as existingCustomActionIds, for the paired CommandDefinition a new
 *  "add a JS button" action also introduces. */
export function commandDefinitionExists(ribbonDiffXmlText: string, commandId: string): boolean {
  const doc = parseXmlOrThrow(ribbonDiffXmlText, "RibbonDiffXml");
  const container = findChild(doc.documentElement, "commanddefinitions");
  if (!container) return false;
  return findChildren(container, "commanddefinition").some((el) => el.getAttribute("Id") === commandId);
}
