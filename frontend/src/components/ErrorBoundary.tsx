import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (err: Error, reset: () => void) => ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * Catches render-time errors so a crash in one tab (a malformed Plotly trace,
 * a bad API response, etc.) doesn't take the whole app to a blank screen.
 * Reset clears the error so the user can navigate away.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", err, info);
  }

  reset = () => this.setState({ err: null });

  render() {
    if (this.state.err) {
      if (this.props.fallback) return this.props.fallback(this.state.err, this.reset);
      return (
        <div className="m-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="mb-2 font-semibold">Something went wrong rendering this view.</div>
          <pre className="mb-3 overflow-auto rounded bg-red-100 p-2 text-xs">
            {this.state.err.message}
          </pre>
          <button
            type="button"
            onClick={this.reset}
            className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
          >
            Reset
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
