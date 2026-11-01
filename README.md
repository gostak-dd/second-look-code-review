# pr-review

A [Claude Code](https://claude.com/claude-code) skill that turns a branch or pull request into an interactive review guide in your browser.

- **Chapters by behavior, not by folder.** Files from anywhere in the repo are grouped by what they do, with tests next to the code they test.
- **Risk per chapter**, so you know where to slow down.
- **An AI-code checklist** that catches the mistakes coding agents keep making: runaway LLM output, stacked retries, swallowed errors, trusting IDs from the client, tests that only test mocks, risky migrations and more. Findings are pinned to the exact line.
- **Guided walkthroughs.** Press `t` and Claude walks you through a chapter step by step, with the relevant lines highlighted.
- **Comment, export, fix, re-review.** Leave comments on any line, click **Export for Claude**, paste into Claude Code, and it fixes them. The next review only shows what changed since you last looked.

Claude only writes a small `guide.json`. A fixed, zero-dependency script renders the page, so it looks the same every time and costs no tokens to draw.

## Requirements

- Claude Code
- Node.js 18 or later
- git
- [GitHub CLI](https://cli.github.com) (`gh`), optional: used to read the PR title and description

## Install

**For every repo on your machine** (recommended):

```bash
git clone https://github.com/gostak-dd/pr-review.git ~/.claude/skills/pr-review
```

**For one project only**, from the project root:

```bash
git clone https://github.com/gostak-dd/pr-review.git .claude/skills/pr-review
```

Restart Claude Code (or start a new session) so it picks up the skill. Type `/` and you should see `pr-review` in the list.

Then add the folder the skill writes its output to into your project's `.gitignore`:

```bash
echo ".pr-review/" >> .gitignore
```

**Update** with `git -C ~/.claude/skills/pr-review pull`. **Uninstall** with `rm -rf ~/.claude/skills/pr-review`.

## Use

1. Check out the branch you want to review.
2. In Claude Code, run:

   ```
   /pr-review
   ```

   or just ask: "review this branch against main".

3. Claude reads the diff, groups it into chapters, runs the checklist, and opens `.pr-review/review.html` in your browser.

The review covers everything on the branch since it left the base branch, including uncommitted and untracked files. The base is the one you name, otherwise the PR's base, otherwise the repo's default branch.

Other things you can ask for:

- "Review only my uncommitted changes"
- "Review this branch against develop"
- "Review PR 42" (with `gh` installed)

## Reviewing in the browser

| Key | Action |
| --- | --- |
| `j` / `k` | Next / previous file |
| `x` | Mark the file reviewed and open the next one |
| `n` | Jump to the next finding |
| `t` | Walk through the current chapter |
| `f` | Focus mode: one chapter at a time |
| click a line, then `c` | Comment on that line |
| `e` | Export comments for Claude |
| `?` | Show all shortcuts |

Each chapter also lists the questions worth asking about it and how to try it by hand. Review progress and comments are saved in your browser.

## The review loop

1. Mark files reviewed, comment on lines, then click **Export for Claude**. It copies a block starting with `<!-- pr-review-comments -->`.
2. Paste it into Claude Code. Claude saves which version of each file you reviewed to `.pr-review/last-review.json`, fixes each comment (or explains why not), and records what it did.
3. Run `/pr-review` again. Files you already reviewed that haven't changed are hidden. Updated files open on just the changes since your review, with a toggle to the full PR diff, and your earlier comments are shown with how each one was resolved.

This works whether or not anything was committed in between.

## Make it yours

`checklist.md` is the part worth editing. Delete the checks that don't fit your stack and add the failures you've actually seen in production. Your own list beats a generic one.

## Files

| File | What it is |
| --- | --- |
| `SKILL.md` | Instructions Claude follows |
| `checklist.md` | The checks run on risky chapters |
| `schema.json` | The shape of `guide.json` |
| `scripts/render.mjs` | Renders the guide plus the real git diff into one HTML page |
| `scripts/viewer.html` | The page template |

## Running the renderer by hand

If you already have a `guide.json`:

```bash
node ~/.claude/skills/pr-review/scripts/render.mjs --guide .pr-review/guide.json --base main --open
```

| Flag | Meaning |
| --- | --- |
| `--guide <file>` | The guide to render |
| `--base <ref>` | Base branch to diff against (default `main`) |
| `--head <ref>` | Review a specific ref instead of the working tree |
| `--working-tree` | Review only uncommitted changes against `HEAD` |
| `--previous <file>` | Last review state, for a re-review |
| `--status` | With `--previous`, print which files changed since the last review as JSON |
| `--out <file>` | Output path (default `.pr-review/review.html`) |
| `--open` | Open the page in your browser |

The renderer checks the guide against the real diff and warns about files missing from every chapter or findings on lines that aren't in the diff.

## Privacy

Everything runs locally. The page is a single self-contained HTML file with no network requests. Your code only goes wherever Claude Code already sends it.

## License

MIT. Syntax highlighting uses [highlight.js](https://highlightjs.org) (BSD-3-Clause), bundled in `scripts/vendor/` and inlined into each page so the review works offline.
