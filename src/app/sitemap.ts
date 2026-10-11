import type { MetadataRoute } from "next";
import { DEMO_SLUGS } from "@/lib/demo/reports";
import { SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, priority: 1 },
    { url: `${SITE_URL}/demo`, priority: 0.8 },
    ...DEMO_SLUGS.map((d) => ({ url: `${SITE_URL}/demo/${d.slug}`, priority: 0.6 })),
  ];
}
