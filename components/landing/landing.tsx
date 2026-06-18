"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Link2, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import { SurfacesShowcase } from "@/components/landing/board-mocks";
import { INSTALL_COMMAND } from "@/lib/release";
import "./landing.css";

const INSTALL = INSTALL_COMMAND;

/* Official brand marks (Simple Icons paths, 24x24): the Claude spark and the OpenAI
   blossom — used in the "works with" row. Rendered via currentColor/fill. */
const CLAUDE_ICON_PATH =
  "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z";
const OPENAI_ICON_PATH =
  "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z";

function BrandIcon({ d, color }: { d: string; color?: string }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill={color ?? "currentColor"} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/* ── content ───────────────────────────────────────────────────────────── */

const LOOP: { n: string; title: string; body: React.ReactNode; code: React.ReactNode }[] = [
  {
    n: "01",
    title: "Propose",
    body: (
      <>
        Ask the session in your terminal to plan a feature. It calls{" "}
        <span className="w-mono text-foreground">beacon_propose_plan</span> and blocks until you decide. No
        fire-and-forget.
      </>
    ),
    code: (
      <>
        <span className="w-signal">›</span> plan: magic-link sign-in
      </>
    ),
  },
  {
    n: "02",
    title: "Review",
    body: "The plan renders as feature nodes, tables, and endpoints. Select any passage to annotate it, mark it for deletion, or edit the boards directly.",
    code: (
      <>
        <span className="text-foreground">/plan</span> · 2 features · 1 table
      </>
    ),
  },
  {
    n: "03",
    title: "Verdict",
    body: "Approve persists the drafts. Feedback sends your notes back and the agent re-plans. Discard throws it away. Every plan is archived either way.",
    code: (
      <>
        <span style={{ color: "#6ee7b7" }}>✓ approved</span> · drafts persisted
      </>
    ),
  },
];

const RULES = [
  { label: "Reuse first", body: "Beacon blocks duplicate features. Check the map before you create." },
  {
    label: "Design data first",
    body: (
      <>
        Tables and endpoints before code. Review the schema as a draft on{" "}
        <span className="text-foreground">/db</span>.
      </>
    ),
  },
  { label: "Close every loop", body: "Register finished work so the map stays accurate next session." },
];

/* ── hero mock: a faithful replica of the /plan canvas ─────────────────────
   Fixed 620x392 design stage, scaled to fit its container so node and edge
   coordinates always line up. Pure HTML/CSS/SVG — no React Flow. */

const STAGE_W = 620;
const STAGE_H = 392;

function PlanCanvasMock() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / STAGE_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="bm-window glass">
      {/* window chrome: traffic lights + canvas tabs */}
      <div className="bm-tabs">
        <span className="h-3 w-3 rounded-full" style={{ background: "#ff7a45", boxShadow: "0 0 7px rgba(255,122,69,.7)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="bm-tab active ml-2">Roadmap</span>
        <span className="bm-tab">Database</span>
        <span className="w-mono ml-auto hidden text-[0.66rem] w-muted min-[400px]:block">/plan · review</span>
      </div>

      {/* dotted canvas; everything inside is positioned on the fixed stage */}
      {/* aspect-ratio keeps the height correct even before the ResizeObserver fires,
          so there's no layout flash on mobile where the stage scales well below 1. */}
      <div className="bm-canvas" ref={wrapRef} style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
        <div className="bm-stage" style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}>
          {/* edges */}
          <svg className="bm-edges" width={STAGE_W} height={STAGE_H} viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} aria-hidden>
            <path className="bm-edge" style={{ animationDelay: "1s" }} pathLength={1} d="M 135 111 C 135 148 165 168 165 210" />
            <path className="bm-edge" style={{ animationDelay: "1.15s" }} pathLength={1} d="M 244 78 C 300 78 320 150 374 150" />
            <path className="bm-edge bm-edge-tail" style={{ animationDelay: "1.7s" }} pathLength={1} d="M 596 205 C 596 230 576 242 558 252" />
          </svg>

          {/* feature card (draft: dashed sky, like a proposed node) */}
          <div className="bm-node bm-node-draft" style={{ left: 26, top: 38, width: 218, animationDelay: ".45s" }}>
            <div className="bm-title">Magic-link sign-in</div>
            <div className="bm-role">Email a one-time link, no passwords</div>
            <div className="bm-chiprow">
              <span className="chip chip-sky">feature</span>
              <span className="chip chip-violet">auth</span>
              <span className="chip chip-amber" style={{ marginLeft: "auto" }}>Pending</span>
            </div>
          </div>

          {/* sub-task card */}
          <div className="bm-node bm-node-draft" style={{ left: 70, top: 210, width: 190, animationDelay: ".75s" }}>
            <div className="bm-title">Issue + verify token</div>
            <div className="bm-chiprow">
              <span className="chip chip-zinc">sub-task</span>
              <span className="chip chip-amber" style={{ marginLeft: "auto" }}>Pending</span>
            </div>
          </div>

          {/* db table node (diff: new) */}
          <div className="bm-table" style={{ left: 374, top: 96, width: 222, animationDelay: ".6s" }}>
            <div className="bm-table-head">
              <span>auth_tokens</span>
              <span className="chip chip-green">new</span>
            </div>
            <div className="bm-trow">
              <KeyRound size={9} style={{ color: "#fde68a" }} />
              <span>id</span>
              <span className="t">uuid</span>
            </div>
            <div className="bm-trow">
              <span style={{ width: 9 }} />
              <span>token_hash</span>
              <span className="t">text</span>
            </div>
            <div className="bm-trow">
              <Link2 size={9} style={{ color: "#7dd3fc" }} />
              <span>user_id</span>
              <span className="t">→ users</span>
            </div>
            <div className="bm-trow">
              <span style={{ width: 9 }} />
              <span>expires_at</span>
              <span className="t">timestamp</span>
            </div>
          </div>

          {/* connection dots at edge anchors */}
          <span className="bm-dot" style={{ left: 135, top: 111, animationDelay: "1s" }} />
          <span className="bm-dot" style={{ left: 165, top: 210, animationDelay: "1.3s" }} />
          <span className="bm-dot" style={{ left: 244, top: 78, animationDelay: "1.15s" }} />
          <span className="bm-dot" style={{ left: 374, top: 150, animationDelay: "1.45s" }} />

          {/* your annotation on the proposal */}
          <span className="bm-pin" style={{ left: 596, top: 201, animationDelay: "1.55s" }}>1</span>
          <div className="bm-bubble" style={{ left: 356, top: 252, width: 226, animationDelay: "1.85s" }}>
            <div className="lab">annotation · you</div>
            <div className="txt">Expire links after 15 min, not 24 h.</div>
          </div>

          {/* verdict bar (the real one lives in plan-bar.tsx) */}
          <div className="bm-bar" style={{ animationDelay: "2.15s" }}>
            <Sparkles size={11} style={{ color: "#6ee7b7" }} />
            <span className="ready">plan ready · waiting for your verdict</span>
            <span className="bm-btn bm-btn-approve">
              <Check size={10} /> Approve
            </span>
            <span className="bm-btn bm-btn-ghost">
              <MessageSquarePlus size={10} /> Feedback
            </span>
            <span className="bm-btn bm-btn-ghost">
              <Trash2 size={10} /> Discard
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<"hero" | "qs" | null>(null);

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

  function copyInstall(which: "hero" | "qs") {
    navigator.clipboard?.writeText(INSTALL);
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  const copyBtn = (which: "hero" | "qs") => (
    <button
      onClick={() => copyInstall(which)}
      className="glass-soft w-hover grid h-8 w-8 shrink-0 place-items-center rounded-md"
      aria-label="Copy install command"
    >
      {copied === which ? <Check size={13} style={{ color: "#ff7a45" }} /> : <Copy size={13} className="w-muted" />}
    </button>
  );

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
            <nav className="flex items-center gap-6 text-sm w-muted">
              <a href="#how" className="transition-colors hover:text-foreground">
                The loop
              </a>
              <a href="#quickstart" className="hidden transition-colors hover:text-foreground sm:block">
                Quickstart
              </a>
              <a href="/docs" className="transition-colors hover:text-foreground">
                Docs
              </a>
            </nav>
          </div>
        </div>
      </header>

      <span id="top" />

      {/* ===== hero ===== */}
      <section className="px-6 pb-16 pt-20 md:pt-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <div className="min-w-0">
            <div
              className="w-load glass-soft mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
              style={{ animationDelay: ".12s" }}
            >
              <span
                className="w-live h-1.5 w-1.5 rounded-full"
                style={{ background: "#ff7a45", boxShadow: "0 0 8px #ff7a45" }}
              />
              <span className="w-mono w-eyebrow w-muted">See your codebase · steer your agent</span>
            </div>

            <h1
              className="w-load font-semibold text-[clamp(2.2rem,4.6vw,3.4rem)]"
              style={{ letterSpacing: "-0.025em", lineHeight: 1.06, animationDelay: ".18s" }}
            >
              Give your coding agent <span className="w-signal">eyes</span> and hands.
            </h1>

            <p className="w-load w-muted mt-5 max-w-md text-[1.02rem] leading-relaxed" style={{ animationDelay: ".26s" }}>
              The session in your terminal is the brain. Beacon is where its plans become visible: features, tables,
              and endpoints on a canvas you annotate, edit, and approve with one click.
            </p>

            <div className="w-load mt-8" style={{ animationDelay: ".34s" }}>
              <div className="glass flex max-w-lg items-center gap-3 rounded-lg py-2.5 pl-4 pr-2">
                <code className="w-mono w-scrollbar-none min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[0.85rem]">
                  <span className="w-signal select-none">$</span>
                  <span className="ml-2">{INSTALL}</span>
                  <span className="w-caret ml-1 inline-block h-3.5 w-1.5 align-middle" style={{ background: "#ff7a45" }} />
                </code>
                {copyBtn("hero")}
              </div>
              <p className="w-mono w-muted mt-3 text-[0.78rem]">
                then run <span className="text-foreground">beacon</span> inside any repo
              </p>
            </div>

            {/* integrations */}
            <div className="w-load mt-9 flex flex-wrap items-center gap-x-5 gap-y-2" style={{ animationDelay: ".42s" }}>
              <span className="w-mono w-eyebrow w-muted">Works with</span>
              <span className="flex items-center gap-2 text-sm text-foreground/90">
                <BrandIcon d={CLAUDE_ICON_PATH} color="#D97757" /> Claude Code
              </span>
              <span className="flex items-center gap-2 text-sm text-foreground/90">
                <BrandIcon d={OPENAI_ICON_PATH} /> Codex
              </span>
            </div>
          </div>

          <div className="w-load min-w-0" style={{ animationDelay: ".3s" }}>
            <PlanCanvasMock />
          </div>
        </div>

        <a
          href="#how"
          className="w-load mx-auto mt-12 flex w-fit flex-col items-center gap-2 w-muted transition-colors hover:text-foreground md:mt-20"
          style={{ animationDelay: ".6s" }}
        >
          <span className="w-mono w-eyebrow">The loop</span>
          <svg className="w-cue" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </a>
      </section>

      {/* ===== the loop ===== */}
      <section id="how" className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="w-reveal mb-14 text-center">
            <p className="w-mono w-eyebrow w-signal mb-4">The loop</p>
            <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-semibold tracking-tight">
              Propose. Review. Verdict. Repeat.
            </h2>
            <div className="w-accent-line mx-auto mt-6 h-px w-40" />
          </div>

          <div className="grid gap-10 md:grid-cols-3">
            {LOOP.map((s) => (
              <div key={s.n} className="loop-card w-reveal glass w-hover rounded-lg p-6">
                <p className="w-mono w-eyebrow w-signal mb-3">{s.n}</p>
                <h3 className="mb-2 font-semibold">{s.title}</h3>
                <p className="w-muted mb-4 text-[0.92rem] leading-relaxed">{s.body}</p>
                <code className="w-mono glass-soft inline-block rounded-md px-3 py-1.5 text-[0.74rem]">{s.code}</code>
              </div>
            ))}
          </div>

          <p className="w-reveal w-mono w-muted mt-10 text-center text-[0.78rem]">
            feedback sends the agent back to <span className="w-signal">01</span> · approval persists the drafts
          </p>
        </div>
      </section>

      {/* ===== surfaces ===== */}
      <section className="px-6 py-16 md:py-20">
        <div className="mx-auto max-w-[88rem]">
          <div className="w-reveal mb-12 text-center">
            <p className="w-mono w-eyebrow w-signal mb-4">The surfaces</p>
            <h2 className="text-[clamp(1.6rem,3.4vw,2.25rem)] font-semibold tracking-tight">
              Everything the agent plans, drawn
            </h2>
          </div>

          <div className="w-reveal">
            <SurfacesShowcase />
          </div>
        </div>
      </section>

      {/* ===== quickstart ===== */}
      <section id="quickstart" className="px-6 py-16 md:py-24">
        <div className="mx-auto max-w-3xl">
          <div className="w-reveal mb-12 text-center">
            <p className="w-mono w-eyebrow w-signal mb-4">Quickstart</p>
            <h2 className="text-[clamp(1.6rem,3.4vw,2.25rem)] font-semibold tracking-tight">
              Five lines to your first approved plan
            </h2>
          </div>

          <div className="w-reveal glass overflow-hidden rounded-lg">
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <span className="h-3 w-3 rounded-full" style={{ background: "#ff7a45", boxShadow: "0 0 7px rgba(255,122,69,.7)" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
              <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
              <span className="w-mono ml-2 text-[0.72rem] w-muted">your-repo — terminal</span>
            </div>
            <div className="px-5 py-4">
              <div className="ql">
                <code className="cmd w-scrollbar-none">
                  <span className="w-signal select-none">$ </span>
                  {INSTALL}
                </code>
                <span className="note">01 · one binary, nothing to configure</span>
                {copyBtn("qs")}
              </div>
              <div className="ql">
                <code className="cmd">
                  <span className="w-signal select-none">$ </span>cd your-repo && beacon
                </code>
                <span className="note">02 · registers the repo, opens the panel</span>
              </div>
              <div className="ql">
                <code className="cmd">
                  <span className="w-signal select-none">› </span>/beacon-init
                </code>
                <span className="note">03 · maps architecture, schema, roadmap</span>
              </div>
              <div className="ql">
                <code className="cmd">
                  <span className="w-signal select-none">› </span>plan: magic-link sign-in
                </code>
                <span className="note">04 · the plan streams onto /plan</span>
              </div>
              <div className="ql">
                <code className="cmd">
                  <span className="select-none" style={{ color: "#6ee7b7" }}>
                    ✓{" "}
                  </span>
                  approve · feedback · discard
                </code>
                <span className="note">05 · the verdict returns to your session</span>
              </div>
            </div>
          </div>
        </div>

        {/* working rules */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="w-reveal glass grid overflow-hidden rounded-lg md:grid-cols-3 md:divide-x md:divide-y-0 divide-y" style={{ borderColor: "var(--border)" }}>
            {RULES.map((r) => (
              <div key={r.label} className="p-6" style={{ borderColor: "oklch(1 0 0 / 0.07)" }}>
                <p className="w-mono w-eyebrow w-signal mb-2.5">{r.label}</p>
                <p className="w-muted text-[0.9rem] leading-relaxed">{r.body}</p>
              </div>
            ))}
          </div>
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
              <a href="/docs" className="transition-colors hover:text-foreground">Docs</a>
              <a href="#" className="transition-colors hover:text-foreground">Changelog</a>
              <a
                href="https://github.com/wenzorithelly/beacon-plugin/blob/main/LICENSE"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-foreground"
              >
                MIT License
              </a>
            </nav>
            <p className="w-mono w-muted text-[0.72rem]">
              Created by{" "}
              <a
                href="https://www.instagram.com/wenzorithelly/"
                target="_blank"
                rel="noreferrer"
                className="w-signal inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
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
