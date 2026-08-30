import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center"
          style={{ background: "var(--background)", color: "var(--text-primary)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4 text-2xl"
            style={{ background: "rgba(239,68,68,0.1)", color: "var(--error)" }}
          >
            ⚠️
          </div>
          <p className="text-lg font-bold mb-2">Something went wrong</p>
          <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
            {this.state.error?.message ?? "An unexpected error occurred."}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-6 py-3 rounded-full font-bold text-sm"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
