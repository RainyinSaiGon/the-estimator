import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Estimator — scope with confidence",
  description: "Clear project scopes, explained estimates, and lessons from real delivery.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
