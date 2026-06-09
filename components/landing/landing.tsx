"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BeaconMark } from "@/components/beacon-mark";
import "./landing.css";

const INSTALL = "curl -fsSL https://beacon.dev/install.sh | sh";

const STEPS: { n: string; title: string; body: React.ReactNode; cmd?: React.ReactNode }[] = [
  {
    n: "01",
    title: "Install",
    body: "One binary. No account, nothing to configure.",
    cmd: <span className="text-foreground">{INSTALL}</span>,
  },
  {
    n: "02",
    title: "Run it in your repo",
    body: "Registers the repo, starts one shared local server, and opens the panel in your browser.",
    cmd: (
      <>
        <span className="w-signal">$</span> <span className="text-foreground">beacon</span>
      </>
    ),
  },
  {
    n: "03",
    title: "Map your codebase",
    body: (
      <>
        In your terminal session, run <span className="w-mono text-foreground">/beacon-init</span>. Beacon reads the
        repo and draws its architecture, schema, and roadmap.
      </>
    ),
    cmd: (
      <>
        <span className="text-foreground">/beacon-init</span> <span className="w-muted">· beacon doctor</span>
      </>
    ),
  },
  {
    n: "04",
    title: "Propose your first plan",
    body: (
      <>
        Ask the agent to plan a feature. It calls <span className="w-mono text-foreground">beacon_propose_plan</span>{" "}
        and the plan renders live on the <span className="text-foreground">/plan</span> canvas — features, tables, and
        endpoints.
      </>
    ),
  },
  {
    n: "05",
    title: "Review & close the loop",
    body: (
      <>
        Annotate inline, edit the boards, then <span className="text-foreground">Approve</span>,{" "}
        <span className="text-foreground">Submit&nbsp;feedback</span>, or <span className="text-foreground">Discard</span>.
        Your verdict flows straight back to your terminal session.
      </>
    ),
  },
];

const TIPS = [
  { label: "Reuse first", body: "Beacon blocks duplicate features — check the map before you create." },
  {
    label: "Design data first",
    body: (
      <>
        Plan tables and endpoints before code; review the schema as a draft on{" "}
        <span className="text-foreground">/db</span>.
      </>
    ),
  },
  { label: "Close every loop", body: "Register finished work so the map and context stay accurate next session." },
];

const badgeGlow = {
  boxShadow: "0 0 0 1px var(--border), 0 0 24px -9px rgba(255,122,69,0.75)",
} as const;

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    rootRef.current?.querySelectorAll(".w-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  function copyInstall() {
    navigator.clipboard?.writeText(INSTALL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="welcome" ref={rootRef}>
      <div className="welcome-bg" aria-hidden />

      {/* ===== nav ===== */}
      <header className="fixed inset-x-0 top-0 z-50">
        <div className="mx-auto max-w-6xl px-6">
          <div
            className="w-load mt-4 glass flex items-center justify-between rounded-full py-2.5 pl-5 pr-3"
            style={{ animationDelay: ".05s" }}
          >
            <Link href="#top" className="flex items-center gap-2.5">
              <BeaconMark size={20} className="text-foreground" />
              <span className="font-semibold tracking-tight">Beacon</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm w-muted">
              <a href="#start" className="transition-colors hover:text-foreground">
                How it works
              </a>
              <a href="#" className="hidden transition-colors hover:text-foreground sm:block">
                Docs
              </a>
              <a
                href="https://github.com"
                className="glass-soft w-hover flex items-center gap-2 rounded-md px-3.5 py-1.5 text-foreground"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
                </svg>
                GitHub
              </a>
            </nav>
          </div>
        </div>
      </header>

      <span id="top" />

      {/* ===== hero ===== */}
      <section className="flex min-h-screen flex-col items-center px-6 pb-8 pt-24 text-center">
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          <div
            className="w-load glass-soft mb-6 flex items-center gap-2 rounded-full px-3.5 py-1.5"
            style={{ animationDelay: ".12s" }}
          >
            <span
              className="w-live h-1.5 w-1.5 rounded-full"
              style={{ background: "#ff7a45", boxShadow: "0 0 8px #ff7a45" }}
            />
            <span className="w-mono w-eyebrow w-muted">Local · no account · no API key</span>
          </div>

          <h1
            className="w-load max-w-4xl font-semibold text-[clamp(2.25rem,5vw,3.6rem)]"
            style={{ letterSpacing: "-0.025em", lineHeight: 1.06, animationDelay: ".18s" }}
          >
            Plan features on a canvas,
            <br />
            not in a wall of text.
          </h1>

          <p
            className="w-load w-muted mt-6 max-w-xl text-[1.02rem] leading-relaxed"
            style={{ animationDelay: ".26s" }}
          >
            Beacon is the visual planning surface for the coding agent in your terminal. Your session proposes the plan —
            you review, annotate, and approve with a click.
          </p>

          {/* terminal */}
          <div className="w-load mt-8 w-full max-w-2xl" style={{ animationDelay: ".34s" }}>
            <div
              className="glass overflow-hidden rounded-lg text-left"
              style={{
                boxShadow:
                  "0 24px 70px -22px rgba(0,0,0,.85), inset 0 1px 0 oklch(1 0 0 /.08), 0 18px 60px -30px rgba(255,122,69,.4)",
              }}
            >
              <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: "#ff7a45", boxShadow: "0 0 7px rgba(255,122,69,.7)" }}
                />
                <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
                <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
                <span className="w-mono ml-2 text-[0.72rem] w-muted">install — bash</span>
              </div>
              <div className="flex items-center gap-4 px-5 py-5">
                <code className="w-mono w-scrollbar-none flex-1 overflow-x-auto whitespace-nowrap text-[0.95rem]">
                  <span className="w-signal select-none">$</span>
                  <span className="ml-2">{INSTALL}</span>
                  <span className="w-caret ml-1 inline-block h-4 w-2 align-middle" style={{ background: "#ff7a45" }} />
                </code>
                <button
                  onClick={copyInstall}
                  className="glass-soft w-hover grid h-10 w-10 shrink-0 place-items-center rounded-md"
                  aria-label="Copy install command"
                >
                  {copied ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff7a45" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <p className="w-mono w-muted mt-4 text-[0.8rem]">
              then run <span className="text-foreground">beacon</span> inside any repo
            </p>
          </div>
        </div>

        <a href="#start" className="w-load flex flex-col items-center gap-2 w-muted" style={{ animationDelay: ".6s" }}>
          <span className="w-mono w-eyebrow">How it works</span>
          <svg className="w-cue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </a>
      </section>

      {/* ===== onboarding ===== */}
      <section id="start" className="px-6 py-28">
        <div className="mx-auto max-w-2xl">
          <div className="w-reveal mb-16 text-center">
            <p className="w-mono w-eyebrow w-signal mb-4">Get the best out of Beacon</p>
            <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-semibold tracking-tight">
              From install to your first approved plan
            </h2>
            <div className="w-accent-line mx-auto mt-6 h-px w-40" />
          </div>

          <ol className="relative">
            <span className="w-beam absolute bottom-7 left-[1.45rem] top-5 w-px" aria-hidden />
            {STEPS.map((s, i) => (
              <li
                key={s.n}
                className={`w-reveal relative pl-[4.75rem] ${i < STEPS.length - 1 ? "pb-6" : ""}`}
              >
                <span
                  className="w-mono glass absolute left-0 top-0 grid h-[2.9rem] w-[2.9rem] place-items-center rounded-lg text-[0.82rem] font-semibold text-foreground"
                  style={badgeGlow}
                >
                  {s.n}
                </span>
                <div className="glass w-hover rounded-lg p-5">
                  <h3 className="mb-1.5 font-semibold">{s.title}</h3>
                  <p className={`w-muted text-[0.92rem] leading-relaxed ${s.cmd ? "mb-3" : ""}`}>{s.body}</p>
                  {s.cmd && (
                    <code className="w-mono glass-soft inline-block rounded-md px-3 py-1.5 text-[0.78rem]">{s.cmd}</code>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* tips */}
        <div className="mx-auto mt-28 grid max-w-5xl gap-5 md:grid-cols-3">
          {TIPS.map((t) => (
            <div key={t.label} className="w-reveal glass w-hover rounded-lg p-6">
              <p className="w-mono w-eyebrow w-signal mb-3">{t.label}</p>
              <p className="w-muted text-[0.95rem] leading-relaxed">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== footer ===== */}
      <footer className="px-6 pb-12 pt-8">
        <div className="mx-auto max-w-5xl">
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
              <a href="#" className="transition-colors hover:text-foreground">Docs</a>
              <a href="#" className="transition-colors hover:text-foreground">GitHub</a>
              <a href="#" className="transition-colors hover:text-foreground">Changelog</a>
            </nav>
            <p className="w-mono w-muted text-[0.72rem]">© 2026 Beacon</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
