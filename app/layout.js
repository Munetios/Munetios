import "./globals.css";
import AppearanceRuntime from "./components/appearanceRuntime";
import AuthSessionWatcher from "./components/authSessionWatcher";
import ConsoleWarning from "./components/consoleWarning";
import DataTranslateRuntime from "./components/dataTranslateRuntime";
import ErrorOverlaySuppressor from "./components/errorOverlaySuppressor";
import GlobalLoadingProgress from "./components/globalLoadingProgress";
import GlobalTooltips from "./components/globalTooltips";
import ModalProvider from "./components/modal";
import OrganizationPolicyRuntime from "./components/organizationPolicyRuntime";
import ServiceWorkerRecovery from "./components/serviceWorkerRecovery";
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

export default function RootLayout({ children }) {
  return (
    <html dir="ltr" lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://api.munetios.com/beautiful-css/beautiful.css"
        />
      </head>
      <body>
        <AppearanceRuntime />
        <AuthSessionWatcher />
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
      </body>
    </html>
  );
}
