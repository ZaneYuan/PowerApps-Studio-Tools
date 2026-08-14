import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { MSSQL, sql } from "@codemirror/lang-sql";
import { acceptCompletion, autocompletion, snippetCompletion, type CompletionSource } from "@codemirror/autocomplete";
import { tags as t } from "@lezer/highlight";

/** Common INSERT/UPDATE/DELETE/SELECT skeletons, tab-through fields via `${name}` (CodeMirror
 *  snippet syntax — repeated names are linked, `${0}` is the final cursor stop). A field written
 *  as a bare number (`${100}`) is parsed as an *order index* with no default text, not literal
 *  default text "100" — numbered fields below are always `${n:defaultText}` for that reason.
 *  WHERE conditions default to `statecode = 0` (active records) since that's this tool's single
 *  most common filter (see Sql4Cds.tsx's own SAMPLE query) — quicker to overtype than to type
 *  from scratch. */
const SNIPPETS = [
  snippetCompletion("SELECT TOP ${1:100} ${2:*}\nFROM ${3:table}\nWHERE statecode = ${0:0}", {
    label: "select",
    detail: "SELECT 模板（含 WHERE statecode = 0）",
    type: "keyword",
    boost: 10,
  }),
  snippetCompletion("INSERT INTO ${table} (${columns})\nVALUES (${values})", {
    label: "insert",
    detail: "INSERT 模板",
    type: "keyword",
    boost: 10,
  }),
  snippetCompletion("UPDATE ${table}\nSET ${column} = ${value}\nWHERE statecode = ${0:0}", {
    label: "update",
    detail: "UPDATE 模板（含 WHERE statecode = 0）",
    type: "keyword",
    boost: 10,
  }),
  snippetCompletion("DELETE FROM ${table}\nWHERE statecode = ${0:0}", {
    label: "delete",
    detail: "DELETE 模板（含 WHERE statecode = 0）",
    type: "keyword",
    boost: 10,
  }),
  snippetCompletion("WHERE statecode = ${0:0}", {
    label: "wc",
    detail: "WHERE statecode = 0",
    type: "keyword",
    boost: 10,
  }),
];

const snippetSource: CompletionSource = (context) => {
  const word = context.matchBefore(/\w+/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: SNIPPETS, validFor: /^\w*$/ };
};

// Tab isn't bound to acceptCompletion by default (only Enter is, via completionKeymap) — add it
// explicitly so "type a snippet trigger, press Tab" works, matching how most code editors treat
// Tab as "accept the selected suggestion". Prec.highest to win over any other Tab handler; once a
// snippet is actually active, CM6 auto-injects its own higher-priority Tab (next field) binding
// (see @codemirror/autocomplete's snippet() — appended via StateEffect.appendConfig when a
// snippet completion is applied), so this only ever fires while the completion list is open.
const tabAccepts = Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }]));

const lightHighlight = HighlightStyle.define(
  [
    { tag: t.keyword, color: "#0550ae", fontWeight: "600" },
    { tag: t.typeName, color: "#7c3aed" },
    { tag: [t.string, t.special(t.string)], color: "#116329" },
    { tag: t.number, color: "#b35900" },
    { tag: [t.bool, t.null], color: "#0550ae", fontWeight: "600" },
    { tag: [t.lineComment, t.blockComment], color: "#6b7280", fontStyle: "italic" },
    { tag: t.operator, color: "#57606a" },
    { tag: t.name, color: "#1f2937" },
  ],
  { themeType: "light" },
);

const darkHighlight = HighlightStyle.define(
  [
    { tag: t.keyword, color: "#79c0ff", fontWeight: "600" },
    { tag: t.typeName, color: "#d2a8ff" },
    { tag: [t.string, t.special(t.string)], color: "#7ee787" },
    { tag: t.number, color: "#ffab70" },
    { tag: [t.bool, t.null], color: "#79c0ff", fontWeight: "600" },
    { tag: [t.lineComment, t.blockComment], color: "#8b949e", fontStyle: "italic" },
    { tag: t.operator, color: "#c9d1d9" },
    { tag: t.name, color: "#e5e7eb" },
  ],
  { themeType: "dark" },
);

function chrome(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        fontSize: "0.875rem",
        backgroundColor: dark ? "#1f2937" : "#ffffff",
        color: dark ? "#f3f4f6" : "#111827",
        border: `1px solid ${dark ? "#4b5563" : "#d1d5db"}`,
        borderRadius: "0.375rem",
      },
      "&.cm-focused": {
        outline: "none",
        borderColor: "#3b82f6",
        boxShadow: "0 0 0 1px #3b82f6",
      },
      ".cm-content": {
        padding: "8px 0",
        caretColor: dark ? "#f3f4f6" : "#111827",
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        minHeight: "8.5rem",
      },
      ".cm-scroller": { overflow: "auto", maxHeight: "40vh" },
      ".cm-gutters": {
        backgroundColor: dark ? "#111827" : "#f9fafb",
        color: dark ? "#6b7280" : "#9ca3af",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)" },
      ".cm-activeLineGutter": { backgroundColor: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" },
      "&.cm-editor .cm-selectionBackground, &.cm-editor.cm-focused .cm-selectionBackground": {
        backgroundColor: dark ? "#3b82f680" : "#bfdbfe",
      },
      ".cm-tooltip": {
        backgroundColor: dark ? "#1f2937" : "#ffffff",
        border: `1px solid ${dark ? "#4b5563" : "#d1d5db"}`,
        borderRadius: "0.375rem",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: "0.8125rem",
        maxHeight: "18em",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: dark ? "#2563eb" : "#dbeafe",
        color: dark ? "#ffffff" : "#1e3a8a",
      },
      ".cm-completionDetail": { color: dark ? "#9ca3af" : "#6b7280", fontStyle: "normal", marginLeft: "8px" },
    },
    { dark },
  );
}

export interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** table (entity logical name) -> known column (attribute logical name) list, "[]" for a table
   *  whose columns haven't been fetched yet — still enough for table-name completion. */
  schema: Record<string, string[]>;
  /** The entity currently in FROM/INTO/UPDATE, if any — its columns complete without a table
   *  prefix (see @codemirror/lang-sql's `defaultTable`). */
  defaultTable?: string;
  placeholder?: string;
  className?: string;
}

function isDarkPreferred(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export default function SqlEditor({ value, onChange, schema, defaultTable, placeholder, className }: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const languageConf = useRef(new Compartment());
  const themeConf = useRef(new Compartment());

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          tabAccepts,
          autocompletion(),
          languageConf.current.of(sql({ dialect: MSSQL, schema, defaultTable, upperCaseKeywords: true })),
          MSSQL.language.data.of({ autocomplete: snippetSource }),
          syntaxHighlighting(lightHighlight),
          syntaxHighlighting(darkHighlight),
          themeConf.current.of(chrome(isDarkPreferred())),
          EditorView.lineWrapping,
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once — schema/defaultTable/theme are pushed via the compartments below instead of
    // tearing down and recreating the view (which would lose cursor position/undo history on
    // every keystroke, since `value` changes every keystroke too).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageConf.current.reconfigure(sql({ dialect: MSSQL, schema, defaultTable, upperCaseKeywords: true })),
    });
    // Keyed on a cheap fingerprint rather than the schema object identity — the caller rebuilds
    // schema on every render, and reconfiguring on every keystroke would reset completion state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(schema).join(","), Object.values(schema).flat().join(","), defaultTable]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const view = viewRef.current;
      if (view) view.dispatch({ effects: themeConf.current.reconfigure(chrome(mq.matches)) });
    };
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return <div ref={hostRef} className={className} />;
}
