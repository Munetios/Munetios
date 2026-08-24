"use client";

import { useEffect, useState } from "react";
import { hasSignedInCookie } from "../lib/signedInCookie";
import SignInScreen from "./signinscreen";

export default function SignIn() {
  const [signedIn, setSignedIn] = useState(null);
  const [addingAccount, setAddingAccount] = useState(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const addAccount =
      url.searchParams.get("addAccount") === "true" ||
      (url.searchParams.get("embedded") === "true" && window.parent !== window);
    setAddingAccount(addAccount);
    if (addAccount) {
      setSignedIn(false);
      return undefined;
    }
    setSignedIn(hasSignedInCookie());
    return undefined;
  }, []);

  if (signedIn === null || addingAccount === null) {
    return (
      <div
        className="signin-background"
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <div className="spinner-container">
          <svg
            aria-hidden="true"
            className="google-spinner"
            viewBox="0 0 50 50"
          >
            <circle
              className="spinner-circle"
              cx="25"
              cy="25"
              r="20"
              fill="none"
              strokeWidth="5"
            ></circle>
          </svg>
        </div>
      </div>
    );
  }

  return <SignInScreen addingAccount={addingAccount || signedIn} />;
}
