import "./globals.css";
import type { Metadata } from "next";
import { GlobalProgress } from "@/components/GlobalProgress";

export const metadata: Metadata = { title: "MM ERP", description: "Könyvelés, ÁFA, készlet, beszámoló" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        {children}
        <GlobalProgress />
      </body>
    </html>
  );
}
