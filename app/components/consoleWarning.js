"use client";

import { useEffect } from "react";

const testApiFailureKey = "munetios:test-api-failure";

function setTestApiFailure(status) {
  const failure = { enabledAt: Date.now(), status };
  window.sessionStorage.setItem(testApiFailureKey, JSON.stringify(failure));
  window.dispatchEvent(
    new CustomEvent("munetios:test-api-failure-change", { detail: failure }),
  );
  return failure;
}

export default function ConsoleWarning() {
  useEffect(() => {
    console.log(
      "Warning: Do not paste any code into the console as it poses a security risk and may allow attackers to access your account. Please review any code before pasting.",
    );

    window.test429 = () => setTestApiFailure(429);
    window.testError = () => setTestApiFailure(503);
    window.clearTestError = () => {
      window.sessionStorage.removeItem(testApiFailureKey);
      window.dispatchEvent(
        new CustomEvent("munetios:test-api-failure-change", {
          detail: { status: 0 },
        }),
      );
      return { status: 0 };
    };

    return () => {
      delete window.test429;
      delete window.testError;
      delete window.clearTestError;
    };
  }, []);

  return null;
}
