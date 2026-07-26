"use client";

import DataTranslateRuntime from "./components/dataTranslateRuntime";
import ErrorOverlaySuppressor from "./components/errorOverlaySuppressor";
import MunetiosErrorView from "./components/munetiosErrorView";

export default function GlobalError({ reset, unstable_retry }) {
  return (
    <html dir="ltr" lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://api.munetios.com/beautiful-css/beautiful.css"
        />
        <style>{`
          nextjs-portal,
          script[data-nextjs-dev-overlay],
          [data-nextjs-dev-overlay],
          [data-nextjs-dialog-overlay],
          [data-nextjs-error-overlay-nav],
          [data-nextjs-toast] {
            display: none;
            pointer-events: none;
            visibility: hidden;
          }
        `}</style>
      </head>
      <body>
        <MunetiosErrorView mode="error" onRetry={unstable_retry ?? reset} />
        <DataTranslateRuntime />
        <ErrorOverlaySuppressor />
      </body>
    </html>
  );
}
