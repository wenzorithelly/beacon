"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BeaconMark } from "@/components/beacon-mark";
import { INSTALL_COMMAND } from "@/lib/release";
import "../landing/landing.css";

// Public, self-contained docs page (rendered bare in public mode — no app chrome). Mirrors the
// landing's design system (glass / dark / #ff7a45) via landing.css. Two columns on desktop: a
// sticky scroll-spy TOC + a prose column; single column on mobile.

const SECTIONS = [
  { id: "overview", title: "What is Beacon" },
  { id: "install", title: "Install" },
  { id: "quickstart", title: "Quickstart" },
  { id: "loop", title: "The planning loop" },
  { id: "canvases", title: "The canvases" },
  { id: "cli", title: "CLI reference" },
  { id: "integration", title: "Claude Code integration" },
  { id: "config", title: "Configuration" },
  { id: "telemetry", title: "Telemetry" },
  { id: "troubleshooting", title: "Troubleshooting" },
];

const CLI: { cmd: string; what: string }[] = [
  { cmd: "beacon", what: "Register the current repo, ensure the shared server is running, and open the panel on this repo. The everyday command." },
  { cmd: "beacon doctor", what: "Audit what's wired — the global Claude Code hooks + skills, this repo's .mcp.json, and the running daemon." },
  { cmd: "beacon stop", what: "Stop the shared background server. It restarts the next time you run beacon." },
  { cmd: "beacon setup", what: "(Re)install Beacon's per-repo helpers — the skills and .mcp.json — in the current repo without opening the panel." },
  { cmd: "beacon uninstall", what: "Reverse every Beacon artifact: the global ~/.claude wiring and the per-repo files." },
  { cmd: "beacon mcp", what: "The stdio MCP server Claude Code spawns automatically. You never run this by hand." },
];

const SKILLS: { name: string; when: string; what: string }[] = [
  { name: "/beacon-init", when: "First time you point Beacon at a repo.", what: "The agent reads the codebase and fills Beacon's map — the main components, the rough roadmap themes, the database schema, and the endpoints. Run it once per repo to bootstrap the picture." },
  { name: "/beacon-refresh", when: "Every few weeks, or after a big set of changes.", what: "The agent re-surveys the repo and updates what /beacon-init produced — adds new components, drops removed ones, picks up new tables and routes. Anything you added by hand on the canvas survives." },
  { name: "/beacon-plan", when: "Whenever you want to review an approach on the canvas.", what: "Present the current plan or approach on Beacon's /plan page for annotation instead of asking for approval as a wall of text." },
];

const MCP_TOOLS: { name: string; what: string }[] = [
  { name: "beacon_context_for_feature", what: "Before touching code, the agent pulls the files attached to a feature plus their imports, the endpoints in that domain, the tables those endpoints touch, and the surrounding components — one round-trip instead of a blind Glob/Grep scan." },
  { name: "beacon_blast_radius", what: "Mid-feature, the agent runs this on a file it's about to edit to see what imports it and what it imports — so it can judge whether a change is safe." },
  { name: "beacon_propose_plan", what: "When the agent has a feature plan (tables + relations + endpoints), this opens it on /plan and BLOCKS the session until you Approve, Discard, or Submit feedback." },
  { name: "beacon_describe_feature", what: "When a feature is done, the agent records a short markdown summary and the files it touched, keeping the next session's context accurate." },
  { name: "beacon_map", what: "A quick list of features already on the roadmap. The agent calls it near the start of work to avoid duplicating what's planned." },
  { name: "beacon_entities", what: "A raw readout of everything mapped — features, architecture, tables, endpoints — when the agent just needs the planning data." },
];

const HOOKS: { trigger: string; what: string }[] = [
  { trigger: "Plan mode (ExitPlanMode)", what: "When the agent shows you a plan, Beacon intercepts it and renders the markdown on /plan with a native annotation panel. Select text and type → it becomes a comment. Approve / Discard / Submit feedback flows back to the session as the next instruction." },
  { trigger: "File edits (PostToolUse)", what: "Every Edit/Write the agent runs is reported to Beacon and the file is attached to whichever feature the session is working on. The /map view fills in with the real files behind each feature, without you tagging anything." },
  { trigger: "Code-graph watcher", what: "While the panel is open, a background watcher rebuilds the Files view as you save code — the maps stay current with the repo on their own." },
];

const CONFIG: { key: string; what: string }[] = [
  { key: "BEACON_HOME", what: "Where per-workspace data lives — the SQLite databases and the server record. Defaults to ~/.beacon." },
  { key: "PORT", what: "Port for the shared local server. Defaults to 4319." },
  { key: "Settings → intel", what: "In the panel, the Settings page drives the code-intelligence model/provider and your editor, and triggers a code-map sync." },
];

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="glass-soft w-hover grid h-8 w-8 shrink-0 place-items-center rounded-md"
      aria-label={label}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff7a45" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function Cmd({ children, copy }: { children: string; copy?: boolean }) {
  return (
    <div className="glass-soft flex items-center gap-3 rounded-lg px-4 py-2.5">
      <span className="w-signal select-none">$</span>
      <code className="w-mono w-scrollbar-none flex-1 overflow-x-auto whitespace-nowrap text-[0.85rem] text-foreground">
        {children}
      </code>
      {copy && <Copy text={children} />}
    </div>
  );
}

function Heading({ id, eyebrow, children }: { id: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 scroll-mt-28" id={id}>
      <p className="w-mono w-eyebrow w-signal mb-2">{eyebrow}</p>
      <h2 className="text-[1.6rem] font-semibold tracking-tight">{children}</h2>
    </div>
  );
}

export function Docs() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <div className="welcome" ref={rootRef}>
      <div className="welcome-bg" aria-hidden />

      {/* ===== nav ===== */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto max-w-6xl px-6">
          <div className="w-load mt-4 glass flex items-center justify-between rounded-full py-2.5 pl-5 pr-3" style={{ animationDelay: ".05s" }}>
            <Link href="/" className="flex items-center gap-2.5">
              <BeaconMark size={20} className="text-foreground" />
              <span className="font-semibold tracking-tight">Beacon</span>
              <span className="w-mono w-eyebrow w-muted ml-1 hidden sm:inline">docs</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm w-muted">
              <Link href="/" className="transition-colors hover:text-foreground">Home</Link>
              <a href="#install" className="transition-colors hover:text-foreground">Install</a>
            </nav>
          </div>
        </div>
      </header>

      {/* ===== body ===== */}
      <div className="mx-auto max-w-6xl px-6 pb-24 pt-20">
        <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-14">
          {/* TOC */}
          <aside className="hidden lg:block">
            <nav className="sticky top-28">
              <p className="w-mono w-eyebrow w-muted mb-4">On this page</p>
              <ul className="space-y-1.5 text-sm">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className={`block border-l-2 py-1 pl-3 transition-colors ${
                        active === s.id
                          ? "w-signal border-[#ff7a45]"
                          : "w-muted border-transparent hover:text-foreground"
                      }`}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* content */}
          <main className="min-w-0 max-w-2xl">
            {/* overview */}
            <section className="w-load">
              <Heading id="overview" eyebrow="Overview">What is Beacon</Heading>
              <p className="w-muted leading-relaxed">
                Beacon is the <span className="text-foreground">visual planning surface for the coding agent in your terminal</span>.
                That session is the brain; Beacon is its eyes and hands. The agent proposes a feature plan — roadmap features,
                database schema, and endpoints — you review it on a canvas instead of a wall of text, give scoped feedback, and
                approve or discard with a click. The verdict flows straight back to your session.
              </p>
              <p className="w-muted mt-4 leading-relaxed">
                It runs entirely on your machine — <span className="text-foreground">local-first, your code never leaves it</span>. One shared
                server quietly serves every repo you open; each keeps its own data under <span className="w-mono text-foreground">~/.beacon</span>.
              </p>
            </section>

            {/* install */}
            <section className="mt-16">
              <Heading id="install" eyebrow="Get started">Install</Heading>
              <p className="w-muted mb-4 leading-relaxed">
                One command. It installs <span className="text-foreground">Bun</span> if you don&apos;t have it, then puts the{" "}
                <span className="w-mono text-foreground">beacon</span> CLI on your PATH. Re-run it any time to update.
              </p>
              <Cmd copy>{INSTALL_COMMAND}</Cmd>
              <p className="w-muted mt-4 leading-relaxed">Then, inside any repository:</p>
              <div className="mt-3"><Cmd copy>beacon</Cmd></div>
            </section>

            {/* quickstart */}
            <section className="mt-16">
              <Heading id="quickstart" eyebrow="Get started">Quickstart</Heading>
              <ol className="space-y-5">
                {[
                  <>Install with the command above, then run <span className="w-mono text-foreground">beacon</span> inside a repo. It registers the repo, starts the shared server, and opens the panel in your browser.</>,
                  <>In your Claude Code session, run <span className="w-mono text-foreground">/beacon-init</span>. The agent reads the repo and draws its architecture, schema, and roadmap onto the canvas.</>,
                  <>Ask the agent to plan a feature. It calls <span className="w-mono text-foreground">beacon_propose_plan</span> and the plan renders live on <span className="text-foreground">/plan</span>.</>,
                  <>Review it — annotate inline, edit the boards — then <span className="text-foreground">Approve</span>, <span className="text-foreground">Submit feedback</span>, or <span className="text-foreground">Discard</span>. Your verdict returns to the session.</>,
                ].map((body, i) => (
                  <li key={i} className="relative pl-11">
                    <span className="w-mono glass absolute left-0 top-0 grid h-7 w-7 place-items-center rounded-md text-[0.72rem] font-semibold text-foreground">{i + 1}</span>
                    <p className="w-muted leading-relaxed">{body}</p>
                  </li>
                ))}
              </ol>
            </section>

            {/* loop */}
            <section className="mt-16">
              <Heading id="loop" eyebrow="Concepts">The planning loop</Heading>
              <p className="w-muted leading-relaxed">
                The loop is the whole point. It closes in five steps:
              </p>
              <ol className="mt-4 space-y-3">
                {[
                  <><span className="text-foreground">Propose.</span> The agent calls <span className="w-mono text-foreground">beacon_propose_plan</span> (or you present a plan in plan mode). The tool <span className="text-foreground">blocks</span> — the session waits for your verdict.</>,
                  <><span className="text-foreground">Review.</span> The plan renders on <span className="text-foreground">/plan</span>: a native annotation panel on the left, the roadmap and database boards on the right. Select text to comment; edit the boards directly.</>,
                  <><span className="text-foreground">Decide.</span> Approve, Discard, or Submit feedback. Feedback bundles your inline notes plus any board edits.</>,
                  <><span className="text-foreground">Return.</span> The verdict flows back to the terminal. On feedback, the agent revises and re-proposes — the loop continues.</>,
                  <><span className="text-foreground">Record.</span> On approval the schema and roadmap drafts persist, and when the work is done the agent calls <span className="w-mono text-foreground">beacon_describe_feature</span> so the next session has accurate context.</>,
                ].map((body, i) => (
                  <li key={i} className="glass w-hover rounded-lg p-4">
                    <p className="w-muted text-[0.95rem] leading-relaxed">{body}</p>
                  </li>
                ))}
              </ol>
            </section>

            {/* canvases */}
            <section className="mt-16">
              <Heading id="canvases" eyebrow="Concepts">The canvases</Heading>
              <div className="space-y-4">
                {[
                  { path: "/map", what: "The roadmap: feature cards, their sub-tasks, and dependency links — plus a separate architecture view of the real components. Files the agent edits attach themselves here." },
                  { path: "/db", what: "The database design board: tables and columns, endpoints, and the endpoint→table links. Proposed schema lands as a distinct draft layer you can approve or discard." },
                  { path: "/plan", what: "The split-screen review page: annotations on the left, the roadmap + database boards tabbed on the right, plus a history of every plan and its verdict." },
                ].map((c) => (
                  <div key={c.path} className="glass w-hover rounded-lg p-5">
                    <p className="w-mono text-foreground mb-1">{c.path}</p>
                    <p className="w-muted text-[0.95rem] leading-relaxed">{c.what}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* cli */}
            <section className="mt-16">
              <Heading id="cli" eyebrow="Reference">CLI reference</Heading>
              <div className="space-y-3">
                {CLI.map((c) => (
                  <div key={c.cmd} className="glass rounded-lg p-4">
                    <code className="w-mono text-foreground text-[0.9rem]"><span className="w-signal select-none">$ </span>{c.cmd}</code>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{c.what}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* integration */}
            <section className="mt-16">
              <Heading id="integration" eyebrow="Reference">Claude Code integration</Heading>

              <h3 className="mb-1 mt-2 font-semibold text-foreground">Skills — you type these</h3>
              <p className="w-muted mb-4 text-[0.92rem]">Slash commands that tell the agent to do something Beacon-shaped.</p>
              <div className="space-y-3">
                {SKILLS.map((s) => (
                  <div key={s.name} className="glass rounded-lg p-4">
                    <code className="w-mono text-foreground text-[0.9rem]">{s.name}</code>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed"><span className="text-foreground">When:</span> {s.when} {s.what}</p>
                  </div>
                ))}
              </div>

              <h3 className="mb-1 mt-8 font-semibold text-foreground">MCP tools — the agent calls these</h3>
              <p className="w-muted mb-4 text-[0.92rem]">You don&apos;t run these; the agent reaches for them when they fit. Knowing they exist makes its moves legible.</p>
              <div className="space-y-3">
                {MCP_TOOLS.map((t) => (
                  <div key={t.name} className="glass rounded-lg p-4">
                    <code className="w-mono text-foreground text-[0.9rem]">{t.name}</code>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{t.what}</p>
                  </div>
                ))}
              </div>

              <h3 className="mb-1 mt-8 font-semibold text-foreground">Hooks — these run on their own</h3>
              <p className="w-muted mb-4 text-[0.92rem]">Wired into Claude Code globally; they react to what the session is already doing.</p>
              <div className="space-y-3">
                {HOOKS.map((h) => (
                  <div key={h.trigger} className="glass rounded-lg p-4">
                    <p className="font-medium text-foreground text-[0.92rem]">{h.trigger}</p>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{h.what}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* config */}
            <section className="mt-16">
              <Heading id="config" eyebrow="Reference">Configuration</Heading>
              <div className="space-y-3">
                {CONFIG.map((c) => (
                  <div key={c.key} className="glass rounded-lg p-4">
                    <code className="w-mono text-foreground text-[0.9rem]">{c.key}</code>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{c.what}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* telemetry */}
            <section className="mt-16">
              <Heading id="telemetry" eyebrow="Reference">Telemetry</Heading>
              <p className="w-muted mb-4 leading-relaxed">
                Beacon sends an anonymous heartbeat at most every 12 hours while the local server runs,
                so we can count active installs (npm download numbers are dominated by mirrors and CI).
                The payload is exactly five fields — verify it yourself anytime with{" "}
                <span className="w-mono text-foreground">beacon telemetry status</span>, which prints the
                exact payload that gets sent.
              </p>
              <div className="space-y-3">
                <div className="glass rounded-lg p-4">
                  <p className="font-medium text-foreground text-[0.92rem]">What is sent</p>
                  <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">
                    A random machine id (a UUID generated locally — tied to nothing), the Beacon version,
                    the operating system (<span className="w-mono">darwin</span>/<span className="w-mono">linux</span>/<span className="w-mono">win32</span>),
                    the CPU architecture, and whether the machine is a CI runner.
                  </p>
                </div>
                <div className="glass rounded-lg p-4">
                  <p className="font-medium text-foreground text-[0.92rem]">What is never sent</p>
                  <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">
                    Repo names, file paths, code, plans, board content, environment variables, or anything
                    derived from them. IP addresses are not stored.
                  </p>
                </div>
                <div className="glass rounded-lg p-4">
                  <p className="font-medium text-foreground text-[0.92rem]">Opting out</p>
                  <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">
                    Any of: <span className="w-mono text-foreground">beacon telemetry off</span>, the env var{" "}
                    <span className="w-mono text-foreground">BEACON_TELEMETRY_DISABLED=1</span>, or the
                    cross-tool <span className="w-mono text-foreground">DO_NOT_TRACK=1</span> convention.
                    Re-enable with <span className="w-mono text-foreground">beacon telemetry on</span>.
                  </p>
                </div>
              </div>
            </section>

            {/* troubleshooting */}
            <section className="mt-16">
              <Heading id="troubleshooting" eyebrow="Help">Troubleshooting</Heading>
              <p className="w-muted mb-4 leading-relaxed">
                When something looks off, start here:
              </p>
              <div className="mb-4"><Cmd copy>beacon doctor</Cmd></div>
              <div className="space-y-3">
                {[
                  { q: "The panel won't open", a: <>Make sure the server is up — run <span className="w-mono text-foreground">beacon</span> again, or <span className="w-mono text-foreground">beacon stop</span> then <span className="w-mono text-foreground">beacon</span> to restart it.</> },
                  { q: "The @beacon tools or skills are missing in Claude Code", a: <>Run <span className="w-mono text-foreground">beacon setup</span> in the repo, then restart your Claude Code session so it re-reads the MCP registration.</> },
                  { q: "How do I update?", a: <>Re-run the install command — it fetches the latest and relinks. Nothing else to do.</> },
                ].map((t) => (
                  <div key={t.q} className="glass rounded-lg p-4">
                    <p className="font-medium text-foreground text-[0.92rem]">{t.q}</p>
                    <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{t.a}</p>
                  </div>
                ))}
              </div>
            </section>
          </main>
        </div>
      </div>

      {/* ===== footer ===== */}
      <footer className="px-6 pb-12 pt-8">
        <div className="mx-auto max-w-6xl">
          <div className="w-accent-line mb-8 h-px w-full opacity-60" />
          <div className="flex flex-col items-center justify-between gap-5 md:flex-row">
            <div className="flex items-center gap-2.5">
              <BeaconMark size={26} className="text-foreground" />
              <div>
                <p className="font-semibold leading-tight">Beacon</p>
                <p className="w-mono w-muted text-[0.72rem]">the visual planning surface for your terminal</p>
              </div>
            </div>
            <nav className="flex items-center gap-6 text-sm w-muted">
              <Link href="/" className="transition-colors hover:text-foreground">Home</Link>
              <a href="#overview" className="transition-colors hover:text-foreground">Docs</a>
            </nav>
            <p className="w-mono w-muted text-[0.72rem]">
              Created by{" "}
              <a
                href="https://www.instagram.com/wenzorithelly/"
                target="_blank"
                rel="noreferrer"
                className="w-signal inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
                Wenzo
              </a>
              <span className="mx-2 opacity-40">·</span>© 2026 Beacon
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
