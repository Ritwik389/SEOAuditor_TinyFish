import { ImageResponse } from "next/og";

export const alt = "Sniffsite: your website has a scent. Can AI find it?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#010120", color: "#fff", padding: 72 }}>
        <div style={{ fontSize: 40, letterSpacing: -2, display: "flex" }}>sniff<span style={{ opacity: 0.62 }}>site</span></div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 76, lineHeight: 1.1, letterSpacing: -3, display: "flex", flexWrap: "wrap" }}>Your website has a scent. Can AI find it?</div>
          <div style={{ fontSize: 30, color: "#b4b4c8", marginTop: 24, display: "flex" }}>AI search visibility and SEO auditor, backed by evidence.</div>
        </div>
        <div style={{ height: 10, width: "100%", display: "flex", background: "linear-gradient(90deg,#fc4c02,#ef2cc1,#bdbbff)" }} />
      </div>
    ),
    size,
  );
}
