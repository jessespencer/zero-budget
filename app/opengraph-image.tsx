import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Applies to every route that doesn't define its own opengraph-image.
export const alt = "Zero — Personal family finance";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#21211B";
const LIME = "#A6DA0F";
const CREAM = "#F5F1E6";

// Satori can't read woff2, which is the only format @fontsource-variable/figtree
// ships — so the OG renderer gets its own vendored OTF copies. They live under
// `public/` because that's the one directory every deploy path keeps (pm2 runs
// from the repo, and the Dockerfile copies `public/` explicitly); a font under
// `app/` would vanish from a container build. Without them satori falls back to
// its bundled Noto Sans, which has no bold and renders the wordmark at 400.
const font = (file: string) =>
  readFileSync(join(process.cwd(), "public", "fonts", file));

// Deliberately static: an OG image is rendered by whatever client previews the
// link, so it must never carry balances, category names, or anything else from
// the database.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          backgroundImage: `radial-gradient(circle at 78% 12%, ${LIME}2E 0%, ${LIME}00 46%)`,
          padding: "72px 80px",
        }}
      >
        {/* Logo tile — mirrors app/icon.svg */}
        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 104,
              height: 104,
              borderRadius: 24,
              background: LIME,
              color: INK,
              fontSize: 68,
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            Z
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 116,
              fontWeight: 800,
              letterSpacing: "-0.045em",
              color: CREAM,
              lineHeight: 1,
            }}
          >
            Zero
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 40,
              color: `${CREAM}A6`,
              letterSpacing: "-0.015em",
            }}
          >
            Personal family finance
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            paddingTop: 34,
            borderTop: `2px solid ${CREAM}1F`,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 14,
              height: 14,
              borderRadius: 7,
              background: LIME,
            }}
          />
          <div style={{ display: "flex", fontSize: 28, color: `${CREAM}8A` }}>
            Envelope budgeting · self-hosted
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Figtree",
          data: font("Figtree-Regular.otf"),
          weight: 400,
          style: "normal",
        },
        {
          name: "Figtree",
          data: font("Figtree-ExtraBold.otf"),
          weight: 800,
          style: "normal",
        },
      ],
    },
  );
}
