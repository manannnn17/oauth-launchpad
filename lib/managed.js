import { readFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../data/managed-auth.json", import.meta.url), "utf8"));

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

// Looks an app up in the managed-auth catalog snapshot. Tries the full name,
// then each word, so "Gmail (Google Workspace APIs)" still matches "Gmail".
export function managedAuthStatus(name) {
  const candidates = [name, ...name.split(/[\s(),/]+/)].map(norm).filter((c) => c.length > 2);
  for (const c of candidates) {
    const managed = catalog.managed.find((m) => norm(m) === c);
    if (managed) return { status: "managed", toolkit: managed, source: catalog.source, snapshot_date: catalog.snapshot_date };
    const byo = catalog.bring_your_own.find((m) => norm(m) === c);
    if (byo) return { status: "bring_your_own", toolkit: byo, source: catalog.source, snapshot_date: catalog.snapshot_date };
  }
  return { status: "not_listed", toolkit: null, source: catalog.source, snapshot_date: catalog.snapshot_date };
}
