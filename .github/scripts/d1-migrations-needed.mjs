import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Compare with the last SUCCESSFUL deployment, not the previous push: an earlier
// failed deployment (e.g. on an exhausted D1 quota) may still have unapplied
// migrations. Skipping the check otherwise avoids D1 reads on every deploy.
let needed = true;
try {
  const runs = JSON.parse(execFileSync("gh", ["run", "list", "--workflow", "deploy.yml",
    "--branch", "main", "--status", "success", "--limit", "1", "--json", "headSha"], { encoding: "utf8" }));
  const previous = runs[0]?.headSha;
  if (previous && /^[a-f0-9]{40}$/.test(previous)) {
    const changed = git("diff", "--name-only", previous, "HEAD", "--", "migrations", "wrangler.jsonc");
    needed = changed.length > 0;
  }
} catch {
  console.log("Could not establish the deployed schema; checking D1 migrations.");
}
console.log(needed ? "Schema may have changed; checking D1 migrations." : "Schema matches the last successful deployment; no D1 query is needed.");
appendFileSync(process.env.GITHUB_OUTPUT, `needed=${needed}\n`);
