"use client";

/* Demo-only canvas for the launch video. Unlike the hero PlanCanvasMock (which combines
   surfaces), this mirrors the REAL /plan review: tabbed Roadmap (feature cards) vs Database
   (tables) — only one view at a time — plus a verdict bar. Bug + annotation are added by the
   capture script to mimic the real flows (hover row → comment icon → click → node → type). */

import { useEffect, useRef } from "react";
import { KeyRound, Link2, MessageSquarePlus, Sparkles, Check, Trash2 } from "lucide-react";
import { BeaconMark } from "@/components/beacon-mark";
import "./landing.css";

function Row({ icon, name, type, row }: { icon?: "key" | "link"; name: string; type: string; row?: string }) {
  return (
    <div className="bm-trow" data-row={row} style={{ position: "relative" }}>
      {icon === "key" ? <KeyRound size={9} style={{ color: "#fde68a" }} /> : icon === "link" ? <Link2 size={9} style={{ color: "#7dd3fc" }} /> : <span style={{ width: 9 }} />}
      <span>{name}</span>
      <span className="t">{type}</span>
      {/* hover-revealed comment affordance (mirrors db-table-node CommentDot) */}
      {row && (
        <button
          className="demo-cdot"
          data-cdot={row}
          style={{ position: "absolute", right: -11, top: "50%", transform: "translateY(-50%)", opacity: 0, display: "grid", placeItems: "center", width: 18, height: 18, borderRadius: 9999, border: "1px solid rgba(255,255,255,.15)", background: "#242428", color: "var(--muted-foreground)", boxShadow: "0 4px 10px -3px rgba(0,0,0,.6)", transition: "opacity .18s, border-color .18s, color .18s", zIndex: 30 }}
        >
          <MessageSquarePlus size={10} />
        </button>
      )}
    </div>
  );
}

export function DemoCanvas() {
  const magicRef = useRef<HTMLDivElement>(null);
  const verifyRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  // Connect the roadmap edge using LAYOUT positions (offsetTop/Height — transform-independent),
  // so the bm-in entrance transform can never leave the line floating below the card.
  useEffect(() => {
    const m = magicRef.current, v = verifyRef.current, e = edgeRef.current;
    if (!m || !v || !e) return;
    const ax = m.offsetLeft + m.offsetWidth * 0.42, ay = m.offsetTop + m.offsetHeight;
    const bx = v.offsetLeft + v.offsetWidth * 0.45, by = v.offsetTop;
    e.setAttribute("d", `M ${ax} ${ay} C ${ax} ${ay + 26} ${bx} ${by - 26} ${bx} ${by}`);
  }, []);
  return (
    <div className="bm-window glass" style={{ width: 760 }}>
      <div className="bm-tabs">
        <span className="h-3 w-3 rounded-full" style={{ background: "#ff7a45", boxShadow: "0 0 7px rgba(255,122,69,.7)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="bm-tab active ml-2" data-tab="Roadmap">Roadmap</span>
        <span className="bm-tab" data-tab="Database">Database</span>
        <span className="w-mono ml-auto text-[0.68rem] w-muted">/plan · review</span>
      </div>

      <div className="bm-canvas" style={{ position: "relative", height: 432, overflow: "hidden" }}>
        {/* ── Roadmap view ── */}
        <div data-view="Roadmap" style={{ position: "absolute", inset: 0 }}>
          <svg className="bm-edges" width={760} height={432} viewBox="0 0 760 432" aria-hidden>
            <path ref={edgeRef} className="bm-edge" style={{ animationDelay: "1s" }} pathLength={1} d="M 150 130 C 150 168 180 178 180 214" />
          </svg>
          <div ref={magicRef} className="bm-node bm-node-draft" id="d-magic" style={{ left: 44, top: 48, width: 248, animationDelay: ".45s" }}>
            <div className="bm-title">Magic-link sign-in</div>
            <div className="bm-role">Email a one-time link, no passwords</div>
            <div className="bm-chiprow">
              <span className="chip chip-sky">feature</span>
              <span className="chip chip-violet">auth</span>
              <span className="chip chip-amber" style={{ marginLeft: "auto" }}>Pending</span>
            </div>
          </div>
          <div ref={verifyRef} className="bm-node bm-node-draft" id="d-verify" style={{ left: 90, top: 214, width: 214, animationDelay: ".75s" }}>
            <div className="bm-title">Issue + verify token</div>
            <div className="bm-chiprow">
              <span className="chip chip-zinc">sub-task</span>
              <span className="chip chip-amber" style={{ marginLeft: "auto" }}>Pending</span>
            </div>
          </div>
          {/* script injects the bug card here */}
          <div id="d-roadmap-extra" />
        </div>

        {/* ── Database view (hidden until tab switch) ── */}
        <div data-view="Database" style={{ position: "absolute", inset: 0, display: "none" }}>
          <div className="bm-table" id="d-table" style={{ left: 250, top: 70, width: 268, opacity: 1, overflow: "visible" }}>
            <div className="bm-table-head" style={{ borderTopLeftRadius: "0.4rem", borderTopRightRadius: "0.4rem" }}>
              <span>auth_tokens</span>
              <span className="chip chip-green">new</span>
            </div>
            <Row icon="key" name="id" type="uuid" />
            <Row name="token_hash" type="text" />
            <Row icon="link" name="user_id" type="→ users" row="user_id" />
            <Row name="expires_at" type="timestamp" row="expires_at" />
          </div>
          {/* script injects the annotation pin + card here */}
          <div id="d-db-extra" />
        </div>
      </div>

      {/* ── verdict bar (always visible) ── */}
      <div
        id="d-bar"
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 14px", borderTop: "1px solid var(--border)", background: "color-mix(in oklab, var(--card) 92%, transparent)" }}
      >
        <Sparkles size={12} style={{ color: "#6ee7b7" }} />
        <span id="d-ready" className="w-mono" style={{ fontSize: "0.7rem", color: "rgba(110,231,183,0.85)" }}>plan ready · waiting for your verdict</span>
        <span className="bm-btn bm-btn-approve" style={{ marginLeft: "auto" }}>
          <Check size={11} /> Approve
        </span>
        <span className="bm-btn bm-btn-ghost" id="d-feedback">
          <MessageSquarePlus size={11} /> Feedback
        </span>
        <span className="bm-btn bm-btn-ghost">
          <Trash2 size={11} /> Discard
        </span>
      </div>

      {/* ── Beacon outro (hidden; script fades it in to end the video) ── */}
      <div
        id="d-outro"
        style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "radial-gradient(900px 520px at 50% 45%, #1a1411, #0b0908 70%)", opacity: 0, pointerEvents: "none", zIndex: 200 }}
      >
        <BeaconMark size={64} className="text-foreground" />
        <div style={{ fontSize: "2rem", fontWeight: 600, letterSpacing: "-0.02em" }}>Beacon</div>
        <div className="w-mono" style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>see your codebase · steer your agent</div>
      </div>
    </div>
  );
}
