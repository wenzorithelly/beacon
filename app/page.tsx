import type { Metadata } from "next";
import { Landing } from "@/components/landing/landing";

// `/` is the PUBLIC landing page. Locally (the `beacon` CLI), proxy.ts redirects
// `/` straight to the tool, so users never land here — this only renders on a
// public deploy (BEACON_PUBLIC=1).
export const metadata: Metadata = {
  title: "Beacon — the visual planning surface for the coding agent in your terminal",
  description:
    "Propose a feature plan, review it on a canvas instead of a wall of text, and approve with a click. Local-first, one binary, runs in any repo.",
};

export default function Page() {
  return <Landing />;
}
