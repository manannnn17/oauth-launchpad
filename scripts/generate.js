// CLI for the live agent: `npm run generate -- "Zoom"`.
// Useful as a smoke test of your API key and to pre-generate guides.
import { writeFileSync } from "node:fs";
import { generateGuide, describeError } from "../agent/index.js";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: npm run generate -- "<app name or website>"');
  process.exit(1);
}

const slugify = (s) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

try {
  const { guide, meta } = await generateGuide(query, (e) => {
    const text = { phase: e.message, search: `search  ${e.query}`, fetch: `read    ${e.url}`, probe: `probe   ${e.url}`, result: `  -> ${e.message}` }[e.type];
    if (text) console.log(text);
  });
  const slug = slugify(guide.name || query);
  const file = new URL(`../data/generated/${slug}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ slug, source: "agent", ...guide, ...meta }, null, 2));
  console.log(`\nSaved ${slug} (${guide.access_tier}, difficulty ${guide.difficulty}/5) in ${meta.duration_s}s -> /g/${slug}`);
} catch (err) {
  console.error(`Generation failed: ${describeError(err)}`);
  process.exit(1);
}
