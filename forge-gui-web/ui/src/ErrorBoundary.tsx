import { Component, type ReactNode } from 'react'

// Keeps a rendering bug in one part of the table from blanking the whole game; the server still
// holds the real state, so "Try again" just re-renders from the store.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center">
        <div className="max-w-lg rounded-xl border border-danger/60 bg-panel p-4 text-sm">
          <div className="mb-1 font-semibold text-danger">The table hit a display error</div>
          <pre className="mb-3 whitespace-pre-wrap text-xs text-ink-dim">{this.state.error.message}</pre>
          <button type="button" className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-table" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
