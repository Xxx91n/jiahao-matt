#!/usr/bin/env node
// Reads rules/*.md, scans the target skills folder, and reports what a write
// would change. This version never writes; it only prints the report.
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
  error: '[出错了]',
  candidate: '[候选]',
};

const HEADER_OPEN = '<!-- jiahao-rule';
const KNOWN_POSITIONS = new Set(['after-paragraph']);

function toSlashes(value) {
  return value.split(path.sep).join('/');
}

function ruleDisplayName(file) {
  return toSlashes(path.join('rules', path.basename(file)));
}

function usage(problem) {
  console.error(problem);
  console.error('用法：node inject-rules.mjs <target-root>');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith('-')) usage(`不认识的选项：${arg}`);
    positional.push(arg);
  }
  if (positional.length !== 1) usage('要给一个目标根目录，不能多也不能少。');
  const root = path.resolve(positional[0]);
  if (!fs.existsSync(root)) usage(`目标根目录不存在：${root}`);
  return { root };
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

function inspectTarget(rule, target, context) {
  const display = `${context.prefix}${target.path}`;
  const full = path.join(context.scanRoot, target.path);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'error', display, reason: '文件不存在。' };
    }
    return { status: 'error', display, reason: `读不了这个文件（${error.message}）。` };
  }
  text = text.replace(/\r\n/g, '\n');

  const startMarker = `<!-- jiahao:${rule.id}:start -->`;
  const endMarker = `<!-- jiahao:${rule.id}:end -->`;
  const startCount = text.split(startMarker).length - 1;
  const endCount = text.split(endMarker).length - 1;

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
    const expected = `\n${rule.body}\n`;
    if (between === expected) {
      return { status: 'ok', display, line: lineNumberAt(text, startAt) };
    }
    return { status: 'replace', display, line: lineNumberAt(text, startAt) };
  }

  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(target.after)) hits.push(i);
  }
  if (hits.length === 0) {
    return { status: 'error', display, reason: `找不到定位句：“${target.after}”` };
  }
  if (hits.length > 1) {
    return { status: 'error', display, reason: `定位句出现了 ${hits.length} 次，分不清该放哪儿。` };
  }

  let paragraphEnd = hits[0];
  while (paragraphEnd + 1 < lines.length && lines[paragraphEnd + 1].trim() !== '') {
    paragraphEnd += 1;
  }
  return { status: 'insert', display, line: paragraphEnd + 2 };
}

function collectFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
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

  const counts = { insert: 0, replace: 0, ok: 0, error: ruleErrors.length };
  const targetFiles = new Set();
  const plannedTargets = [];
  for (const rule of rules) {
    for (const target of rule.targets) {
      plannedTargets.push({ rule, target });
      targetFiles.add(path.join(context.layout.scanRoot, target.path));
    }
  }

  for (const { rule, target } of plannedTargets) {
    const result = inspectTarget(rule, target, context.layout);
    if (result.status === 'insert') {
      counts.insert += 1;
      console.log(`${STATUS_LABEL.insert} ${rule.id} → ${result.display}:${result.line}（放在定位句那一段的后面）`);
    } else if (result.status === 'replace') {
      counts.replace += 1;
      console.log(`${STATUS_LABEL.replace} ${rule.id} → ${result.display}:${result.line}（开始标记在这一行，块里的内容要换）`);
    } else if (result.status === 'ok') {
      counts.ok += 1;
      console.log(`${STATUS_LABEL.ok} ${rule.id} → ${result.display}:${result.line}（规则块已经和规则文件一样，不用动）`);
    } else {
      counts.error += 1;
      console.log(`${STATUS_LABEL.error} ${rule.id} → ${result.display}：${result.reason}`);
    }
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
      `会插入 ${counts.insert}，会替换 ${counts.replace}，没问题 ${counts.ok}，出错了 ${counts.error}；` +
      `候选 ${candidateCount} 个。`,
  );
  console.log('这次是试运行，一个文件也没有写。');

  process.exitCode = counts.error > 0 ? 1 : 0;
}

try {
  main();
} catch (error) {
  console.log(`${STATUS_LABEL.error} 意外错误：${error.message}`);
  process.exitCode = 1;
}
