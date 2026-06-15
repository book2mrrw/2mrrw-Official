import StripeProvider from "./StripeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { AuthGateProvider } from "@/context/AuthGateContext";
import AppAuthRoot from "@/components/auth/AppAuthRoot";
import { AudioProvider } from "@/context/AudioContext";
import GlobalAudioPlayerBar from "@/components/audio/GlobalAudioPlayerBar";
import SessionRecoveryRoot from "@/components/system/SessionRecoveryRoot";
import PostHogInit from "@/components/system/PostHogInit";
import BlackscreenTraceBootstrap from "@/components/system/BlackscreenTraceBootstrap";
import PlaybackNetworkHints from "@/components/system/PlaybackNetworkHints";
import { MediaErrorBoundary } from "@/system/errors";

export const metadata = {
  title: "2MRRW",
  description: "Official music from 2MRRW — stream, collect, and experience every release.",
  manifest: "/manifest.json",
  themeColor: "#0a0a0a",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "2MRRW",
  },
  openGraph: {
    title: "2MRRW",
    description: "Official music from 2MRRW — stream, collect, and experience every release.",
    url: "https://www.2mrrw.com",
    siteName: "2MRRW",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "2MRRW" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "2MRRW",
    description: "Official music from 2MRRW — stream, collect, and experience every release.",
    images: ["/icons/icon-512.png"],
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
      <head>
        <PlaybackNetworkHints />
      </head>
      <body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){});});}`,
          }}
        />
        <PostHogInit />
        <AuthProvider>
          <BlackscreenTraceBootstrap />
          <AudioProvider>
            <AppAuthRoot>
              <AuthGateProvider>
                <SessionRecoveryRoot>
                  <StripeProvider>
                    <MediaErrorBoundary assetId="app-layout" mediaType="layout">
                      {children}
                    </MediaErrorBoundary>
                  </StripeProvider>
                </SessionRecoveryRoot>
              </AuthGateProvider>
            </AppAuthRoot>
            <GlobalAudioPlayerBar />
          </AudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
