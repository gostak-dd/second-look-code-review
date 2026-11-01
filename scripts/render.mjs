#!/usr/bin/env node
// Renders a PR review guide (guide.json) plus the real git diff into one
// self-contained, interactive HTML page. Node 18+, no dependencies.
//
//   node render.mjs --guide .second-look/guide.json [--base main] [--head <ref>]
//                   [--previous .second-look/last-review.json] [--working-tree]
//                   [--out .second-look/review.html] [--open]
//   node render.mjs --status --previous .second-look/last-review.json [--base main]
//     prints which files changed since the last review, as JSON, and exits.

import { execFileSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_LINES_PER_FILE = 3000;

// ---------- args ----------
function parseArgs(argv) {
  const out = { open: false, workingTree: false, status: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`Missing value for ${a}`);
      return v;
    };
    if (a === "--guide") out.guide = next();
    else if (a === "--base") out.base = next();
    else if (a === "--head") out.head = next();
    else if (a === "--out") out.out = next();
    else if (a === "--previous") out.previous = next();
    else if (a === "--status") out.status = true;
    else if (a === "--open") out.open = true;
    else if (a === "--working-tree") out.workingTree = true;
    else if (a === "-h" || a === "--help") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n"));
      process.exit(0);
    } else die(`Unknown argument: ${a}`);
  }
  if (!out.guide && !out.status) die("--guide is required");
  if (out.status && !out.previous) die("--status needs --previous");
  return out;
}

function die(msg) {
  console.error(`render: ${msg}`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    die(`git ${args.join(" ")} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

function tryGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function defaultBase() {
  const origin = tryGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (origin) return origin.replace(/^origin\//, "");
  for (const b of ["main", "master"]) if (tryGit(["rev-parse", "--verify", "--quiet", b])) return b;
  die("Could not find a base branch. Pass --base.");
}

// ---------- diff parsing ----------
function stripPrefix(p) {
  if (p === "/dev/null") return null;
  if (p.startsWith('"') && p.endsWith('"')) p = JSON.parse(p);
  return p.replace(/^[ab]\//, "");
}

export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = raw.match(/^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/);
      file = {
        oldPath: m ? m[1] : null,
        path: m ? m[2] : raw.slice(11),
        status: "modified",
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        truncated: false,
        shown: 0,
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("rename from ")) { file.oldPath = raw.slice(12); file.status = "renamed"; }
      else if (raw.startsWith("rename to ")) file.path = raw.slice(10);
      else if (raw.startsWith("Binary files ")) file.binary = true;
      else if (raw.startsWith("--- ")) { const p = stripPrefix(raw.slice(4)); if (p) file.oldPath = p; }
      else if (raw.startsWith("+++ ")) {
        const p = stripPrefix(raw.slice(4));
        if (p) file.path = p;
        else file.path = file.oldPath; // deleted file
      }
    }

    const hm = raw.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hm) {
      oldNo = Number(hm[1]);
      newNo = Number(hm[3]);
      hunk = { header: raw, context: hm[5].trim(), lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const room = () => (file.shown < MAX_LINES_PER_FILE ? (file.shown++, true) : ((file.truncated = true), false));
    const t = raw[0];
    if (t === "+") {
      file.additions++;
      if (room()) hunk.lines.push({ t: "add", n: newNo, s: raw.slice(1) });
      newNo++;
    } else if (t === "-") {
      file.deletions++;
      if (room()) hunk.lines.push({ t: "del", o: oldNo, s: raw.slice(1) });
      oldNo++;
    } else if (t === " ") {
      if (room()) hunk.lines.push({ t: "ctx", o: oldNo, n: newNo, s: raw.slice(1) });
      oldNo++;
      newNo++;
    }
    // "\ No newline at end of file" and blank trailing lines are ignored.
  }
  return files;
}

// ---------- validation ----------
function validate(guide, files) {
  const warnings = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Map();

  for (const key of ["title", "intent", "chapters", "findings"]) {
    if (guide[key] === undefined) die(`guide.json is missing "${key}"`);
  }

  for (const ch of guide.chapters) {
    ch.files = (ch.files || []).filter((p) => {
      if (!byPath.has(p)) {
        warnings.push(`Chapter "${ch.title}" lists ${p}, which is not in the diff. Dropped.`);
        return false;
      }
      if (seen.has(p)) {
        warnings.push(`${p} is in both "${seen.get(p)}" and "${ch.title}". Kept in the first.`);
        return false;
      }
      seen.set(p, ch.title);
      return true;
    });
  }
  guide.chapters = guide.chapters.filter((ch) => ch.files.length > 0);

  const missing = files.map((f) => f.path).filter((p) => !seen.has(p));
  if (missing.length) {
    warnings.push(`${missing.length} changed file(s) not in any chapter: ${missing.join(", ")}`);
    guide.chapters.push({
      id: "unassigned",
      title: "Not in any chapter",
      summary: "The guide didn't place these files. Review them on their own.",
      risk: "medium",
      risk_reason: "Not analysed by the guide",
      files: missing,
      unassigned: true,
    });
  }

  for (const f of guide.findings) {
    const file = byPath.get(f.file);
    if (!file) {
      warnings.push(`Finding ${f.id} points at ${f.file}, which is not in the diff. Dropped.`);
      f.drop = true;
      continue;
    }
    const onLine = file.hunks.some((h) => h.lines.some((l) => l.n === f.line));
    if (!onLine) {
      warnings.push(`Finding ${f.id} is on ${f.file}:${f.line}, which is not a visible line in the diff. Pinned to the top of the file.`);
      f.pinned = true;
    }
  }
  guide.findings = guide.findings.filter((f) => !f.drop);

  for (const ch of guide.chapters) {
    ch.tour = (ch.tour || []).filter((stop, i) => {
      const file = byPath.get(stop.file);
      if (!file) {
        warnings.push(`Tour stop ${i + 1} in "${ch.title}" points at ${stop.file}, which is not in the diff. Dropped.`);
        return false;
      }
      if (!file.hunks.some((h) => h.lines.some((l) => l.n === stop.line))) {
        warnings.push(`Tour stop ${i + 1} in "${ch.title}" is on ${stop.file}:${stop.line}, which is not a visible line in the diff. It will open the file without highlighting.`);
        stop.offDiff = true;
      }
      return true;
    });
    ch.checks = Array.isArray(ch.checks) ? ch.checks : [];
  }
  return warnings;
}

// ---------- open ----------
function openFile(path) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", path] : [path];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.log(`Open this file in your browser: ${path}`);
  }
}

// ---------- collecting the changes ----------
// Default: everything on this branch since it left the base, INCLUDING
// uncommitted and untracked changes. Fixes the agent makes but hasn't committed
// still show up in the re-review.
function collect(args) {
  if (args.workingTree) {
    return { base: "HEAD", label: "working tree", files: withUntracked(parseDiff(git([...DIFF, "HEAD"]))), live: true, range: ["HEAD"] };
  }
  const base = args.base || defaultBase();
  if (args.head) {
    return { base, label: args.head, files: parseDiff(git([...DIFF, `${base}...${args.head}`])), live: false, range: [`${base}...${args.head}`] };
  }
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  return { base, label: tryGit(["rev-parse", "--abbrev-ref", "HEAD"]) || "HEAD", files: withUntracked(parseDiff(git([...DIFF, mergeBase]))), live: true, range: [mergeBase] };
}
const DIFF = ["diff", "--no-color", "--no-ext-diff", "-M", "-U3"];

function withUntracked(files) {
  const untracked = tryGit(["ls-files", "--others", "--exclude-standard"]).split("\n").filter((p) => p && !p.startsWith(".second-look/"));
  for (const p of untracked) {
    let out = "";
    try {
      out = execFileSync("git", ["diff", "--no-index", "--no-color", "-U3", "/dev/null", p], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      out = e.stdout || ""; // exit code 1 just means "files differ"
    }
    const [f] = parseDiff(out);
    if (f) { f.path = p; f.status = "added"; f.untracked = true; files.push(f); }
  }
  return files;
}

// Files whose only changes are whitespace (reformatting, indentation).
function markWhitespaceOnly(files, range) {
  const out = tryGit(["diff", "-w", "--numstat", "--no-renames", ...range]);
  const counts = new Map();
  for (const line of out.split("\n")) {
    const [a, d, path] = line.split("\t");
    if (path) counts.set(path, Number(a) + Number(d));
  }
  for (const f of files) {
    if (f.untracked || f.binary || f.status !== "modified") continue;
    if (f.additions + f.deletions > 0 && (counts.get(f.path) ?? 0) === 0) f.whitespaceOnly = true;
  }
}

// A content id per file (a git blob id). Stored in the object database (-w)
// so a later re-review can diff "what you reviewed" against "what's there now",
// whether or not anything was committed in between.
function attachBlobs(files, args) {
  const live = files.filter((f) => f.status !== "deleted");
  for (const f of files) if (f.status === "deleted") f.blob = "deleted";
  if (!live.length) return;
  if (args.head) {
    for (const f of live) f.blob = tryGit(["rev-parse", `${args.head}:${f.path}`]) || "unknown";
  } else {
    const ids = git(["hash-object", "-w", "--", ...live.map((f) => f.path)]).trim().split("\n");
    live.forEach((f, i) => (f.blob = ids[i]));
  }
}

function loadPrevious(path) {
  if (!path) return null;
  if (!existsSync(path)) { console.log(`note: ${path} not found, doing a full review.`); return null; }
  try {
    const prev = JSON.parse(readFileSync(path, "utf8"));
    if (!prev || typeof prev.reviewed !== "object") throw new Error("missing \"reviewed\"");
    prev.comments = Array.isArray(prev.comments) ? prev.comments : [];
    return prev;
  } catch (e) {
    console.log(`warning: could not read ${path} (${e.message}), doing a full review.`);
    return null;
  }
}

// For each file: "unchanged" (reviewed, same content), "updated" (reviewed,
// content changed since), or "new" (not reviewed before).
function compareWithPrevious(files, prev, warnings) {
  for (const f of files) {
    const seen = prev.reviewed[f.path];
    if (!seen) { f.review = "new"; continue; }
    f.prevBlob = seen;
    if (seen === f.blob) { f.review = "unchanged"; continue; }
    f.review = "updated";
    if (seen === "deleted" || f.blob === "deleted") continue;
    let out = "";
    try {
      out = execFileSync("git", ["diff", "--no-color", "--no-ext-diff", "-U3", seen, f.blob], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    } catch {
      warnings.push(`Can't show changes since your review for ${f.path} (the reviewed version is no longer in git). Showing the full diff.`);
      continue;
    }
    const [d] = parseDiff(out);
    if (d) f.since = { hunks: d.hunks, additions: d.additions, deletions: d.deletions, truncated: d.truncated };
  }
}

// ---------- main ----------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const { base, label, files, live, range } = collect(args);
  if (!files.length) die(`No changes between ${base} and ${label}.`);
  markWhitespaceOnly(files, range);
  attachBlobs(files, args);

  const warnings = [];
  const prev = loadPrevious(args.previous && resolve(args.previous));
  if (prev) compareWithPrevious(files, prev, warnings);

  if (args.status) {
    const rows = files.map((f) => ({
      path: f.path,
      review: f.review,
      ...(f.review === "updated" && f.since ? { diff_since_review: `git diff ${f.prevBlob} ${f.blob}` } : {}),
    }));
    const count = (r) => rows.filter((x) => x.review === r).length;
    console.log(JSON.stringify({
      base, head: label,
      summary: { updated: count("updated"), new: count("new"), unchanged: count("unchanged") },
      earlier_comments: prev ? prev.comments.length : 0,
      files: rows,
    }, null, 2));
    return;
  }

  const guidePath = resolve(args.guide);
  let guide;
  try {
    guide = JSON.parse(readFileSync(guidePath, "utf8"));
  } catch (e) {
    die(`Could not read ${guidePath}: ${e.message}`);
  }
  warnings.push(...validate(guide, files));
  const sha = tryGit(["rev-parse", "--short", args.head || "HEAD"]) || "unknown";
  // The browser keeps review state per exact content, so editing a file
  // (committed or not) never inherits a stale "reviewed" tick.
  const fingerprint = createHash("sha1").update(files.map((f) => `${f.path}:${f.blob}`).join("\n")).digest("hex").slice(0, 12);

  const data = {
    guide,
    files,
    previous: prev ? { reviewedAt: prev.reviewed_at || null, comments: prev.comments } : null,
    meta: {
      base,
      head: label,
      sha,
      dirty: live && !!tryGit(["status", "--porcelain", "--untracked-files=normal", "--", ".", ":!.second-look"]),
      key: `second-look:${fingerprint}`,
      generated: new Date().toISOString(),
      warnings,
    },
  };

  const template = readFileSync(join(HERE, "viewer.html"), "utf8");
  // Escape "</" so the data can never close the <script> tag early.
  const json = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
  let highlighter = "";
  try {
    highlighter = readFileSync(join(HERE, "vendor", "highlight.min.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  } catch {
    console.log("warning: scripts/vendor/highlight.min.js not found; code will render without syntax highlighting.");
  }
  const html = template
    .replace("/*__HIGHLIGHT_JS__*/", () => highlighter)
    .replace("/*__REVIEW_DATA__*/null", () => json)
    .replace("__REVIEW_TITLE__", () => escapeHtml(guide.title));

  const outPath = resolve(args.out || join(dirname(guidePath), "review.html"));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);

  const adds = files.reduce((n, f) => n + f.additions, 0);
  const dels = files.reduce((n, f) => n + f.deletions, 0);
  console.log(`Wrote ${outPath}`);
  console.log(`${guide.chapters.length} chapters · ${files.length} files · +${adds} -${dels} · ${guide.findings.length} findings`);
  if (prev) {
    const c = (r) => files.filter((f) => f.review === r).length;
    console.log(`since last review: ${c("updated")} updated · ${c("new")} not yet reviewed · ${c("unchanged")} unchanged (hidden by default)`);
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  if (args.open) openFile(outPath);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Compare real paths so the script still runs when invoked through a symlink
// (e.g. a symlinked ~/.claude, or macOS /var -> /private/var).
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main();
