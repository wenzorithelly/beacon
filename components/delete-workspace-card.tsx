"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Danger zone: deletes the CURRENT workspace — unregisters it and erases all of its
// Beacon data on disk. The repository's own files are never touched.
export function DeleteWorkspaceCard({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch("/api/workspace", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        const { fallbackId } = await res.json();
        // Pin the very next request to the fallback up front, same trick as the
        // switcher's pick() — the route's Set-Cookie also landed, this just beats
        // any in-flight fetch racing the refresh.
        document.cookie = fallbackId
          ? `beacon_ws=${fallbackId}; Path=/; Max-Age=31536000; SameSite=Lax`
          : "beacon_ws=; Path=/; Max-Age=0; SameSite=Lax";
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/30">
      <CardHeader>
        <CardTitle className="text-base text-red-400">Delete this workspace</CardTitle>
        <CardDescription>
          Removes <span className="font-medium text-foreground">{name}</span>{" "}
          from Beacon and erases all of its Beacon data — the map, the database, drafts and the code graph. The
          repository&apos;s files on disk are untouched. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            disabled={busy}
          >
            <Trash2 className="size-4" />
            {busy ? "Deleting…" : "Delete workspace"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete workspace &ldquo;{name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the workspace from Beacon and erases its data — the map,
                the database, drafts and the code graph. Your code is not affected; only
                Beacon&apos;s data for this repository is erased. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={remove}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                Yes, delete workspace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
