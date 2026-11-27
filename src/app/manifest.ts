import type { MetadataRoute } from "next";

/** v6.11.0 – „Hozzáadás a kezdőképernyőhöz”: telefonon alkalmazásként nyílik (a bizonylatfeltöltő portálhoz). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "mogyorosi.erp",
    short_name: "ERP",
    description: "Könyvelés és bizonylatfeltöltés",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f3a5f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
