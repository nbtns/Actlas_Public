import type { Metadata, Viewport } from "next";
import "./globals.css";

const appTitle = "Actlas - Online Lesson Room";
const appDescription = "Join your live lesson with notes, materials, and review in one place.";

export const metadata: Metadata = {
  title: appTitle,
  description: appDescription,
  manifest: "/manifest.json",
  openGraph: {
    title: appTitle,
    description: appDescription,
  },
  twitter: {
    title: appTitle,
    description: appDescription,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Actlas",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#FF6A36",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* iOS Safari: スプラッシュスクリーン用の背景色 */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        {children}
        {/* Service Worker登録スクリプト */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
                    .then(function(reg) {
                      reg.update();
                      console.log('[PWA] Service Worker 登録成功:', reg.scope);
                    })
                    .catch(function(err) {
                      console.log('[PWA] Service Worker 登録失敗:', err);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
