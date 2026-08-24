"use client";

import ErrorToast from "./components/errorToast";

export default function AppError({ error }) {
  return <ErrorToast error={error} />;
}
