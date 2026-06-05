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

// Danger zone: wipes all project data so the panel starts from zero.
export function DangerCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-red-500/30">
      <CardHeader>
        <CardTitle className="text-base text-red-400">Zona de perigo</CardTitle>
        <CardDescription>
          Apaga todos os dados do projeto — mapa, bugs, banco, rascunhos, integrações e o
          resumo gerado — deixando o painel do zero. Suas preferências (provedor e editor)
          são mantidas. Não dá para desfazer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <AlertDialog>
          <AlertDialogTrigger
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            disabled={busy}
          >
            <Trash2 className="size-4" />
            {busy ? "Apagando…" : "Apagar todos os dados"}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Apagar todos os dados?</AlertDialogTitle>
              <AlertDialogDescription>
                Isto remove permanentemente o mapa, bugs, o banco, rascunhos, integrações e o
                resumo do projeto. Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={reset}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                Sim, apagar tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {done && <span className="text-xs text-red-300">✓ dados apagados</span>}
      </CardContent>
    </Card>
  );
}
