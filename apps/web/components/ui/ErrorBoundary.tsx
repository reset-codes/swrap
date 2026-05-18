'use client';

/**
 * ErrorBoundary — minimal React error boundary for critical UI sections.
 *
 * Catches render-time JavaScript errors in its subtree and shows a clean
 * fallback UI instead of a white screen crash.
 *
 * Usage:
 *   <ErrorBoundary label="form builder">
 *     <CanvasBuilderPage />
 *   </ErrorBoundary>
 *
 * Requirements: Phase 2 Task 10
 */

import * as React from 'react';

interface Props {
  children: React.ReactNode;
  /** Short description of the section being guarded, shown in the error UI. */
  label?: string;
  /** Custom fallback. If omitted, default fallback is rendered. */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: unknown): State {
    const msg =
      error instanceof Error
        ? error.message
        : 'An unexpected error occurred.';
    return { hasError: true, errorMessage: msg };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    // Log to console in all environments for debugging
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-4 rounded-xl border border-red-200 bg-red-50 p-8 text-center"
        >
          <p className="text-sm font-medium text-red-700">
            Something went wrong{this.props.label ? ` in the ${this.props.label}` : ''}.
          </p>
          {this.state.errorMessage && (
            <p className="max-w-sm text-xs text-red-500 font-mono break-all">
              {this.state.errorMessage}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
