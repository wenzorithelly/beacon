/** Readable kebab-case slug of a name, for @-mention resource URIs. Lowercases,
 *  strips accents, collapses non-alphanumerics to dashes, caps length. Falls back
 *  to "item" when nothing usable remains. Shared by the MCP feature/component/note
 *  resources so they slugify identically. */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "item"
  );
}
