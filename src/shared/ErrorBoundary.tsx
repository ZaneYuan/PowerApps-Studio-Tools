import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Shown in the fallback panel's heading so the user knows which tab/tool crashed. */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches a render-time crash in one subtree instead of it taking down the whole app as a blank
 *  white screen with zero information (the reported failure mode: an IME composition event threw
 *  somewhere, React had no boundary to catch it, and the entire WebView2 window went blank —
 *  losing whatever the user had typed in every other open tab too, since this app keeps every
 *  open tab mounted simultaneously — see Layout.tsx — rather than unmounting on tab switch).
 *
 *  One instance wraps each open tab's `<ToolPanel>` (see Layout.tsx) rather than one instance
 *  around the whole app: a crash in one tab's tool now only blanks *that* tab — every other open
 *  tab, and whatever unsaved state it's holding, survives untouched. React error boundaries have
 *  no Hook equivalent (only a class component can implement `getDerivedStateFromError`/
 *  `componentDidCatch`), which is why this is a class despite every other component in this app
 *  being a function component. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in the fallback UI below too — logged as well so it's visible in a dev console
    // (or a future crash-log capture) even if the user doesn't screenshot the fallback panel.
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="max-w-2xl rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
        <p className="mb-2 font-medium">"{this.props.label}" 崩溃了，这个 Tab 的内容暂时无法显示。</p>
        <p className="mb-2 text-xs text-red-700 dark:text-red-400">
          其它已打开的 Tab 不受影响。把下面的错误信息截图反馈即可——点"重试"会重新挂载这个 Tab（这个 Tab 里未保存的输入可能已经丢失，其它
          Tab 不受影响）。
        </p>
        <pre className="mb-3 max-h-48 overflow-auto rounded border border-red-200 bg-white p-2 text-xs whitespace-pre-wrap dark:border-red-900 dark:bg-gray-950">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          重试
        </button>
      </div>
    );
  }
}
