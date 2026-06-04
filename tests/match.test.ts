import { describe, expect, it } from "bun:test";
import { matchFeature, similarity } from "@/lib/match";

const FEATURES = [
  { id: "1", title: "Notificações por WhatsApp" },
  { id: "2", title: "Busca semântica de precedentes" },
  { id: "3", title: "Autenticação de usuários" },
];

describe("similarity", () => {
  it("is 1 for accent/case/punctuation-insensitive equality", () => {
    expect(similarity("Notificações por WhatsApp", "notificacoes por whatsapp!")).toBe(1);
  });

  it("is high for reordered tokens", () => {
    expect(similarity("notificações WhatsApp", "WhatsApp por notificações")).toBeGreaterThan(0.7);
  });

  it("folds accents/typos via char bigrams", () => {
    expect(similarity("autenticacao de usuarios", "Autenticação de usuários")).toBe(1);
  });

  it("is low for unrelated titles", () => {
    expect(similarity("painel de faturas", "autenticação de usuários")).toBeLessThan(0.4);
  });
});

describe("matchFeature", () => {
  it("confidently flags a reordered match", () => {
    const r = matchFeature("notificações WhatsApp", FEATURES);
    expect(r.best?.id).toBe("1");
    expect(r.candidates).toHaveLength(0);
  });

  it("returns no match (best + candidates empty) for an unrelated feature", () => {
    const r = matchFeature("exportar planilha de faturas", FEATURES);
    expect(r.best).toBeNull();
    expect(r.candidates).toHaveLength(0);
  });

  it("does NOT auto-flag when candidates are ambiguous — returns them instead", () => {
    const ambiguous = [
      { id: "a", title: "User login" },
      { id: "b", title: "User logout" },
    ];
    const r = matchFeature("user log", ambiguous);
    expect(r.best).toBeNull();
    expect(r.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it("matches the exact title", () => {
    const r = matchFeature("Autenticação de usuários", FEATURES);
    expect(r.best?.id).toBe("3");
  });
});
