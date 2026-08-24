"use client";

import ErrorToast from "./components/errorToast";

export default function GlobalError({ error }) {
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
        <ErrorToast error={error} />
      </body>
    </html>
  );
}
