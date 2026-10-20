import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Generated 1200×630 preview cards. Fonts and logo ship in /public, so the standalone build has them. */
const asset = (name: string) => readFile(join(process.cwd(), "public", name));
const assets = Promise.all([
  asset("og-fonts/poppins-latin-400-normal.woff"), asset("og-fonts/poppins-latin-ext-400-normal.woff"),
  asset("og-fonts/poppins-latin-700-normal.woff"), asset("og-fonts/poppins-latin-ext-700-normal.woff"),
  asset("circle-logo.png"),
]).catch(() => null);
export const OG_SIZE = { width: 1200, height: 630 };

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "C";
}

export async function card({ name, handle, text, avatar, badge, meta, brand = false }: {
  name: string; handle?: string; text: string; avatar?: string | null; badge?: string;
  /** A muted line under the text, e.g. follower counts. */ meta?: string;
  /** Show the Circle logo in place of the avatar. */ brand?: boolean;
}) {
  const loaded = await assets;
  const fonts = loaded ? [
    { name: "Poppins", data: loaded[0], weight: 400 as const, style: "normal" as const },
    { name: "Poppins", data: loaded[1], weight: 400 as const, style: "normal" as const },
    { name: "Poppins", data: loaded[2], weight: 700 as const, style: "normal" as const },
    { name: "Poppins", data: loaded[3], weight: 700 as const, style: "normal" as const },
  ] : undefined;
  const logo = loaded ? `data:image/png;base64,${loaded[4].toString("base64")}` : null;
  const long = text.length > 140;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", padding: 56, fontFamily: "Poppins",
        background: "linear-gradient(135deg, #1a73e8 0%, #4f46e5 55%, #7c3aed 100%)" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%",
          padding: "44px 52px", borderRadius: 36, background: "#ffffff", boxShadow: "0 30px 80px rgba(15, 23, 42, 0.35)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {brand && logo
              ? <img src={logo} width={86} height={88} alt="" />
              : avatar
              ? <img src={avatar} width={88} height={88} style={{ borderRadius: 44, objectFit: "cover" }} alt="" />
              : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 88, height: 88, borderRadius: 44,
                  background: "#e7f1fe", color: "#2b6fbf", fontSize: 34, fontWeight: 700 }}>{initials(name)}</div>}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 38, fontWeight: 700, color: "#17191d", lineHeight: 1.15 }}>{name}</div>
              {handle && <div style={{ display: "flex", fontSize: 26, color: "#69717c" }}>@{handle}</div>}
            </div>
            {badge && <div style={{ display: "flex", marginLeft: "auto", padding: "8px 20px", borderRadius: 999, background: "#eef2ff",
              color: "#4338ca", fontSize: 24, fontWeight: 700 }}>{badge}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", fontSize: long ? 36 : 46, fontWeight: 400, color: "#17191d", lineHeight: 1.35, overflow: "hidden" }}>{text}</div>
            {meta && <div style={{ display: "flex", fontSize: 26, color: "#69717c" }}>{meta}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {logo && <img src={logo} width={46} height={47} alt="" />}
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: "#17191d" }}>Circle</div>
            <div style={{ display: "flex", marginLeft: "auto", fontSize: 22, color: "#69717c" }}>A little more connection</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts, headers: { "Cache-Control": "public, max-age=3600, s-maxage=3600" } },
  );
}
