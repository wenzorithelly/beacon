import { beforeEach, describe, expect, it } from "bun:test";
import { GET as flagsGet, POST as flagsPost } from "@/app/api/flags/route";
import { resetDb } from "./helpers";

beforeEach(resetDb);

function postReq(body: unknown): Request {
  return new Request("http://test/api/flags", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/flags", () => {
  it("returns a disabled default for an unset key", async () => {
    const res = await flagsGet(new Request("http://test/api/flags?key=scope-guard"));
    expect(await res.json()).toEqual({ enabled: false, config: {} });
  });

  it("persists enabled + config and reads it back", async () => {
    await flagsPost(postReq({ key: "scope-guard", enabled: true, config: { tolerance: 2 } }));
    const res = await flagsGet(new Request("http://test/api/flags?key=scope-guard"));
    expect(await res.json()).toEqual({ enabled: true, config: { tolerance: 2 } });
  });

  it("rejects a write with no key", async () => {
    const res = await flagsPost(postReq({ enabled: true }));
    expect(res.status).toBe(400);
  });
});
