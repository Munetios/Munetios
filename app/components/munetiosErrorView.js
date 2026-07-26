"use client";

import { t } from "../i18n";

const homeUrl = "/";
const logoUrl = "https://www.munetios.com/apple-touch-icon-new.png";

export default function MunetiosErrorView({ mode = "not-found", onRetry }) {
  const copy = t("en");
  const isError = mode === "error";
  const title = isError ? copy.errorPageTitle : copy.notFoundPageTitle;
  const heading = isError ? copy.errorPageHeading : copy.notFoundPageHeading;
  const message = isError ? copy.errorPageMessage : copy.notFoundPageMessage;
  const retry = () => {
    if (typeof onRetry === "function") {
      onRetry();
      return;
    }

    window.location.reload();
  };

  return (
    <>
      <title>{title}</title>
      <style>{`
        .munetios-error-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: linear-gradient(135deg, #12002b, #1a0038, #220046);
          color: white;
          font-family: var(--app-font);
        }

        .munetios-error-container {
          width: min(90%, 700px);
          padding: clamp(32px, 7vw, 50px);
          text-align: center;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(2px) saturate(180%);
          -webkit-backdrop-filter: blur(2px) saturate(180%);
        }

        .munetios-error-logo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 10px;
        }

        .munetios-error-logo img {
          width: 120px;
          height: 120px;
          display: block;
        }

        .munetios-error-heading {
          margin: 0 0 10px;
          color: white;
          font-size: clamp(24px, 9vw, 60px);
          font-weight: 600;
          line-height: 1;
          letter-spacing: 0;
        }

        .munetios-error-message {
          margin: 0 0 30px;
          color: rgba(255, 255, 255, 0.85);
          font-size: clamp(17px, 4vw, 20px);
          line-height: 1.5;
        }

        .munetios-error-buttons {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 16px;
        }

        .munetios-error-button {
          min-height: 50px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 14px 22px;
          border: 0;
          border-radius: 12px;
          background: #7a3cff;
          color: white;
          cursor: pointer;
          font: inherit;
          font-size: 16px;
          text-decoration: none;
          transition:
            transform 0.2s ease,
            opacity 0.2s ease;
        }

        .munetios-error-button:hover {
          transform: translateY(-2px);
          opacity: 0.9;
        }

        .munetios-error-footer {
          margin-top: 35px;
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
        }

        .munetios-runtime-error-root {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
        }
      `}</style>
      <main className="munetios-error-page">
        <section className="munetios-error-container">
          <div className="munetios-error-logo">
            <img
              alt={copy.landingLogoAlt}
              height="120"
              src={logoUrl}
              width="120"
            />
          </div>

          <h1 className="munetios-error-heading">{heading}</h1>
          <p className="munetios-error-message">{message}</p>

          <div className="munetios-error-buttons">
            {isError
              ? <button
                  className="munetios-error-button"
                  onClick={retry}
                  type="button"
                >
                  {copy.errorPageRetry}
                </button>
              : <a className="munetios-error-button" href={homeUrl}>
                  {copy.notFoundPageHome}
                </a>}
          </div>

          <div className="munetios-error-footer">{"\u00a9"} 2026 Munetios</div>
        </section>
      </main>
    </>
  );
}
