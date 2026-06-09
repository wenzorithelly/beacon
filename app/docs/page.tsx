import type { Metadata } from "next";
import { Docs } from "@/components/docs/docs";

// `/docs` is a PUBLIC page — the detailed guide for the hosted site (trybeacon.sh). proxy.ts
// allowlists it in public mode; locally the tool routes win and this is reachable directly.
export const metadata: Metadata = {
  title: "Docs — Beacon",
  description:
    "How Beacon works: install, the planning loop, the canvases, the CLI, and the Claude Code integration (skills, MCP tools, hooks).",
};

export default function DocsPage() {
  return <Docs />;
}
