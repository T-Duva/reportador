import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null }
  static getDerivedStateFromError(e: Error) {
    return { err: e.message || 'Error' }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info)
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: '1.2rem', fontFamily: 'serif' }}>
          <p>Algo se trabó en Ligux.</p>
          <p style={{ opacity: 0.7 }}>{this.state.err}</p>
          <button type="button" onClick={() => location.reload()}>
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
