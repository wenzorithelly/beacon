import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// The "How to use Beacon" guide — a plain-English reference for what Beacon adds to a Claude
// Code session: the slash commands you type, the MCP tools the agent picks up on its own, and
// the hooks that run automatically. Lives on its own page (reached from Settings) instead of
// crowding the settings cards. Server component — no client JS.

const SKILLS: { name: string; when: string; what: string }[] = [
  {
    name: "/beacon-init",
    when: "First time you point Beacon at a repo.",
    what: "The agent reads the codebase and fills Beacon's map: the main components, the rough roadmap themes, the database schema, and the endpoints. Run this once per repo to bootstrap the picture.",
  },
  {
    name: "/beacon-refresh",
    when: "Every few weeks, or after a big set of changes.",
    what: "The agent re-surveys the repo and updates what /beacon-init already produced — adds new components, drops removed ones, picks up new tables and routes. Anything you added by hand on the canvas survives the refresh.",
  },
];

const MCP_TOOLS: { name: string; what: string }[] = [
  {
    name: "beacon_context_for_feature",
    what: "Before touching code for a feature, the agent uses this to pull the files attached to it plus their imports, the endpoints in that domain, the tables those endpoints touch, and the surrounding components — one round-trip instead of a blind Glob/Grep scan.",
  },
  {
    name: "beacon_blast_radius",
    what: "Mid-feature, the agent uses this on a file it's about to edit to see what imports it and what it imports — so it can judge whether the change is safe.",
  },
  {
    name: "beacon_propose_plan",
    what: "When the agent has a feature plan (tables + relations + endpoints), this opens the plan on Beacon's /plan page and BLOCKS the session. You review, annotate, then Approve / Discard / Submit feedback — and the agent only continues after you've decided.",
  },
  {
    name: "beacon_describe_feature",
    what: "When a feature is done, the agent calls this with a short markdown summary and the files it touched. That keeps the next session's beacon_context_for_feature accurate.",
  },
  {
    name: "beacon_entities",
    what: "Generic readout of what's currently mapped — features, architecture, tables, endpoints. The agent uses it when it just needs raw planning data.",
  },
  {
    name: "beacon_map",
    what: "Quick list of features on the roadmap. The agent calls this near the start of work to see what's already planned.",
  },
  {
    name: "beacon_start_feature",
    what: "Optional: the agent flags which feature it's working on. The /map view shows it as in-progress while edits happen.",
  },
  {
    name: "beacon_add_subtasks",
    what: "Breaks a feature into smaller child nodes on the /map view. Useful when one feature naturally splits into several pieces.",
  },
  {
    name: "beacon_init_persist",
    what: "The write side of /beacon-init and /beacon-refresh — you never call it directly; the skills do.",
  },
];

const HOOKS: { trigger: string; what: string }[] = [
  {
    trigger: "Plan mode (ExitPlanMode)",
    what: "When the agent shows you a plan, Beacon intercepts it and renders the markdown on /plan with a native annotation panel. Select text and type → it becomes a comment. Approve / Discard / Submit feedback flows back to the session as the agent's next instruction. No prompt walls of text in the terminal.",
  },
  {
    trigger: "File edits (PostToolUse)",
    what: "Every Edit/Write/MultiEdit the agent runs is reported to Beacon, and the file is automatically attached to whichever feature the session is currently working on. The /map view gradually fills in with the real files behind each feature, without you tagging anything.",
  },
  {
    trigger: "Inline code-graph watcher",
    what: "While the panel is open, a background watcher rebuilds the /map → Files view as you save code. No clicking required — it just stays current with the repo it's watching.",
  },
];

const sectionTitle = "mt-10 border-b border-white/10 pb-1.5 text-lg font-semibold text-foreground";
const sectionIntro = "mt-2 text-sm text-muted-foreground";

export default function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-20">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Settings
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">How to use Beacon</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        What you can ask the agent to do, what it does on its own, and what happens automatically
        while you work.
      </p>

      <section>
        <h2 className={sectionTitle}>Skills — type these in your terminal session</h2>
        <p className={sectionIntro}>
          Slash commands that tell the agent to do something Beacon-shaped. You type them.
        </p>
        <ul className="mt-4 space-y-4">
          {SKILLS.map((s) => (
            <li key={s.name}>
              <div className="font-mono text-sm text-foreground">{s.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">When:</span> {s.when}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">{s.what}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={sectionTitle}>MCP tools — the agent calls these on its own</h2>
        <p className={sectionIntro}>
          You don&apos;t run these. The agent reaches for them whenever they fit the task — knowing
          they exist helps you understand what the agent is doing.
        </p>
        <ul className="mt-4 space-y-4">
          {MCP_TOOLS.map((t) => (
            <li key={t.name}>
              <div className="font-mono text-sm text-foreground">{t.name}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{t.what}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={sectionTitle}>Automatic hooks — these run without you</h2>
        <p className={sectionIntro}>
          Wired into Claude Code globally. You don&apos;t trigger them; they react to what the
          session is already doing.
        </p>
        <ul className="mt-4 space-y-4">
          {HOOKS.map((h) => (
            <li key={h.trigger}>
              <div className="text-sm font-medium text-foreground">{h.trigger}</div>
              <div className="mt-0.5 text-sm text-muted-foreground">{h.what}</div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={sectionTitle}>Typical loop, end to end</h2>
        <ol className="mt-4 ml-4 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            First time in a repo: run <span className="font-mono text-foreground">beacon</span> in
            the terminal, then <span className="font-mono text-foreground">/beacon-init</span> in
            your session.
          </li>
          <li>
            Ask the agent to plan a feature. It calls{" "}
            <span className="font-mono text-foreground">beacon_propose_plan</span>; you review on
            /plan; you Approve.
          </li>
          <li>
            The agent implements. File edits land on the canvas automatically via the PostToolUse
            hook.
          </li>
          <li>
            When done, the agent calls{" "}
            <span className="font-mono text-foreground">beacon_describe_feature</span> so the next
            session has accurate context.
          </li>
          <li>
            Every few weeks, run <span className="font-mono text-foreground">/beacon-refresh</span>{" "}
            to keep the architecture map honest as the code grows.
          </li>
        </ol>
      </section>
    </div>
  );
}
