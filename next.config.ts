import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  poweredByHeader: false, // v7.1.0 – ne árulja el a keretrendszert
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // v6.0.0 – alap biztonsági fejlécek; a jelszó-visszaállító link tokenje ne kerüljön más oldalnak küldött Referer fejlécbe
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // v7.1.0 – HTTPS kikényszerítése (a Render mindig HTTPS-en szolgál ki), és a böngésző-funkciók szűkítése
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
          // v7.1.0 – szűk CSP: nincs beágyazás idegen oldalba, nincs <base> / plugin
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
