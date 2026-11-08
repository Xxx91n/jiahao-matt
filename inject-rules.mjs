#!/usr/bin/env node
// Reads rules/*.md, scans the target skills folder, and reports what a write
// would change. A dry run only prints the report; `--apply` also writes the
// reported blocks. `--skip <path>` may be repeated to leave named targets
// alone for one run.
//
// Rule file shape:
//
//   <!-- jiahao-rule
//   id: <rule id>
//   watch: <word used to build the candidate list>
//
//   target:
//   path: <path under the skills folder>
//   after: <sentence that marks the landing place>
//   position: after-paragraph
//   -->
//
//   <text to inject>
//
// One rule file may declare several targets by repeating the target block.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.join(SCRIPT_DIR, 'rules');

const STATUS_LABEL = {
  insert: '[会插入]',
  replace: '[会替换]',
  ok: '[没问题]',
  skip: '[跳过]',
  error: '[出错了]',
  candidate: '[候选]',
};

const HEADER_OPEN = '<!-- jiahao-rule';
const KNOWN_POSITIONS = new Set(['after-paragraph']);
const BACKUP_PREFIX = 'jiahao-backup-';

function toSlashes(value) {
  return value.split(path.sep).join('/');
}

function ruleDisplayName(file) {
  return toSlashes(path.join('rules', path.basename(file)));
}

function usage(problem) {
  console.error(problem);
  console.error('用法：node inject-rules.mjs <target-root> [--apply] [--skip <path>]');
  console.error('--skip 可以写多次，每次跳过清单里一个目标文件。');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const skips = [];
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--skip') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) usage('--skip 后面要给一个路径。');
      skips.push(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) usage(`不认识的选项：${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) usage('要给一个目标根目录，不能多也不能少。');
  const root = path.resolve(positional[0]);
  if (!fs.existsSync(root)) usage(`目标根目录不存在：${root}`);
  return { root, apply, skips };
}

function ruleProblem(file, reason) {
  const rel = ruleDisplayName(file);
  const error = new Error(reason);
  error.ruleFile = rel;
  return error;
}

function parseRuleFile(file) {
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.startsWith('\uFEFF')) raw = raw.slice(1);
  raw = raw.replace(/\r\n/g, '\n');

  if (!raw.startsWith(`${HEADER_OPEN}\n`)) {
    throw ruleProblem(file, `开头没有 “${HEADER_OPEN}” 这一行。`);
  }
  const headerMatch = /^<!-- jiahao-rule\n([\s\S]*?)\n-->/.exec(raw);
  if (!headerMatch) {
    throw ruleProblem(file, '头部没有以 “-->” 单独一行结束。');
  }

  const rule = {
    file,
    relFile: ruleDisplayName(file),
    id: null,
    watch: null,
    targets: [],
    body: '',
  };
  let currentTarget = null;
  for (const rawLine of headerMatch[1].split('\n')) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line === 'target:') {
      currentTarget = {};
      rule.targets.push(currentTarget);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon === -1) throw ruleProblem(file, `头部这一行看不懂：“${line}”`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'id') {
      rule.id = value;
    } else if (key === 'watch') {
      rule.watch = value;
    } else if (currentTarget && key === 'path') {
      currentTarget.path = value;
    } else if (currentTarget && key === 'after') {
      currentTarget.after = value;
    } else if (currentTarget && key === 'position') {
      currentTarget.position = value;
    } else {
      throw ruleProblem(file, `头部这一项不知道是什么：“${key}”`);
    }
  }

  if (!rule.id) throw ruleProblem(file, '头部没写 rule id。');
  if (!rule.watch) throw ruleProblem(file, '头部没写 watch 词。');
  if (rule.targets.length === 0) throw ruleProblem(file, '头部没有 target 块。');
  for (const target of rule.targets) {
    if (!target.path) throw ruleProblem(file, '有一个 target 块没写 path。');
    if (!target.after) throw ruleProblem(file, `target ${target.path} 没写定位句 after。`);
    if (!target.position) throw ruleProblem(file, `target ${target.path} 没写 position。`);
    if (!KNOWN_POSITIONS.has(target.position)) {
      throw ruleProblem(file, `target ${target.path} 的 position 不认识：“${target.position}”`);
    }
  }

  rule.body = raw
    .slice(headerMatch[0].length, raw.length)
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  if (rule.body === '') throw ruleProblem(file, '规则块的正文是空的。');

  return rule;
}

function loadRules() {
  if (!fs.existsSync(RULES_DIR)) {
    return { rules: [], errors: [`规则目录不存在：${toSlashes(RULES_DIR)}`] };
  }
  const files = fs
    .readdirSync(RULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => path.join(RULES_DIR, entry.name))
    .sort();

  const rules = [];
  const errors = [];
  for (const file of files) {
    try {
      rules.push(parseRuleFile(file));
    } catch (error) {
      if (error.ruleFile) {
        errors.push(`规则文件 ${error.ruleFile}：${error.message}`);
      } else {
        errors.push(`规则文件 ${ruleDisplayName(file)}：读不了（${error.message}）`);
      }
    }
  }
  return { rules, errors };
}

function detectLayout(root) {
  const skillsDir = path.join(root, 'skills');
  let isRepo = false;
  try {
    isRepo = fs.statSync(skillsDir).isDirectory();
  } catch {
    isRepo = false;
  }
  return {
    root,
    isRepo,
    scanRoot: isRepo ? skillsDir : root,
    prefix: isRepo ? 'skills/' : '',
  };
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function detectEol(text) {
  const crlf = text.split('\r\n').length - 1;
  const lf = text.split('\n').length - 1 - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

function splitLines(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\n') continue;
    const end = i > start && text[i - 1] === '\r' ? i - 1 : i;
    lines.push({ content: text.slice(start, end), end });
    start = i + 1;
  }
  lines.push({ content: text.slice(start), end: text.length });
  return lines;
}

function bodyWithEol(rule, eol) {
  return rule.body.split('\n').join(eol);
}

function targetKey(full) {
  const resolved = path.resolve(full);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function skipKey(value) {
  const text = toSlashes(String(value).trim());
  const noDot = text.startsWith('./') ? text.slice(2) : text;
  return process.platform === 'win32' ? noDot.toLowerCase() : noDot;
}

function skipAcceptedValues(target, context) {
  const display = `${context.prefix}${target.path}`;
  const full = path.join(context.scanRoot, target.path);
  return new Set(
    [display, target.path, toSlashes(path.relative(context.root, full)), toSlashes(full)].map(skipKey),
  );
}

function skipForTarget(skips, target, context) {
  const accepted = skipAcceptedValues(target, context);
  return skips.find((value) => accepted.has(skipKey(value)));
}

function canonicalPath(value) {
  try {
    return { path: fs.realpathSync(value), error: null };
  } catch (error) {
    return { path: path.resolve(value), error };
  }
}

function firstNonDirectoryAncestor(scanRoot, full) {
  const relative = path.relative(scanRoot, full);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  let current = scanRoot;
  for (const part of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.statSync(current);
    } catch {
      return null;
    }
    if (!stat.isDirectory()) return current;
  }
  return null;
}

function isInside(root, canonicalFull) {
  const rootKey = targetKey(canonicalPath(root).path);
  const fullKey = targetKey(canonicalFull);
  return fullKey.startsWith(`${rootKey}${path.sep}`);
}

function inspectTarget(rule, target, context, full, canonicalFull, canonicalError) {
  const display = `${context.prefix}${target.path}`;
  const blocker = firstNonDirectoryAncestor(context.scanRoot, full);
  if (blocker) {
    return {
      status: 'error',
      display,
      reason: `中间有一段不是文件夹：${toSlashes(path.relative(context.root, blocker))}。这一轮不写。`,
    };
  }
  if (canonicalError && canonicalError.code !== 'ENOENT') {
    return { status: 'error', display, reason: '看不了目标路径，可能是其中一段不是文件夹，或者没有权限。这一轮不写。' };
  }
  if (!isInside(context.scanRoot, canonicalFull)) {
    return { status: 'error', display, reason: '目标路径跑到了目标根目录外面，这一轮不写。' };
  }
  let originalBytes;
  let mode;
  try {
    if (fs.lstatSync(full).isSymbolicLink()) {
      return { status: 'error', display, reason: '目标本身是符号链接，这一轮不写。' };
    }
    const stat = fs.statSync(full);
    mode = stat.mode & 0o777;
    originalBytes = fs.readFileSync(full);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'error', display, reason: '文件不存在。' };
    }
    return { status: 'error', display, reason: `读不了这个文件（${error.message}）。` };
  }

  const bom = originalBytes.length >= 3 && originalBytes[0] === 0xef && originalBytes[1] === 0xbb && originalBytes[2] === 0xbf;
  const bodyBytes = originalBytes.subarray(bom ? 3 : 0);
  const text = bodyBytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bodyBytes)) {
    return { status: 'error', display, reason: '文件里有不是 UTF-8 的字节，改它可能碰坏别的字节，这一轮不写。' };
  }
  const eol = detectEol(text);
  const startMarker = `<!-- jiahao:${rule.id}:start -->`;
  const endMarker = `<!-- jiahao:${rule.id}:end -->`;
  const startCount = text.split(startMarker).length - 1;
  const endCount = text.split(endMarker).length - 1;
  const base = { display, full, originalBytes, mode, text, eol, bom, startMarker, endMarker };

  if (startCount > 0 || endCount > 0) {
    if (startCount !== 1 || endCount !== 1) {
      return {
        status: 'error',
        display,
        reason: `规则标记不成对：开始标记 ${startCount} 个，结束标记 ${endCount} 个。`,
      };
    }
    const startAt = text.indexOf(startMarker);
    const endAt = text.indexOf(endMarker);
    if (endAt < startAt) {
      return { status: 'error', display, reason: '结束标记跑到了开始标记前面。' };
    }
    const between = text.slice(startAt + startMarker.length, endAt);
    const expected = `${eol}${bodyWithEol(rule, eol)}${eol}`;
    if (between === expected) {
      return { ...base, status: 'ok', line: lineNumberAt(text, startAt) };
    }
    return { ...base, status: 'replace', line: lineNumberAt(text, startAt), startAt, endAt };
  }

  const lines = splitLines(text);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].content.includes(target.after)) hits.push(i);
  }
  if (hits.length === 0) {
    return { status: 'error', display, reason: `找不到定位句：“${target.after}”` };
  }
  if (hits.length > 1) {
    return { status: 'error', display, reason: `定位句出现了 ${hits.length} 次，分不清该放哪儿。` };
  }

  let paragraphEnd = hits[0];
  while (paragraphEnd + 1 < lines.length && lines[paragraphEnd + 1].content.trim() !== '') {
    paragraphEnd += 1;
  }
  return { ...base, status: 'insert', line: paragraphEnd + 2, insertAt: lines[paragraphEnd].end };
}

function plannedText(rule, result) {
  const body = bodyWithEol(rule, result.eol);
  if (result.status === 'replace') {
    return (
      result.text.slice(0, result.startAt + result.startMarker.length) +
      result.eol +
      body +
      result.eol +
      result.text.slice(result.endAt)
    );
  }
  const block = `${result.startMarker}${result.eol}${body}${result.eol}${result.endMarker}`;
  return result.text.slice(0, result.insertAt) + result.eol + result.eol + block + result.text.slice(result.insertAt);
}

function encodeWithBom(text, bom) {
  const body = Buffer.from(text, 'utf8');
  if (!bom) return body;
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
}

function backupFolder(root) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let name = `${BACKUP_PREFIX}${stamp}`;
  let suffix = 1;
  while (fs.existsSync(path.join(root, name))) {
    name = `${BACKUP_PREFIX}${stamp}-${suffix}`;
    suffix += 1;
  }
  return path.join(root, name);
}

function writeAtomically(full, bytes, mode) {
  const temp = path.join(
    path.dirname(full),
    `.${path.basename(full)}.jiahao-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  try {
    fs.writeFileSync(temp, bytes);
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, full);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The original file is what matters; cleanup is best effort.
    }
    throw error;
  }
}

function applyChanges(changes, context) {
  if (changes.length === 0) {
    console.log('这次没有任何文件需要改。');
    return true;
  }
  let backupDir;
  try {
    backupDir = backupFolder(context.root);
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    for (const { result } of changes) {
      const copy = path.join(backupDir, path.relative(context.root, result.full));
      fs.mkdirSync(path.dirname(copy), { recursive: true, mode: 0o700 });
      fs.writeFileSync(copy, result.originalBytes, { mode: 0o600 });
    }
  } catch (error) {
    console.log(`${STATUS_LABEL.error} 备份失败：${error.message}。这次一个文件也没有写。`);
    return false;
  }

  const written = [];
  try {
    for (const { rule, result } of changes) {
      writeAtomically(result.full, encodeWithBom(plannedText(rule, result), result.bom), result.mode);
      written.push(result);
    }
    console.log(
      `已写入 ${changes.length} 个文件；备份在：${toSlashes(path.relative(context.root, backupDir))}`,
    );
    return true;
  } catch (error) {
    let rollbackProblem = false;
    for (const result of written.reverse()) {
      try {
        writeAtomically(result.full, result.originalBytes, result.mode);
      } catch {
        rollbackProblem = true;
      }
    }
    if (rollbackProblem) {
      console.log(`${STATUS_LABEL.error} 写文件失败：${error.message}。有文件没恢复成功，请用备份还原。`);
    } else {
      console.log(`${STATUS_LABEL.error} 写文件失败：${error.message}。已经改过的文件都恢复了原样。`);
    }
    return false;
  }
}

function collectFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name.startsWith(BACKUP_PREFIX)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function fileMentions(file, word) {
  try {
    const bytes = fs.readFileSync(file);
    if (bytes.includes(0)) return false;
    return bytes.toString('utf8').includes(word);
  } catch {
    return false;
  }
}

function findCandidates(rule, context, targetFiles) {
  const files = [];
  collectFiles(context.scanRoot, files);
  const candidates = [];
  for (const file of files) {
    if (targetFiles.has(file)) continue;
    if (!fileMentions(file, rule.watch)) continue;
    candidates.push(toSlashes(path.relative(context.root, file)));
  }
  return candidates;
}

function main() {
  const context = parseArgs(process.argv.slice(2));
  context.layout = detectLayout(context.root);

  if (context.layout.isRepo) {
    console.log('布局：仓库克隆（根目录下有 skills/ 文件夹，目标路径都带这个前缀）');
  } else {
    console.log('布局：已安装副本（根目录下没有 skills/ 文件夹，直接看它下面的文件）');
  }

  const { rules, errors: ruleErrors } = loadRules();
  for (const message of ruleErrors) console.log(`${STATUS_LABEL.error} ${message}`);

  const counts = { insert: 0, replace: 0, ok: 0, skip: 0, error: ruleErrors.length };
  const matchedSkips = new Set();
  const targetFiles = new Set();
  const plannedTargets = [];
  const seenKeys = new Set();
  const duplicateKeys = new Set();
  for (const rule of rules) {
    for (const target of rule.targets) {
      const full = path.join(context.layout.scanRoot, target.path);
      const canonical = canonicalPath(full);
      plannedTargets.push({
        rule,
        target,
        full,
        canonicalFull: canonical.path,
        canonicalError: canonical.error,
      });
      targetFiles.add(full);
      const key = targetKey(canonical.path);
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
    }
  }

  const changes = [];
  for (const { rule, target, full, canonicalFull, canonicalError } of plannedTargets) {
    const skipValue = skipForTarget(context.skips, target, context.layout);
    if (skipValue !== undefined) matchedSkips.add(skipValue);
    if (duplicateKeys.has(targetKey(canonicalFull))) {
      counts.error += 1;
      console.log(
        `${STATUS_LABEL.error} ${rule.id} → ${context.layout.prefix}${target.path}：这个文件被不止一个目标块指到了，这一轮不写。`,
      );
      continue;
    }
    if (skipValue !== undefined) {
      counts.skip += 1;
      console.log(
        `${STATUS_LABEL.skip} ${rule.id} → ${context.layout.prefix}${target.path}（--skip 点了它，这一轮不改这个文件）`,
      );
      continue;
    }
    const result = inspectTarget(rule, target, context.layout, full, canonicalFull, canonicalError);
    if (result.status === 'insert') {
      counts.insert += 1;
      changes.push({ rule, result });
      console.log(`${STATUS_LABEL.insert} ${rule.id} → ${result.display}:${result.line}（放在定位句那一段的后面）`);
    } else if (result.status === 'replace') {
      counts.replace += 1;
      changes.push({ rule, result });
      console.log(`${STATUS_LABEL.replace} ${rule.id} → ${result.display}:${result.line}（开始标记在这一行，块里的内容要换）`);
    } else if (result.status === 'ok') {
      counts.ok += 1;
      console.log(`${STATUS_LABEL.ok} ${rule.id} → ${result.display}:${result.line}（规则块已经和规则文件一样，不用动）`);
    } else {
      counts.error += 1;
      console.log(`${STATUS_LABEL.error} ${rule.id} → ${result.display}：${result.reason}`);
    }
  }

  for (const value of context.skips) {
    if (matchedSkips.has(value)) continue;
    counts.error += 1;
    console.log(`${STATUS_LABEL.error} 跳过路径 “${value}”：没有对应的目标文件，这一轮不写。`);
  }

  let candidateCount = 0;
  for (const rule of rules) {
    for (const candidate of findCandidates(rule, context.layout, targetFiles)) {
      candidateCount += 1;
      console.log(`${STATUS_LABEL.candidate} ${rule.id} → ${candidate}（文件里提到 ${rule.watch}，但不在目标清单里）`);
    }
  }

  console.log(
    `小结：${rules.length} 条规则，${plannedTargets.length} 个目标；` +
      `会插入 ${counts.insert}，会替换 ${counts.replace}，跳过 ${counts.skip}，没问题 ${counts.ok}，出错了 ${counts.error}；` +
      `候选 ${candidateCount} 个。`,
  );

  if (!context.apply) {
    console.log('这次是试运行，一个文件也没有写。');
    process.exitCode = counts.error > 0 ? 1 : 0;
    return;
  }

  if (counts.error > 0) {
    console.log('有出错了的目标，这一轮一个文件也没有写。');
    process.exitCode = 1;
    return;
  }

  process.exitCode = applyChanges(changes, context) ? 0 : 3;
}

try {
  main();
} catch (error) {
  console.log(`${STATUS_LABEL.error} 意外错误：${error.message}`);
  process.exitCode = 1;
}
