"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createNodeAction, updateNodeAction } from "@/app/actions/nodes";
import { ARCH_STATUSES, ROADMAP_STATUSES, STATUS_META } from "@/lib/constants";
import { LAYER_META, normalizeLayer, type Layer } from "@/lib/layer";

type Mode = "create" | "edit";
type NodeStatus = (typeof ROADMAP_STATUSES)[number] | (typeof ARCH_STATUSES)[number];

export interface NodeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: Mode;
  view: "ROADMAP" | "ARCHITECTURE";
  heading: string;
  nodeId?: string;
  parentId?: string | null;
  position?: { x: number; y: number };
  defaults?: {
    title?: string;
    role?: string | null;
    plain?: string | null;
    status?: string;
    cluster?: string | null;
    kind?: string;
    layer?: string | null;
  };
  /** Show the frontend/backend layer field — only workspaces with a frontend surface it. */
  hasFrontend?: boolean;
}

export function NodeFormDialog({
  open,
  onOpenChange,
  mode,
  view,
  heading,
  nodeId,
  parentId,
  position,
  defaults,
  hasFrontend = false,
}: NodeFormDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState(defaults?.title ?? "");
  const [role, setRole] = useState(defaults?.role ?? "");
  const [plain, setPlain] = useState(defaults?.plain ?? "");
  const [cluster, setCluster] = useState(defaults?.cluster ?? "");
  const [status, setStatus] = useState<NodeStatus>(
    (defaults?.status as NodeStatus) ?? (view === "ARCHITECTURE" ? "REBUILD" : "PENDING"),
  );
  const [kind, setKind] = useState<"FEATURE" | "BUG">(
    defaults?.kind === "BUG" ? "BUG" : "FEATURE",
  );
  const [layer, setLayer] = useState<Layer | "none">(normalizeLayer(defaults?.layer) ?? "none");
  const [saving, setSaving] = useState(false);

  const statuses = view === "ARCHITECTURE" ? ARCH_STATUSES : ROADMAP_STATUSES;

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const layerValue = layer === "none" ? null : layer;
      if (mode === "create") {
        await createNodeAction({
          view,
          ...(view === "ROADMAP" ? { kind } : {}),
          title: title.trim(),
          role: role.trim() || null,
          plain: plain.trim() || null,
          cluster: cluster.trim() || null,
          ...(hasFrontend ? { layer: layerValue } : {}),
          parentId: parentId ?? null,
          status,
          x: position?.x ?? 60,
          y: position?.y ?? 60,
        });
      } else if (nodeId) {
        await updateNodeAction(nodeId, {
          ...(view === "ROADMAP" ? { kind } : {}),
          title: title.trim(),
          role: role.trim() || null,
          plain: plain.trim() || null,
          cluster: cluster.trim() || null,
          ...(hasFrontend ? { layer: layerValue } : {}),
          status,
        });
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="nf-title">Title</Label>
            <Input
              id="nf-title"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nf-role">Role (one line)</Label>
            <Input id="nf-role" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nf-plain">Description</Label>
            <Textarea
              id="nf-plain"
              rows={3}
              value={plain}
              onChange={(e) => setPlain(e.target.value)}
            />
          </div>
          {view === "ROADMAP" && (
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => v != null && setKind(v as "FEATURE" | "BUG")}
              >
                <SelectTrigger>
                  <SelectValue>{(v: string) => (v === "BUG" ? "Bug" : "Feature")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FEATURE">Feature</SelectItem>
                  <SelectItem value="BUG">Bug</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {hasFrontend && (
            <div className="space-y-1.5">
              <Label>Layer</Label>
              <Select
                value={layer}
                onValueChange={(v) => v != null && setLayer(v as Layer | "none")}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) => (v === "none" ? "—" : LAYER_META[v as Layer]?.label ?? v)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(Object.keys(LAYER_META) as Layer[]).map((l) => (
                    <SelectItem key={l} value={l}>
                      {LAYER_META[l].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => v != null && setStatus(v as NodeStatus)}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => STATUS_META[v]?.label ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s]?.label ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nf-cluster">Cluster / lane</Label>
              <Input
                id="nf-cluster"
                value={cluster}
                onChange={(e) => setCluster(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
