// Validates every guide (curated + generated) against GUIDE_SCHEMA, so the
// hand-written library and the agent's output can never drift apart.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GUIDE_SCHEMA } from "../agent/schema.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const META = new Set(["slug", "source", "reviewed_on", "query", "model", "generated_at", "duration_s", "research_log", "research_notes"]);

function validate(value, schema, path, errors) {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return errors.push(`${path}: expected object`);
    for (const key of schema.required) if (!(key in value)) errors.push(`${path}.${key}: missing`);
    for (const key of Object.keys(value)) {
      if (schema.properties[key]) validate(value[key], schema.properties[key], `${path}.${key}`, errors);
      else if (!(path === "$" && META.has(key))) errors.push(`${path}.${key}: unexpected property`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return errors.push(`${path}: expected array`);
    value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errors));
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) errors.push(`${path}: expected integer`);
  } else if (schema.type === "string") {
    if (typeof value !== "string") errors.push(`${path}: expected string`);
    else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: "${value}" not in ${schema.enum.join("|")}`);
  }
}

let failed = 0;
for (const dir of ["data/guides", "data/generated"]) {
  for (const f of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".json"))) {
    const guide = JSON.parse(readFileSync(join(ROOT, dir, f), "utf8"));
    const errors = [];
    validate(guide, GUIDE_SCHEMA, "$", errors);
    if (guide.difficulty < 1 || guide.difficulty > 5) errors.push("$.difficulty: out of range 1-5");
    if (!guide.slug) errors.push("$.slug: missing");
    console.log(`${errors.length ? "FAIL" : "ok  "} ${dir}/${f}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
    if (errors.length) failed++;
  }
}
process.exit(failed ? 1 : 0);
