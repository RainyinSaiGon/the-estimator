import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Estimator — integration scoping",
  description: "Review integration scope, effort and assumptions before a commitment.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
