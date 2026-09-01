import React, { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      hasError: true,
      error,
      errorInfo,
    });
    // You can also log the error to a service like Sentry or display an error message here.
    console.error(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-screen h-screen">
          <div
            className="bg-red-100 border flex align-middle justify-center border-red-400 text-red-700 px-4 py-3 rounded relative"
            role="alert"
          >
            <strong className="font-bold">Something went wrong!</strong>
            <span className="block sm:inline">
              {this.state.error && this.state.error.toString()}
            </span>
            <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
              <svg
                className="fill-current h-6 w-6 text-red-500"
                role="button"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                onClick={() => {
                  this.setState({
                    hasError: false,
                    error: null,
                    errorInfo: null,
                  });
                }}
              >
                <title>Close</title>
                <path d="M14.293 5.293a1 1 0 011.414 0l.293.293L18 8.586l-3.293 3.293a1 1 0 01-1.414-1.414L16.586 7l-3.293-3.293a1 1 0 010-1.414zM7 16a1 1 0 01-1-1v-7a1 1 0 112 0v7a1 1 0 01-1 1zm0-9a1 1 0 01-1-1V3a1 1 0 112 0v3a1 1 0 01-1 1z" />
              </svg>
            </span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
