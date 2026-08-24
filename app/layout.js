import "./globals.css";
import { cookies } from "next/headers";
import AppearanceRuntime from "./components/appearanceRuntime";
import ArchivedAccountRuntime from "./components/archivedAccountRuntime";
import AuthSessionWatcher from "./components/authSessionWatcher";
import ConsoleWarning from "./components/consoleWarning";
import DataTranslateRuntime from "./components/dataTranslateRuntime";
import EducationOnboarding from "./components/educationOnboarding";
import ErrorOverlaySuppressor from "./components/errorOverlaySuppressor";
import GlobalLoadingProgress from "./components/globalLoadingProgress";
import GlobalTooltips from "./components/globalTooltips";
import ModalProvider from "./components/modal";
import OrganizationPolicyRuntime from "./components/organizationPolicyRuntime";
import ServiceWorkerRecovery from "./components/serviceWorkerRecovery";
import SessionCookieBoundary from "./components/sessionCookieBoundary";
import ToastProvider from "./components/toast";

export const metadata = {
  title: "Munetios",
  description: "Privacy focused secure workspace platform",
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport = {
  initialScale: 1,
  userScalable: true,
  width: "device-width",
};

export default async function RootLayout({ children }) {
  const cookieStore = await cookies();
  const sessionPresent = cookieStore.has("munetios_session");
  return (
    <html dir="ltr" lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://api.munetios.com/beautiful-css/beautiful.css"
        />
      </head>
      <body>
        <SessionCookieBoundary sessionPresent={sessionPresent}>
          <AppearanceRuntime />
          <ArchivedAccountRuntime />
          <AuthSessionWatcher />
          <EducationOnboarding />
          <OrganizationPolicyRuntime />
          <GlobalLoadingProgress />
          <GlobalTooltips />
          <munetios-app id="munetiosApp">{children}</munetios-app>
          <ModalProvider />
          <ToastProvider />
          <DataTranslateRuntime />
          <ErrorOverlaySuppressor />
          <ServiceWorkerRecovery />
          <ConsoleWarning />
        </SessionCookieBoundary>
      </body>
    </html>
  );
}
