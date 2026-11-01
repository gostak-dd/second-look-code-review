# Second Look Code Review

An [Agent Skill](https://agentskills.io) that turns a branch or pull request into an interactive code review guide in your browser. Works with Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Windsurf and other coding agents that support skills.

- **Chapters by behavior, not by folder.** Files from anywhere in the repo are grouped by what they do, with tests next to the code they test.
- **Risk per chapter**, so you know where to slow down.
- **An AI-code checklist** that catches the mistakes coding agents keep making: runaway LLM output, stacked retries, swallowed errors, trusting IDs from the client, tests that only test mocks, risky migrations and more. Findings are pinned to the exact line.
- **Guided walkthroughs.** Press `t` and the agent walks you through a chapter step by step, with the relevant lines highlighted.
- **Comment, export, fix, re-review.** Leave comments on any line, click **Export for AI**, paste into your agent, and it fixes them. The next review only shows what changed since you last looked.

The agent only writes a small `guide.json`. A fixed, zero-dependency script renders the page, so it looks the same every time and costs no tokens to draw.

## Requirements

- A coding agent that supports Agent Skills and can run shell commands
- Node.js 18 or later
- git
- [GitHub CLI](https://cli.github.com) (`gh`), optional: used to read the PR title and description

## Install

### Any agent, with one command (recommended)

```bash
npx skills add gostak-dd/second-look-code-review -g
```

This uses the open [`skills`](https://github.com/vercel-labs/skills) installer. It asks which agents you use and installs the skill for each of them. `-g` installs it for all your projects; leave it out to install into the current project only.

To pick agents up front, pass `-a`:

```bash
npx skills add gostak-dd/second-look-code-review -g -a claude-code codex cursor
```

Update with `npx skills update second-look-code-review`, remove with `npx skills remove second-look-code-review`.

### Manual install

Clone the repo into your agent's skills folder:

```bash
git clone https://github.com/gostak-dd/second-look-code-review.git <skills-folder>/second-look-code-review
```

| Agent | For all projects | For one project |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| Codex | `~/.agents/skills/` | `.agents/skills/` |
| Cursor | `~/.cursor/skills/` | `.agents/skills/` |
| GitHub Copilot | `~/.copilot/skills/` | `.agents/skills/` |
| Gemini CLI | `~/.gemini/skills/` | `.agents/skills/` |
| OpenCode | `~/.config/opencode/skills/` | `.agents/skills/` |
| Windsurf | `~/.codeium/windsurf/skills/` | `.windsurf/skills/` |
| Goose | `~/.config/goose/skills/` | `.goose/skills/` |

Paths move as agents update; the [`skills` agent list](https://github.com/vercel-labs/skills/blob/main/docs/agents.md) has the current ones for 80+ agents. For example, for Claude Code on every project:

```bash
git clone https://github.com/gostak-dd/second-look-code-review.git ~/.claude/skills/second-look-code-review
```

Update with `git -C <skills-folder>/second-look-code-review pull`.

### After installing

Restart your agent (or start a new session) so it picks up the skill, then add the folder the skill writes its output to into your project's `.gitignore`:

```bash
echo ".second-look/" >> .gitignore
```

## Use

1. Check out the branch you want to review.
2. Ask your agent:

   > Review this branch against main

   In agents that turn skills into slash commands, such as Claude Code, you can also type `/second-look-code-review`.

3. The agent reads the diff, groups it into chapters, runs the checklist, and opens `.second-look/review.html` in your browser.

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
| `e` | Export comments for your agent |
| `?` | Show all shortcuts |

Each chapter also lists the questions worth asking about it and how to try it by hand. Review progress and comments are saved in your browser.

## The review loop

1. Mark files reviewed, comment on lines, then click **Export for AI**. It copies a block starting with `<!-- second-look-comments -->`.
2. Paste it into your agent. It saves which version of each file you reviewed to `.second-look/last-review.json`, fixes each comment (or explains why not), and records what it did.
3. Ask for a review again. Files you already reviewed that haven't changed are hidden. Updated files open on just the changes since your review, with a toggle to the full PR diff, and your earlier comments are shown with how each one was resolved.

This works whether or not anything was committed in between.

## Make it yours

`checklist.md` is the part worth editing. Delete the checks that don't fit your stack and add the failures you've actually seen in production. Your own list beats a generic one.

## Files

| File | What it is |
| --- | --- |
| `SKILL.md` | Instructions the agent follows |
| `checklist.md` | The checks run on risky chapters |
| `schema.json` | The shape of `guide.json` |
| `scripts/render.mjs` | Renders the guide plus the real git diff into one HTML page |
| `scripts/viewer.html` | The page template |

## Running the renderer by hand

If you already have a `guide.json`:

```bash
node ~/.claude/skills/second-look-code-review/scripts/render.mjs --guide .second-look/guide.json --base main --open
```

| Flag | Meaning |
| --- | --- |
| `--guide <file>` | The guide to render |
| `--base <ref>` | Base branch to diff against (default `main`) |
| `--head <ref>` | Review a specific ref instead of the working tree |
| `--working-tree` | Review only uncommitted changes against `HEAD` |
| `--previous <file>` | Last review state, for a re-review |
| `--status` | With `--previous`, print which files changed since the last review as JSON |
| `--out <file>` | Output path (default `.second-look/review.html`) |
| `--open` | Open the page in your browser |

The renderer checks the guide against the real diff and warns about files missing from every chapter or findings on lines that aren't in the diff.

## Privacy

Everything runs locally. The page is a single self-contained HTML file with no network requests. Your code only goes wherever your coding agent already sends it.

## License

MIT. Syntax highlighting uses [highlight.js](https://highlightjs.org) (BSD-3-Clause), bundled in `scripts/vendor/` and inlined into each page so the review works offline.
