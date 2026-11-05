import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#1f2a37' }}>
          <h1 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>页面渲染出错</h1>
          <pre style={{ fontSize: 12, color: '#5a6b7b', whiteSpace: 'pre-wrap' }}>{String(this.state.error?.message)}</pre>
          <button
            onClick={() => location.reload()}
            style={{ marginTop: 16, padding: '6px 12px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f1f4f8', color: '#1f2a37', cursor: 'pointer' }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
