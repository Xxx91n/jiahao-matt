# jiahao-matt

<p align="center">
  <b>English</b> | <a href="README-zh-CN.md">中文</a>
</p>

A tiny script that adds my own rules to an already-installed copy of
[mattpocock/skills](https://github.com/mattpocock/skills).

It reports every place it would change before writing, leaves each file's
existing line endings and BOM as they are, and keeps one copy of each rule no
matter how often you run it.

## Why

mattpocock's skills are good, but grilling and domain modeling let the agent coin
jargon and quietly write the term into `GLOSSARY.md`. The new words often come
out stiff, like a translated manual, and then they spread into later work.

Two rules fix the two places where that happens:

| Rule | Goes into | What it stops |
| --- | --- | --- |
| `glossary-gate` | `engineering/domain-modeling/SKILL.md` | writing, renaming, or redefining a `GLOSSARY.md` term before the user has seen the term, a one-line plain explanation, and the everyday words it replaces |
| `plain-grilling` | `productivity/grilling/SKILL.md` | questions and recommended answers that sound like a translation instead of a person talking |

Both rules live in [`rules/`](rules/), one Markdown file per rule. The file
header says which skill file to touch, which sentence marks the landing spot,
and which word to watch when building the candidate list.

## Requirements

Node 20 or newer. No dependencies.

## Use

```bash
# Look first. This writes nothing.
node inject-rules.mjs ~/.agents/skills/grill

# Write, after a backup copy.
node inject-rules.mjs ~/.agents/skills/grill --apply

# Leave one skill file alone for this run.
node inject-rules.mjs ~/.agents/skills/grill --apply \
  --skip productivity/grilling/SKILL.md
```

On Windows the installed copy is usually at
`C:\Users\<you>\.agents\skills\grill`.

The first argument is the root of the install. The script checks for a `skills/`
folder to tell two layouts apart:

- **Installed copy** – no `skills/` folder; target paths are read straight from
  the root. This is the flattening that `scripts/link-skills.sh` produces.
- **Repo clone** – `skills/` exists; every target path gets the `skills/` prefix.

## The report

The script speaks plain Chinese. Each line starts with a status word:

| Word | Meaning |
| --- | --- |
| `[会插入]` | the rule block is not in the file yet and would go in after the anchoring paragraph |
| `[会替换]` | a marker pair is already there, but the text between them differs from the rule file |
| `[没问题]` | the block already matches the rule file exactly; nothing to do |
| `[跳过]` | you passed `--skip` for this file |
| `[出错了]` | something blocks a safe write: a rule file that will not parse, a missing target, two targets pointing at one file, a path segment that is not a folder, a missing or repeated anchoring sentence, unpaired markers, a symlink target, a path that escapes the root, an unreadable file, or bytes that are not UTF-8 |
| `[候选]` | some other file mentions the rule's watch word; it is not in the target list, so nothing is written there |

`[出错了]` in a dry run exits 1. With `--apply`, a single `[出错了]` cancels the
whole run: no backup folder, no file touched.

Exit codes: `0` done, `1` a rule file, target, or anchoring problem, `2` wrong
usage, `3` write failure (including a backup that could not be created). A write
failure rolls back the files already written.

## Reruns

Every inserted block is wrapped in a marker pair:

```markdown
<!-- jiahao:glossary-gate:start -->
... rule text ...
<!-- jiahao:glossary-gate:end -->
```

A second run finds the markers and reports `[没问题]`; nothing is rewritten and no
new backup folder appears. If you edit the rule text, the next run reports
`[会替换]` and swaps the block text, keeping one copy.

Files are written with a temporary file and a rename, in the file's own folder.
Existing lines and a leading BOM are left as they are; the inserted block uses
the file's dominant line ending, so a file with mixed endings keeps its original
lines untouched. With `--apply`, the files about to change are first copied to
`jiahao-backup-<timestamp>/` under the root.

## Adding a target

Edit the rule file header and repeat the target block:

```markdown
target:
path: engineering/tdd/SKILL.md
after: When exploring the codebase, read `GLOSSARY.md` (if it exists) ...
position: after-paragraph
```

`after` must match exactly one line in the target file. Run without `--apply`
first to confirm the report.

## Testing

```bash
npm test
```

The suite copies the fixture skills into a temp folder and runs the real CLI as a
child process. It checks the report text, the exit codes, the backup folder, and
the bytes on disk. The fixtures in `test/fixtures/installed/` are the real
installed skill files, so the anchoring sentences come from upstream, not from a
sample written to pass.

CI runs the same command on Node 20.

Before writing to your real install, rehearse on a copy of it:

```bash
cp -r ~/.agents/skills/grill /tmp/grill-copy
node inject-rules.mjs /tmp/grill-copy            # report only
node inject-rules.mjs /tmp/grill-copy --apply    # writes the copy
node inject-rules.mjs /tmp/grill-copy --apply    # second run reports [没问题]
```

On Windows, copy the folder with Explorer instead of `cp -r`; the three script
calls are the same. The first run must show two `[会插入]` lines, the third run
two `[没问题]` lines, and no new backup folder.

## License

[MIT](LICENSE)
