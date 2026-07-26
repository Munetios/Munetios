"use client";

import { Component } from "react";
import { showToast } from "./toast";

let lastComponentErrorToastAt = 0;
const componentErrorToastDelayMs = 1500;

function showComponentErrorToast() {
  if (typeof window === "undefined") {
    return;
  }

  const now = Date.now();

  if (now - lastComponentErrorToastAt < componentErrorToastDelayMs) {
    return;
  }

  lastComponentErrorToastAt = now;

  showToast({
    messageKey: "fetchError",
    type: "error",
  });
}

export default class IgnoreElementErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    showComponentErrorToast();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }

    return this.props.children;
  }
}
