"use client";

import { useEffect, useState } from "react";
import SignInScreen from "./signinscreen";

export default function SignIn() {
  const [signedIn, setSignedIn] = useState(null);
  const [addingAccount, setAddingAccount] = useState(false);

  useEffect(() => {
    const addAccount =
      new URL(window.location.href).searchParams.get("addAccount") === "true";
    setAddingAccount(addAccount);
    if (addAccount) {
      setSignedIn(false);
      return undefined;
    }
    let active = true;

    const checkSignedIn = async () => {
      try {
        const response = await fetch("/api/signedin");
        const data = await response.json();

        if (!active) {
          return;
        }

        setSignedIn(response.ok && data === true);
      } catch {
        if (active) {
          setSignedIn(false);
        }
      }
    };

    checkSignedIn();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!signedIn || addingAccount) {
      return;
    }

    const returnTo = new URL(window.location.href).searchParams.get("returnTo");
    const safeReturnTo =
      returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    window.location.replace(safeReturnTo);
  }, [addingAccount, signedIn]);

  if (signedIn === null) {
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

  if (!signedIn) {
    return <SignInScreen />;
  }

  return null;
}
