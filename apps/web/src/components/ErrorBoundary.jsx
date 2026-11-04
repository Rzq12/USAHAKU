import { Component } from 'react';
import { ErrorState } from './ui.jsx';

const PAGE_FAILED = {
  message:
    'Halaman ini mengalami masalah. Data Anda aman di server. Muat ulang untuk mencoba lagi.',
};

export class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={PAGE_FAILED} onRetry={() => window.location.reload()} />
      </div>
    );
  }
}
