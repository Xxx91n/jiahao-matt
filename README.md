<h1 align="center">jiahao-matt</h1>

<p align="center">
  <b>English</b> | <a href="README-zh-CN.md">中文</a>
</p>

A small script that adds rules to an installed copy of [mattpocock/skills](https://github.com/mattpocock/skills)
to keep AI agents from turning into [jiahao](https://github.com/Xxx91n/jiahao).

It lists every place it plans to touch before making any changes.

## Why

When using mattpocock's skills without boundaries, grilling and domain modeling let agents
make up junk jargon and write it straight into `GLOSSARY.md`. The coined terms often sound
like stiff machine translation, dragging down everything you build next.

Current rules:

| Rule | Where it goes | What it does |
| --- | --- | --- |
| `glossary-gate` | `engineering/domain-modeling/SKILL.md` | Before writing, renaming, or redefining a term in `GLOSSARY.md`, explain it in plain words, show the everyday words it replaces, and wait for human approval |
| `plain-grilling` | `productivity/grilling/SKILL.md` | Stop questions and suggested answers from reading like translated manuals; make them sound like natural speech |

> Rules live in [`rules/`](rules/), one Markdown file per rule.

## Requirements

Node 20.1 or higher

## Usage

```bash
# Preview changes first
node inject-rules.mjs <path-to-mattpocock-skills>

# Check first, then apply with automatic backup
node inject-rules.mjs <path-to-mattpocock-skills> --apply

# Skip files you don't want to touch
node inject-rules.mjs <path-to-mattpocock-skills> --apply \
  --skip productivity/grilling/SKILL.md
```

## Troubleshooting

Each line starts with a status label:

| Status label | Meaning |
| --- | --- |
| `[会插入]` | The rule block is not in the file yet; it will be inserted right after the anchor paragraph |
| `[会替换]` | Markers already exist, but the text inside doesn't match the rule file and will be replaced |
| `[没问题]` | The block matches the rule file word for word; nothing to touch |
| `[跳过]` | The file was skipped via `--skip` |
| `[出错了]` | Something blocked a safe write: rule header failed to parse, target doesn't exist, two targets point to the same file, a path segment isn't a directory, anchor sentence is missing or repeated, markers are mismatched, target is a symlink, path escapes the root directory, file cannot be read, or bytes are not valid UTF-8 |
| `[候选]` | Another file mentioned a watched word, but it isn't in the target list, so nothing was written |

- A `[出错了]` detected before writing exits with code 1. With `--apply`, any single check error halts the entire run: no files are modified, and no backup folder is created.
- An error midway through writing exits with code 3: if creating the backup fails, no target files are modified (though the backup folder might be partially created); if writing fails, already-modified files are rolled back to their original state; if rollback also fails, restore from `jiahao-backup-<timestamp>/`.
- Exit codes: `0` success, `1` issue with rule files, targets, or anchor sentences, `2` invalid arguments, `3` write failure (including failed backup creation). A write failure rolls back any modified files.

## Reruns

Inserted blocks are wrapped in marker pairs:

```markdown
<!-- jiahao:glossary-gate:start -->
... rule content ...
<!-- jiahao:glossary-gate:end -->
```

- A second run recognizes these markers and reports `[没问题]`. Nothing is rewritten, and no new backup folder is created. If you edit the rule text and rerun, it reports `[会替换]` and only updates the text inside the block—leaving just one copy.

- File writes use an atomic write-and-rename strategy, placing the temporary file right next to the original. Existing lines and leading BOMs are never touched; the inserted block adopts whichever line ending dominates the file, so files with mixed line endings simply gain the block without disturbing existing lines.

- With `--apply`, files scheduled to change are copied first into `jiahao-backup-<timestamp>/` under the root directory.

## How to add target markdown files

Edit the header of a rule file and add another target block:

```markdown
target:
path: engineering/tdd/SKILL.md
after: When exploring the codebase, read `GLOSSARY.md` (if it exists) ...
position: after-paragraph
```

`after` must match exactly one line in the target file. Run once without `--apply` first to check the results before writing.

## Testing

```bash
npm test
```

Tests copy sample skills into a temp directory, run the actual CLI script as a child process, and verify report output, exit codes, backup directories, and disk bytes. Sample skills are kept in `test/fixtures/installed/`.

Before writing to your real install directory, you can dry run on a copy:

```bash
cp -r ~/.agents/skills/matt /tmp/matt-copy
node inject-rules.mjs /tmp/matt-copy            # Preview only
node inject-rules.mjs /tmp/matt-copy --apply    # Write to copy
node inject-rules.mjs /tmp/matt-copy --apply    # Second run reports [没问题]
```

## License

[MIT](LICENSE). Test samples are copied from
[mattpocock/skills](https://github.com/mattpocock/skills); their MIT notice is in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
