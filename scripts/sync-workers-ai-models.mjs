import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const wranglerEntry = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const output = execFileSync(process.execPath, [wranglerEntry, "ai", "models", "list", "--task", "Text Generation", "--hide-experimental", "--json"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const catalog = JSON.parse(output);
const models = [...new Set(catalog.map((item) => item?.name).filter((name) => typeof name === "string" && name.startsWith("@cf/")))].sort();

if (!models.length) throw new Error("Workers AI model sync returned an empty catalog");
writeFileSync(join(process.cwd(), "public", "workers-ai-models.json"), JSON.stringify({ generatedAt: new Date().toISOString(), models }, null, 2) + "\n");
console.log(`Synced ${models.length} Workers AI text-generation models.`);
