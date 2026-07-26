"use client";

import { useEffect } from "react";

const testApiFailureKey = "munetios:test-api-failure";
const testApiFailureLifetimeMs = 15_000;

function setTestApiFailure(status) {
  window.sessionStorage.setItem(
    testApiFailureKey,
    JSON.stringify({
      expiresAt: Date.now() + testApiFailureLifetimeMs,
      status,
    }),
  );
}

export default function ConsoleWarning() {
  useEffect(() => {
    console.log(
      "Warning: Do not paste any code into the console as it poses a security risk and may allow attackers to access your account. Please review any code before pasting.",
    );

    window.test429 = () => setTestApiFailure(429);
    window.testError = () => setTestApiFailure(503);
    window.clearTestError = () =>
      window.sessionStorage.removeItem(testApiFailureKey);

    return () => {
      delete window.test429;
      delete window.testError;
      delete window.clearTestError;
    };
  }, []);

  return null;
}
