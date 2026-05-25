import StripeProvider from "./StripeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGateProvider } from "@/context/AuthGateContext";
import AppAuthRoot from "@/components/auth/AppAuthRoot";
import { AudioProvider } from "@/context/AudioContext";
import GlobalAudioPlayerBar from "@/components/audio/GlobalAudioPlayerBar";
import SessionRecoveryRoot from "@/components/system/SessionRecoveryRoot";
import { MediaErrorBoundary } from "@/system/errors";

export const metadata = {
  title: "Artist Site",
  description: "Music, albums, and merch",
  manifest: "/manifest.json",
  themeColor: "#0a0a0a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
        <AuthProvider>
          <AppAuthRoot>
            <AuthGateProvider>
              <AudioProvider>
                <SessionRecoveryRoot>
                  <StripeProvider>
                    {children}
                    <MediaErrorBoundary>
                      <GlobalAudioPlayerBar />
                    </MediaErrorBoundary>
                  </StripeProvider>
                </SessionRecoveryRoot>
              </AudioProvider>
            </AuthGateProvider>
          </AppAuthRoot>
        </AuthProvider>
      </body>
    </html>
  );
}
