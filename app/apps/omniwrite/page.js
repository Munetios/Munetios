import "./globals.css";
import OmniWritePwaRegistration from "./components/omniWritePwaRegistration";
import OmniWriteShell from "./components/shell";

export const metadata = {
  title: "Munetios OmniWrite",
  description: "A powerful and intuitive writing tool by Munetios.",
  applicationName: "Munetios OmniWrite",
  manifest: "/omniwrite.webmanifest",
  icons: {
    icon: [
      {
        url: "/omniwrite.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
    shortcut: "/omniwrite-192.png",
    apple: [
      {
        url: "/omniwrite-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Munetios OmniWrite",
  },
};

export const viewport = {
  themeColor: "#3b0764",
};

export default function OmniWritePage() {
  return (
    <>
      <OmniWriteShell />
      <OmniWritePwaRegistration />
    </>
  );
}
