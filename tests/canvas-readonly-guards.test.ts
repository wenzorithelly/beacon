import { describe, expect, it } from "bun:test";
import { canvasDragPersistTarget } from "@/lib/canvas-readonly";

// The read-only canvas contract: a shared/archived board NEVER writes back. canvasDragPersistTarget
// is what DbMapClient.onNodeDragStop consults — "none" means no /api call (those routes don't even
// exist on the public deploy where shared boards render).
describe("canvasDragPersistTarget", () => {
  it("persists nothing when readOnly, regardless of node kind", () => {
    for (const nodeId of ["table-1", "anno-1", "endpoint-9"])
      expect(
        canvasDragPersistTarget({ readOnly: true, nodeId, isDraft: false, boardMode: true }),
      ).toBe("none");
    // a draft node, read-only → still none
    expect(
      canvasDragPersistTarget({ readOnly: true, nodeId: "t1", isDraft: true, boardMode: false }),
    ).toBe("none");
  });

  it("routes a real table drag to the persist endpoint when editable", () => {
    expect(
      canvasDragPersistTarget({ readOnly: false, nodeId: "table-1", isDraft: false, boardMode: false }),
    ).toBe("real");
  });

  it("keeps a draft drag local (no network)", () => {
    expect(
      canvasDragPersistTarget({ readOnly: false, nodeId: "t1", isDraft: true, boardMode: false }),
    ).toBe("draft");
  });

  it("only patches an annotation drag when board annotations are on", () => {
    expect(
      canvasDragPersistTarget({ readOnly: false, nodeId: "anno-1", isDraft: false, boardMode: true }),
    ).toBe("annotation");
    expect(
      canvasDragPersistTarget({ readOnly: false, nodeId: "anno-1", isDraft: false, boardMode: false }),
    ).toBe("none");
  });
});
