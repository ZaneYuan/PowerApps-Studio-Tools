import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  toolName?: string;
}

interface State {
  error: Error | null;
}

/** Catches render-time exceptions from a tool's component tree. Without this, an uncaught error
 *  anywhere in a tool (e.g. a third-party parser throwing on unexpected input, as SQL4CDS's
 *  parseSql did on multi-statement input) unmounts every React tree above the nearest error
 *  boundary — with none anywhere, that's the whole app, i.e. the window goes blank with no
 *  indication why. Scoped per-tool (see ToolPanel.tsx) so one tool crashing shows an error in
 *  its own panel instead of taking down tabs/sidebar/every other open tool. */
export default class ToolErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.toolName ?? "tool"}] crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          <p className="font-medium">{this.props.toolName ?? "此工具"} 出现了一个未处理的错误，已停止渲染。</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/40"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
