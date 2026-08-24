"use client";

import { useEffect, useState } from "react";
import { t } from "../i18n";
import { showModal } from "./modal";

const pathnameApps = [
  ["/apps/connectorstore", "connectorstore"],
  ["/apps/omniwrite", "omniwrite"],
  ["/apps/tasks", "tasks"],
  ["/apps/meet", "meet"],
  ["/apps/mail", "mail"],
  ["/apps/ai", "ai"],
];

let blockedModalShownFor = "";

function currentApp() {
  const pathname = window.location.pathname.toLowerCase();
  return pathnameApps.find(([prefix]) => pathname.startsWith(prefix))?.[1];
}

export default function OrganizationPolicyRuntime() {
  const [organization, setOrganization] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/organization/access", {
      cache: "no-store",
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.managed || !payload.organization) return;
        const context = payload.organization;
        setOrganization(context);
        window.__munetiosOrganizationAccess = context;
        window.dispatchEvent(
          new CustomEvent("munetios:organization-policy", {
            detail: context,
          }),
        );

        if (context.archived && !window.__munetiosArchivedFetchPatched) {
          const originalFetch = window.fetch.bind(window);
          window.__munetiosArchivedFetchPatched = true;
          window.fetch = async (...args) => {
            const input = args[0];
            const options = args[1] || {};
            const request =
              input instanceof Request ? input : new Request(input, options);
            const url = new URL(request.url, window.location.href);
            if (
              url.origin === window.location.origin &&
              url.pathname.startsWith("/api/") &&
              !["GET", "HEAD", "OPTIONS"].includes(request.method)
            ) {
              return Response.json(
                {
                  error: "organization_account_archived",
                  message: "This managed account is read-only.",
                },
                { status: 403 },
              );
            }
            return originalFetch(...args);
          };
        }

        const app = currentApp();
        if (
          app &&
          context.appAccess?.[app] === false &&
          blockedModalShownFor !== app
        ) {
          blockedModalShownFor = app;
          const copy = t();
          showModal(
            () => (
              <div className="space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/20! text-rose-100">
                  <icon>block</icon>
                </div>
                <p className="text-sm leading-6 text-white/75">
                  {copy.organizationBlockedAppDescription.replace(
                    "{business}",
                    context.businessName,
                  )}
                </p>
                <div className="flex justify-end">
                  <a
                    className="liquid-glass rounded-xl bg-purple-500/50! px-4 py-2 font-bold"
                    href="/apps"
                  >
                    {copy.organizationBackToApps}
                  </a>
                </div>
              </div>
            ),
            {
              ariaLabel: copy.organizationBlockedAppTitle,
              dismissible: false,
              modalId: "organization-app-blocked-modal",
              title: copy.organizationBlockedAppTitle,
            },
          );
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!organization || organization.administrator) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[900] flex justify-center px-20">
      <div className="liquid-glass max-w-full truncate rounded-full border border-white/10 bg-purple-950/35! px-3 py-1.5 text-xs font-bold text-white shadow-lg">
        {t().organizationManagedBy.replace(
          "{business}",
          organization.businessName,
        )}
      </div>
    </div>
  );
}
