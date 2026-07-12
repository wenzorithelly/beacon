import { describe, expect, it } from "bun:test";
import { extractArtifactFromEvent } from "@/lib/artifact-event";

// bin/artifact.ts is thin glue over extractArtifactFromEvent (event → {url,title} | null) — verify
// the mapping that decides what gets delivered, and what falls through silently (fail-open, same
// contract as bin/ask.ts / lib/hook-files.ts's filesFromToolEvent).

describe("extractArtifactFromEvent", () => {
  it("extracts the URL from a realistic PostToolUse event (string tool_response)", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/tmp/dashboard.html", description: "Bug dashboard" },
      tool_response: "Published to https://claude.ai/artifacts/abc123 successfully.",
    });
    expect(found).toEqual({
      url: "https://claude.ai/artifacts/abc123",
      title: "Bug dashboard",
      path: "/tmp/dashboard.html",
      id: "abc123",
    });
  });

  it("prefers a structured `url` field over scanning the stringified response", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/tmp/report.md" },
      tool_response: { url: "https://claude.ai/artifacts/structured", ok: true },
    });
    expect(found?.url).toBe("https://claude.ai/artifacts/structured");
  });

  it("finds a structured URL nested under a content/output wrapper (content-block-ish shape)", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/tmp/report.md" },
      tool_response: { content: [{ type: "text", text: "Done: https://claude.ai/artifacts/nested" }] },
    });
    expect(found?.url).toBe("https://claude.ai/artifacts/nested");
  });

  it("falls back to the first claude.ai URL in the stringified response when no structured field matches", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: { someWeirdField: "see https://claude.ai/artifacts/fallback for the result" },
    });
    expect(found?.url).toBe("https://claude.ai/artifacts/fallback");
  });

  it("strips trailing prose punctuation off the matched URL", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "Here you go: https://claude.ai/artifacts/xyz.",
    });
    expect(found?.url).toBe("https://claude.ai/artifacts/xyz");
  });

  it("title: description wins over file_path basename", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/tmp/foo.html", description: "Nice title" },
      tool_response: "https://claude.ai/artifacts/x",
    });
    expect(found?.title).toBe("Nice title");
  });

  it("title: derives from file_path basename (extension stripped) when description is absent", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/private/tmp/scratch/bug-dashboard.html" },
      tool_response: "https://claude.ai/artifacts/x",
    });
    expect(found?.title).toBe("bug-dashboard");
  });

  it("title: omitted entirely when neither description nor file_path is present", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "https://claude.ai/artifacts/x",
    });
    expect(found).toEqual({ url: "https://claude.ai/artifacts/x", id: "x" }); // id still parses from the URL
    expect("title" in (found as object)).toBe(false);
  });

  it("action: 'list' (a non-publish call) is a no-op even if a URL is present", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { action: "list" },
      tool_response: "https://claude.ai/artifacts/should-be-ignored",
    });
    expect(found).toBeNull();
  });

  it("no URL anywhere in the response → null", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/tmp/foo.html" },
      tool_response: "Published successfully.",
    });
    expect(found).toBeNull();
  });

  it("ignores non-Artifact tools and non-PostToolUse events", () => {
    expect(
      extractArtifactFromEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_response: "https://claude.ai/artifacts/x",
      }),
    ).toBeNull();
    expect(
      extractArtifactFromEvent({
        hook_event_name: "PreToolUse",
        tool_name: "Artifact",
        tool_response: "https://claude.ai/artifacts/x",
      }),
    ).toBeNull();
  });

  it("tolerates a missing/malformed tool_response instead of throwing", () => {
    expect(
      extractArtifactFromEvent({ hook_event_name: "PostToolUse", tool_name: "Artifact" }),
    ).toBeNull();
    expect(
      extractArtifactFromEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Artifact",
        tool_response: null,
      }),
    ).toBeNull();
  });

  it("path: extracted from tool_input.file_path", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: { file_path: "/private/tmp/scratch/bug-dashboard.html" },
      tool_response: "https://claude.ai/artifacts/abc123",
    });
    expect(found?.path).toBe("/private/tmp/scratch/bug-dashboard.html");
  });

  it("path: omitted entirely when tool_input has no file_path", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "https://claude.ai/artifacts/abc123",
    });
    expect("path" in (found as object)).toBe(false);
  });

  it("id: parsed from the /artifacts/<id> URL segment", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "https://claude.ai/artifacts/abc123",
    });
    expect(found?.id).toBe("abc123");
  });

  it("id: also matches the singular /artifact/<id> URL form", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "https://claude.ai/artifact/xyz789",
    });
    expect(found?.id).toBe("xyz789");
  });

  it("id: stops at a trailing query string or slash", () => {
    expect(
      extractArtifactFromEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Artifact",
        tool_input: {},
        tool_response: "https://claude.ai/artifacts/abc123?ref=share",
      })?.id,
    ).toBe("abc123");
    expect(
      extractArtifactFromEvent({
        hook_event_name: "PostToolUse",
        tool_name: "Artifact",
        tool_input: {},
        tool_response: "https://claude.ai/artifacts/abc123/",
      })?.id,
    ).toBe("abc123");
  });

  it("id: omitted entirely when the URL has no /artifact(s)/<id> segment", () => {
    const found = extractArtifactFromEvent({
      hook_event_name: "PostToolUse",
      tool_name: "Artifact",
      tool_input: {},
      tool_response: "https://claude.ai/no-id-here",
    });
    expect("id" in (found as object)).toBe(false);
  });
});
