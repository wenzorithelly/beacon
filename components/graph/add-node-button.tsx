"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { NodeFormDialog } from "@/components/graph/node-form-dialog";

export function AddNodeButton({ view }: { view: "ROADMAP" | "ARCHITECTURE" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
        + Nó
      </Button>
      {open && (
        <NodeFormDialog
          open
          onOpenChange={setOpen}
          mode="create"
          view={view}
          heading="Novo nó"
          position={{ x: 60, y: 60 }}
        />
      )}
    </>
  );
}
