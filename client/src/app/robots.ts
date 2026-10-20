import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      // Private, per-account areas never belong in search results.
      disallow: ["/admin", "/api/", "/messages", "/settings", "/saved", "/notifications", "/circles", "/following", "/profile/edit"],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
