"use client";

import MunetiosErrorView from "./components/munetiosErrorView";

export default function AppError({ reset, unstable_retry }) {
  return <MunetiosErrorView mode="error" onRetry={unstable_retry ?? reset} />;
}
