import { networkInterfaces } from "node:os";

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV === "development";

function getDevelopmentOrigins() {
  const configuredOrigins = (process.env.MUNETIOS_DEV_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const interfaceOrigins = Object.values(networkInterfaces())
    .flat()
    .filter(
      (networkInterface) => networkInterface && !networkInterface.internal,
    )
    .flatMap((networkInterface) => {
      const address = networkInterface.address.split("%")[0];
      return networkInterface.family === "IPv6"
        ? [address, `[${address}]`]
        : [address];
    });

  return [
    ...new Set([
      "localhost",
      "127.0.0.1",
      ...configuredOrigins,
      ...interfaceOrigins,
    ]),
  ];
}

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' https://*.munetios.com https://js.stripe.com https://cdn.tailwindcss.com 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://*.munetios.com",
  "img-src 'self' data: blob: https: https://api.munetios.com https://*.munetios.com https://www.munetios.com",
  "font-src 'self' data: https://*.munetios.com",
  `connect-src 'self' https://*.munetios.com https://*.ganetios.com https://*.stripe.com https://api.stripe.com https://api.munetios.com${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.stripe.com",
  "base-uri 'self'",
  "form-action 'self' https://*.munetios.com https://munetios.com",
  "frame-ancestors 'self' https://munetios.com https://*.munetios.com http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig = {
  allowedDevOrigins: isDev ? getDevelopmentOrigins() : undefined,
  devIndicators: false,
  distDir: isDev ? ".next-dev" : ".next",
  reactCompiler: true,
  serverExternalPackages: ["node-llama-cpp"],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/apps/omniwrite",
          },
        ],
      },
      {
        source: "/tasks-sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Service-Worker-Allowed",
            value: "/apps/tasks",
          },
        ],
      },
      {
        source: "/tasks.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, must-revalidate",
          },
        ],
      },
      {
        source: "/apps/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, must-revalidate",
          },
        ],
      },
      {
        source: "/apps/ai/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, must-revalidate, max-age=0",
          },
          {
            key: "CDN-Cache-Control",
            value: "no-store",
          },
          {
            key: "Surrogate-Control",
            value: "no-store",
          },
          {
            key: "Pragma",
            value: "no-cache",
          },
          {
            key: "Expires",
            value: "0",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
