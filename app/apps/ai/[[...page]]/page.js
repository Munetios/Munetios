"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { showModal } from "../../../components/modal";
import { showToast } from "../../../components/toast";
import { t } from "../../../i18n";
import { hasSignedInCookie } from "../../../lib/signedInCookie";
import CodePage from "../components/codePage";
import CodeSidebar from "../components/codeSidebar";
import ConnectorsPage from "../components/connectorsPage";
import ImagesPage from "../components/imagesPage";
import NewChatPage from "../components/newChatPage";
import {
  closeAiSettingsModal,
  openAiSettingsModal,
  showSubscriptionCheckFailure,
} from "../components/settingsModal";
import Sidebar, { GuestFeatureModal } from "../components/sidebar";

const aiLoadingCriticalCss = `
  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-new-chat-topbar,
  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-new-chat-hero,
  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-temporary-notice,
  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-for-you {
    display: none !important;
  }

  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-new-chat-content {
    justify-content: center;
  }

  munetios-ai-shell[data-ai-app-loading="true"] .munetios-ai-composer {
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
  }
`;

function getPageFromPath(pathname) {
  const path = String(pathname || "").replace(/^\/apps\/ai\/?/u, "");
  return path || "home";
}

function PersistentPageSlot({ active, children, name }) {
  return (
    <section
      aria-hidden={!active}
      className="ai-persistent-page-slot"
      data-ai-page-slot={name}
      hidden={!active}
    >
      {children}
    </section>
  );
}

export default function AiPage() {
  const pathname = usePathname();
  const [activePage, setActivePage] = useState(() => getPageFromPath(pathname));
  const [appLoading, setAppLoading] = useState(true);
  const [codeAccess, setCodeAccess] = useState("checking");
  const [codeGuestModalOpen, setCodeGuestModalOpen] = useState(false);
  const [copy, setCopy] = useState(() => t());
  const [subscriptionPlan, setSubscriptionPlan] = useState("free");
  const [educationAccess, setEducationAccess] = useState(() =>
    hasSignedInCookie() ? "checking" : "allowed",
  );
  const [educationRole, setEducationRole] = useState("");
  const educationModalShownRef = useRef(false);
  const subscriptionFailureMessageRef = useRef(copy.aiSubscriptionCheckFailed);

  useEffect(() => {
    if (!hasSignedInCookie()) return;
    const controller = new AbortController();
    fetch("/api/account", {
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        setEducationRole(account?.education?.role || "");
        const blocked =
          account?.education?.role === "student" &&
          account.education.aiAllowed !== true;
        setEducationAccess(blocked ? "blocked" : "allowed");
        if (!blocked || educationModalShownRef.current) return;
        educationModalShownRef.current = true;
        showModal(
          ({ close }) => (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-white/70">
                {copy.educationAiUnavailableDescription}
              </p>
              <div className="flex justify-end">
                <button
                  className="liquid-glass rounded-xl bg-purple-600/70! px-4 py-2 text-sm font-bold"
                  onClick={close}
                  type="button"
                >
                  {copy.close}
                </button>
              </div>
            </div>
          ),
          {
            ariaLabel: copy.educationAiUnavailableTitle,
            title: copy.educationAiUnavailableTitle,
          },
        );
      })
      .catch(() => {
        setEducationAccess("allowed");
        setEducationRole("");
      });
    return () => controller.abort();
  }, [
    copy.close,
    copy.educationAiUnavailableDescription,
    copy.educationAiUnavailableTitle,
  ]);

  useEffect(() => {
    subscriptionFailureMessageRef.current = copy.aiSubscriptionCheckFailed;
  }, [copy.aiSubscriptionCheckFailed]);

  useEffect(() => {
    let controller = null;
    const checkSubscription = () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      setAppLoading(true);
      setSubscriptionPlan("free");
      if (educationAccess !== "allowed") {
        setAppLoading(false);
        return;
      }
      if (!hasSignedInCookie()) {
        window.requestAnimationFrame(() => {
          if (!requestController.signal.aborted) setAppLoading(false);
        });
        return;
      }

      fetch("/api/ai/usage", {
        cache: "no-store",
        credentials: "include",
        signal: requestController.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("subscription_check_failed");
          const payload = await response.json();
          if (requestController.signal.aborted) return;
          setSubscriptionPlan(
            ["free", "proLite", "pro"].includes(payload.plan)
              ? payload.plan
              : "free",
          );
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          setSubscriptionPlan("free");
          showSubscriptionCheckFailure(subscriptionFailureMessageRef.current);
        })
        .finally(() => {
          if (!requestController.signal.aborted) setAppLoading(false);
        });
    };

    checkSubscription();
    window.addEventListener("munetios:authchange", checkSubscription);
    return () => {
      controller?.abort();
      window.removeEventListener("munetios:authchange", checkSubscription);
    };
  }, [educationAccess]);

  useEffect(() => {
    if (appLoading) return;
    window.dispatchEvent(new Event("munetios:aiappready"));
  }, [appLoading]);

  useEffect(() => {
    const syncSettingsHash = () => {
      if (window.location.hash === "#settings") {
        openAiSettingsModal({ signedIn: hasSignedInCookie() });
      } else {
        closeAiSettingsModal();
      }
    };
    syncSettingsHash();
    window.addEventListener("hashchange", syncSettingsHash);
    window.addEventListener("popstate", syncSettingsHash);
    return () => {
      window.removeEventListener("hashchange", syncSettingsHash);
      window.removeEventListener("popstate", syncSettingsHash);
    };
  }, []);

  useEffect(() => {
    const refresh = () =>
      setActivePage(getPageFromPath(window.location.pathname));
    refresh();
    window.addEventListener("popstate", refresh);
    return () => window.removeEventListener("popstate", refresh);
  }, []);

  useEffect(() => {
    const refreshCopy = () => setCopy(t());
    window.addEventListener("munetios:languagechange", refreshCopy);
    window.addEventListener("munetios:localechange", refreshCopy);
    return () => {
      window.removeEventListener("munetios:languagechange", refreshCopy);
      window.removeEventListener("munetios:localechange", refreshCopy);
    };
  }, []);

  useEffect(() => {
    const openAiShortcut = (event) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.repeat
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "v") {
        event.preventDefault();
        window.dispatchEvent(new Event("munetios:aivoicestart"));
      } else if (key === "i") {
        event.preventDefault();
        openAiSettingsModal({ signedIn: hasSignedInCookie() });
      } else if (key === "s") {
        event.preventDefault();
        const microphoneControl = Array.from(
          document.querySelectorAll("[data-ai-voice-input]"),
        ).find((control) => !control.closest("[hidden]") && !control.disabled);
        if (microphoneControl instanceof HTMLElement) microphoneControl.click();
      }
    };

    window.addEventListener("keydown", openAiShortcut);
    return () => window.removeEventListener("keydown", openAiShortcut);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const purchase = url.searchParams.get("usage_purchase");
    const sessionId =
      url.searchParams.get("session_id") ||
      (purchase?.startsWith("cs_") ? purchase : "");
    if (!purchase || !sessionId) return;

    url.searchParams.delete("usage_purchase");
    url.searchParams.delete("session_id");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    fetch(`/api/ai/usage/purchase?sessionId=${encodeURIComponent(sessionId)}`, {
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("purchase-verification-failed");
        await response.json();
        showToast({
          message: copy.aiSettingsPurchaseComplete,
          type: "success",
        });
      })
      .catch(() => {
        showToast({ message: copy.aiSettingsPurchaseFailed, type: "error" });
      });
  }, [copy.aiSettingsPurchaseComplete, copy.aiSettingsPurchaseFailed]);

  const navigate = useCallback(
    (path) => {
      if (
        educationRole === "student" &&
        ["agent", "bots", "images"].includes(
          getPageFromPath(path).split("/")[0],
        )
      ) {
        path = "/apps/ai";
      }
      if (window.location.pathname !== path) {
        window.history.pushState({}, "", path);
      }
      setActivePage(getPageFromPath(path));
    },
    [educationRole],
  );

  useEffect(() => {
    const currentPage = activePage.split("/")[0];
    if (
      educationRole !== "student" ||
      !["agent", "bots", "images"].includes(currentPage)
    ) {
      return;
    }
    window.history.replaceState({}, "", "/apps/ai");
    setActivePage("home");
  }, [activePage, educationRole]);

  const pageName = activePage.split("/")[0];
  const codeRoute = pageName === "code";
  const codeSection = codeRoute ? activePage.split("/")[1] || "home" : "";

  useEffect(() => {
    if (!codeRoute) {
      setCodeAccess("not-code");
      return undefined;
    }
    const refreshAccess = () => {
      if (hasSignedInCookie()) {
        setCodeAccess("signed-in");
        return;
      }
      setCodeAccess("guest");
      window.history.replaceState({}, "", "/apps/ai");
      setActivePage("home");
      setCodeGuestModalOpen(true);
    };
    refreshAccess();
    window.addEventListener("munetios:authchange", refreshAccess);
    return () =>
      window.removeEventListener("munetios:authchange", refreshAccess);
  }, [codeRoute]);

  const codeAllowed = codeRoute && codeAccess === "signed-in";

  return (
    <munetios-ai-shell
      className="ai-shell"
      data-ai-app-loading={appLoading ? "true" : "false"}
      data-subscription-plan={subscriptionPlan}
    >
      <style>{aiLoadingCriticalCss}</style>
      {codeAllowed
        ? <CodeSidebar activeSection={codeSection} onNavigate={navigate} />
        : null}
      {!codeRoute
        ? <Sidebar
            activePage={pageName}
            appLoading={appLoading}
            educationStudent={educationRole === "student"}
            onNavigate={navigate}
          />
        : null}
      <main className="ai-shell-page" data-ai-page={pageName}>
        <section className="ai-shell-page-content">
          <PersistentPageSlot
            active={
              !["agent", "code", "connectors", "images"].includes(pageName)
            }
            name="home"
          >
            <NewChatPage
              appLoading={appLoading}
              autoOpenVoiceMode={pageName === "voice"}
              copy={copy}
              educationStudent={educationRole === "student"}
              openConversationId={
                pageName === "c" || pageName === "v"
                  ? activePage.split("/")[1] || ""
                  : ""
              }
            />
          </PersistentPageSlot>
          <PersistentPageSlot
            active={
              pageName === "connectors" ||
              (codeAllowed && codeSection === "connectors")
            }
            name="connectors"
          >
            <ConnectorsPage />
          </PersistentPageSlot>
          {educationRole !== "student"
            ? <PersistentPageSlot active={pageName === "images"} name="images">
                <ImagesPage />
              </PersistentPageSlot>
            : null}
          <PersistentPageSlot active={pageName === "agent"} name="agent" />
          {codeAllowed && codeSection !== "connectors"
            ? <PersistentPageSlot active name="code">
                <CodePage />
              </PersistentPageSlot>
            : null}
        </section>
      </main>
      {codeGuestModalOpen
        ? <GuestFeatureModal
            close={() => setCodeGuestModalOpen(false)}
            copy={copy}
            feature="code"
            returnTo="/apps/ai/code"
          />
        : null}
    </munetios-ai-shell>
  );
}
