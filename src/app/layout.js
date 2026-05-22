import StripeProvider from "./StripeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { AudioProvider } from "@/context/AudioContext";
import GlobalAudioPlayerBar from "@/components/audio/GlobalAudioPlayerBar";

export const metadata = {
  title: "Artist Site",
  description: "Music, albums, and merch",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "white" }}>
        <AuthProvider>
          <AudioProvider>
            <StripeProvider>
              {children}
              <GlobalAudioPlayerBar />
            </StripeProvider>
          </AudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
