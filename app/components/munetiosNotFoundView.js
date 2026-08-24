"use client";

import Image from "next/image";
import { t } from "../i18n";

const homeUrl = "/";
const logoUrl = "https://www.munetios.com/apple-touch-icon-new.png";

export default function MunetiosNotFoundView() {
  const copy = t("en");

  return (
    <>
      <title>{copy.notFoundPageTitle}</title>
      <style>{`
        .munetios-not-found-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: linear-gradient(135deg, #12002b, #1a0038, #220046);
          color: white;
          font-family: var(--app-font);
        }

        .munetios-not-found-container {
          width: min(90%, 700px);
          padding: clamp(32px, 7vw, 50px);
          text-align: center;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(2px) saturate(180%);
          -webkit-backdrop-filter: blur(2px) saturate(180%);
        }

        .munetios-not-found-logo {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 10px;
        }

        .munetios-not-found-logo img {
          width: 120px;
          height: 120px;
          display: block;
        }

        .munetios-not-found-heading {
          margin: 0 0 10px;
          color: white;
          font-size: clamp(24px, 9vw, 60px);
          font-weight: 600;
          line-height: 1;
          letter-spacing: 0;
        }

        .munetios-not-found-message {
          margin: 0 0 30px;
          color: rgba(255, 255, 255, 0.85);
          font-size: clamp(17px, 4vw, 20px);
          line-height: 1.5;
        }

        .munetios-not-found-buttons {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 16px;
        }

        .munetios-not-found-button {
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

        .munetios-not-found-button:hover {
          transform: translateY(-2px);
          opacity: 0.9;
        }

        .munetios-not-found-footer {
          margin-top: 35px;
          color: rgba(255, 255, 255, 0.6);
          font-size: 14px;
        }
      `}</style>
      <main className="munetios-not-found-page">
        <section className="munetios-not-found-container">
          <div className="munetios-not-found-logo">
            <Image
              alt={copy.landingLogoAlt}
              height="120"
              src={logoUrl}
              unoptimized
              width="120"
            />
          </div>

          <h1 className="munetios-not-found-heading">
            {copy.notFoundPageHeading}
          </h1>
          <p className="munetios-not-found-message">
            {copy.notFoundPageMessage}
          </p>

          <div className="munetios-not-found-buttons">
            <a className="munetios-not-found-button" href={homeUrl}>
              {copy.notFoundPageHome}
            </a>
          </div>

          <div className="munetios-not-found-footer">
            {"\u00a9"} 2026 Munetios
          </div>
        </section>
      </main>
    </>
  );
}
