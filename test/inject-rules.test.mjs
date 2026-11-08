import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'inject-rules.mjs');
const INSTALLED_FIXTURE = path.join(HERE, 'fixtures', 'installed');
const TARGET = 'engineering/domain-modeling/SKILL.md';
const GRILLING_TARGET = 'productivity/grilling/SKILL.md';
const CANDIDATE = 'engineering/tdd/SKILL.md';
const SENTENCE = 'When a term is resolved, update `GLOSSARY.md` right there.';
const GRILLING_SENTENCE = 'Word each question so "yes" accepts your recommended answer.';
const MARKER_START = '<!-- jiahao:glossary-gate:start -->';
const MARKER_END = '<!-- jiahao:glossary-gate:end -->';
const GRILLING_MARKER_START = '<!-- jiahao:plain-grilling:start -->';
const GRILLING_MARKER_END = '<!-- jiahao:plain-grilling:end -->';
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const BODY_START = "**A term is the user's decision.**";
const GRILLING_BODY_START = '**Write the way the user talks.**';

function makeTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiahao-matt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function copyInstalledFixture(dir, { underSkills = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const destination = underSkills ? path.join(dir, 'skills') : dir;
  fs.cpSync(INSTALLED_FIXTURE, destination, { recursive: true });
}

function snapshot(dir) {
  const files = new Map();
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    files.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
  }
  return files;
}

function assertSameFiles(before, after) {
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), '文件列表变了');
  for (const [name, bytes] of before) {
    assert.ok(after.get(name).equals(bytes), `${name} 的字节变了`);
  }
}

function filesWithoutBackups(files) {
  const kept = new Map();
  for (const [name, bytes] of files) {
    if (!name.startsWith('jiahao-backup-')) kept.set(name, bytes);
  }
  return kept;
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function makeIsolatedRunner(t) {
  const base = makeTempDir(t);
  const target = path.join(base, 'target');
  copyInstalledFixture(target);
  const runner = path.join(base, 'runner');
  fs.mkdirSync(runner, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(runner, 'inject-rules.mjs'));
  fs.cpSync(path.join(HERE, '..', 'rules'), path.join(runner, 'rules'), { recursive: true });
  return {
    target,
    script: path.join(runner, 'inject-rules.mjs'),
    ruleFile: path.join(runner, 'rules', 'glossary-gate.md'),
  };
}

function runScript(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function backupDirs(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('jiahao-backup-'))
    .map((entry) => path.join(dir, entry.name));
}

function outputLines(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line !== '');
}

function linesStartingWith(stdout, word) {
  return outputLines(stdout).filter((line) => line.startsWith(word));
}

function asCrlf(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

function asLf(text) {
  return text.replace(/\r\n/g, '\n');
}

function loneLfCount(text) {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n' && text[i - 1] !== '\r') count += 1;
  }
  return count;
}

function withoutBlock(text, startMarker, endMarker, eol) {
  const startAt = text.indexOf(startMarker);
  const endAt = text.indexOf(endMarker);
  assert.notEqual(startAt, -1, '应该有开始标记');
  assert.notEqual(endAt, -1, '应该有结束标记');
  assert.ok(endAt > startAt, '结束标记应该在开始标记后面');
  const removeFrom = startAt - 2 * eol.length;
  assert.ok(removeFrom >= 0, '插入的块前面应该有两个换行');
  return text.slice(0, removeFrom) + text.slice(endAt + endMarker.length);
}

function withoutInsertedBlock(text, eol) {
  return withoutBlock(text, MARKER_START, MARKER_END, eol);
}

function runApplyOnRewrittenTarget(t, rewrite) {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  rewrite(targetPath);
  const beforeBytes = fs.readFileSync(targetPath);
  const beforeIno = fs.statSync(targetPath).ino;
  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 2, result.stdout);
  assert.match(result.stdout, /备份在/);
  const afterBytes = fs.readFileSync(targetPath);
  const afterIno = fs.statSync(targetPath).ino;
  if (beforeIno !== 0 && afterIno !== 0) {
    assert.notEqual(afterIno, beforeIno, '目标文件应该被整个换掉，而不是原地改写');
  }
  const afterText = afterBytes.toString('utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '结束标记应该只有一个');
  return { beforeBytes, afterBytes, afterText };
}

function protectFromWrites(targetPath) {
  if (process.platform === 'win32') {
    fs.chmodSync(targetPath, 0o444);
    return () => fs.chmodSync(targetPath, 0o666);
  }
  fs.chmodSync(path.dirname(targetPath), 0o555);
  return () => fs.chmodSync(path.dirname(targetPath), 0o755);
}

const FIXTURE_TARGET_LINE = 62;
const FIXTURE_INSERT_LINE = 63;
const GRILLING_FIXTURE_TARGET_LINE = 24;
const GRILLING_FIXTURE_INSERT_LINE = 25;

test('已安装副本：两条规则各报一个会插入的目标，文件一个字节都不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const before = snapshot(dir);

  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已安装副本/);

  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 2, result.stdout);

  const domainInsert = inserts.find((line) => line.includes(TARGET));
  assert.ok(domainInsert, result.stdout);
  const fixtureText = fs.readFileSync(path.join(dir, TARGET), 'utf8');
  const fixtureLines = fixtureText.split(/\r?\n/);
  assert.ok(fixtureLines[FIXTURE_TARGET_LINE - 1].includes(SENTENCE), '测试样本里的定位句应该在已知的行上');
  assert.ok(domainInsert.includes(`:${FIXTURE_INSERT_LINE}`), `期望行号 ${FIXTURE_INSERT_LINE}：${domainInsert}`);

  const grillingInsert = inserts.find((line) => line.includes(GRILLING_TARGET));
  assert.ok(grillingInsert, result.stdout);
  const grillingText = fs.readFileSync(path.join(dir, GRILLING_TARGET), 'utf8');
  const grillingLines = grillingText.split(/\r?\n/);
  assert.ok(
    grillingLines[GRILLING_FIXTURE_TARGET_LINE - 1].includes(GRILLING_SENTENCE),
    '测试样本里的定位句应该在已知的行上',
  );
  assert.ok(
    grillingInsert.includes(`:${GRILLING_FIXTURE_INSERT_LINE}`),
    `期望行号 ${GRILLING_FIXTURE_INSERT_LINE}：${grillingInsert}`,
  );

  assert.match(result.stdout, /小结/);
  assert.match(result.stdout, /试运行/);
  assert.match(result.stdout, /没有写/);
  assertSameFiles(before, snapshot(dir));
});

test('仓库克隆：根目录里有 skills/ 时按仓库布局扫描，两条规则的路径都带前缀', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir, { underSkills: true });
  const before = snapshot(dir);

  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /仓库克隆/);

  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 2, result.stdout);
  assert.ok(inserts.some((line) => line.includes(`skills/${TARGET}`)), result.stdout);
  assert.ok(inserts.some((line) => line.includes(`skills/${GRILLING_TARGET}`)), result.stdout);

  assertSameFiles(before, snapshot(dir));
});

test('删掉定位句：报出 “出错了”，退出码 1，文件一个字节都不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  const targetPath = path.join(dir, TARGET);
  const original = fs.readFileSync(targetPath, 'utf8');
  const edited = original.replace(SENTENCE, 'When a term is resolved, update the glossary right there.');
  assert.notEqual(edited, original, '测试样本应该删得掉定位句');
  fs.writeFileSync(targetPath, edited);

  const before = snapshot(dir);
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 1, result.stdout);
  assert.ok(inserts.every((line) => !line.includes(TARGET)), result.stdout);
  assert.ok(inserts.some((line) => line.includes(GRILLING_TARGET)), result.stdout);
  assert.match(result.stdout, /\[出错了\]/);
  assert.ok(result.stdout.includes(TARGET));
  assertSameFiles(before, snapshot(dir));
});

test('目标文件不存在：报出 “出错了”，退出码 1，别的文件不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  fs.rmSync(path.join(dir, TARGET));
  const before = snapshot(dir);

  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.ok(result.stdout.includes(TARGET));
  assertSameFiles(before, snapshot(dir));
});

test('候选清单：提到 watch 词但不是目标的文件会上报，目标自己不会重复出现', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const candidates = linesStartingWith(result.stdout, '[候选]');
  assert.ok(candidates.some((line) => line.includes(CANDIDATE)), result.stdout);
  assert.ok(candidates.some((line) => line.includes('GLOSSARY.md')), result.stdout);
  assert.ok(!candidates.some((line) => line.includes(TARGET)), result.stdout);
  assert.ok(!candidates.some((line) => line.includes(GRILLING_TARGET)), result.stdout);
});

test('候选文件加进规则的目标清单后，下一轮变成 [会插入]，不再当候选', (t) => {
  const isolated = makeIsolatedRunner(t);

  const anchor =
    "When exploring the codebase, read `GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.";
  const candidateText = fs.readFileSync(path.join(isolated.target, CANDIDATE), 'utf8');
  assert.ok(candidateText.includes(anchor), '候选文件里应该有能当定位句的那一段');

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    `\ntarget:\npath: ${CANDIDATE}\nafter: ${anchor}\nposition: after-paragraph\n-->`,
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进这个目标');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const before = snapshot(isolated.target);
  const result = runScript(isolated.script, isolated.target);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.ok(inserts.some((line) => line.includes(CANDIDATE)), result.stdout);
  const candidates = linesStartingWith(result.stdout, '[候选]');
  assert.ok(!candidates.some((line) => line.includes(CANDIDATE)), result.stdout);
  assertSameFiles(before, snapshot(isolated.target));
});

test('参数不对：退出码 2', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
});

test('--skip 后面没给路径：退出码 2', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const result = spawnSync(process.execPath, [SCRIPT, dir, '--skip'], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
});

test('--skip：点名的目标一个字节不动，别的目标照常写入，退出 0', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const before = filesWithoutBackups(snapshot(dir));
  const targetPath = path.join(dir, TARGET);
  const skippedBefore = fs.readFileSync(targetPath);

  const result = run(dir, '--apply', '--skip', TARGET);
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const skipped = linesStartingWith(result.stdout, '[跳过]');
  assert.equal(skipped.length, 1, result.stdout);
  assert.ok(skipped[0].includes(TARGET), result.stdout);
  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 1, result.stdout);
  assert.ok(inserts[0].includes(GRILLING_TARGET), result.stdout);

  assert.ok(fs.readFileSync(targetPath).equals(skippedBefore), '被跳过的文件应该一个字节都不变');

  const after = filesWithoutBackups(snapshot(dir));
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), '文件列表变了');
  for (const [name, bytes] of before) {
    if (name === GRILLING_TARGET) {
      assert.ok(!after.get(name).equals(bytes), '没被跳过的 grilling 文件应该被写入');
    } else {
      assert.ok(after.get(name).equals(bytes), `${name} 不该变`);
    }
  }
});

test('--skip 写两次：两个目标都跳过，退出 0，也不建备份', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const before = snapshot(dir);

  const result = run(dir, '--apply', '--skip', TARGET, '--skip', GRILLING_TARGET);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[跳过]').length, 2, result.stdout);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 0, result.stdout);
  assert.equal(backupDirs(dir).length, 0, '全部跳过时不该有备份文件夹');
  assertSameFiles(before, snapshot(dir));
});

test('--skip：路径对不上任何目标时只提示，不拦这次写入', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  const result = run(dir, '--apply', '--skip', 'engineering/no-such/SKILL.md');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /没有跳过任何东西/);
  assert.ok(!result.stdout.includes('[出错了]'), result.stdout);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 2, result.stdout);
  assert.equal(backupDirs(dir).length, 1, '正常写入时应该有备份');

  for (const [target, marker] of [
    [TARGET, MARKER_START],
    [GRILLING_TARGET, GRILLING_MARKER_START],
  ]) {
    const text = fs.readFileSync(path.join(dir, target), 'utf8');
    assert.equal(text.split(marker).length - 1, 1, `${target} 应该被写入`);
  }
});

test('--skip：同一个目标的两种写法一起给，也不会报没跳过', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  const skippedBefore = fs.readFileSync(targetPath);

  const result = run(dir, '--apply', '--skip', `./${TARGET}`, '--skip', TARGET);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[跳过]').length, 1, result.stdout);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 1, result.stdout);
  assert.ok(!result.stdout.includes('没有跳过任何东西'), result.stdout);
  assert.ok(fs.readFileSync(targetPath).equals(skippedBefore), '被跳过的文件应该一个字节都不变');
});

test('--skip：仓库布局下认带 skills/ 前缀的路径', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir, { underSkills: true });
  const targetPath = path.join(dir, 'skills', TARGET);
  const skippedBefore = fs.readFileSync(targetPath);

  const result = run(dir, '--apply', '--skip', `skills/${TARGET}`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[跳过]').length, 1, result.stdout);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 1, result.stdout);
  assert.ok(fs.readFileSync(targetPath).equals(skippedBefore), '被跳过的文件应该一个字节都不变');

  const grillingText = fs.readFileSync(path.join(dir, 'skills', GRILLING_TARGET), 'utf8');
  assert.equal(grillingText.split(GRILLING_MARKER_START).length - 1, 1, '没被跳过的文件应该被写入');
});

test('--apply：每条规则用自己的 id 和正文写进自己的文件，块外每个字节都原样', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  const grillingPath = path.join(dir, GRILLING_TARGET);
  const beforeBytes = fs.readFileSync(targetPath);
  const grillingBeforeBytes = fs.readFileSync(grillingPath);
  const beforeText = beforeBytes.toString('utf8');
  const eol = beforeText.includes('\r\n') ? '\r\n' : '\n';
  const grillingEol = grillingBeforeBytes.toString('utf8').includes('\r\n') ? '\r\n' : '\n';

  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 2, result.stdout);
  assert.match(result.stdout, /备份在/);

  const afterText = fs.readFileSync(targetPath, 'utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '结束标记应该只有一个');
  assert.ok(afterText.includes(BODY_START), 'glossary-gate 的正文应该写进目标文件');
  assert.ok(!afterText.includes(GRILLING_MARKER_START), 'glossary-gate 的文件里不该有 plain-grilling 的标记');

  const restored = withoutInsertedBlock(afterText, eol);
  assert.ok(Buffer.from(restored, 'utf8').equals(beforeBytes), '除了插入的块，其他字节必须原样');

  const grillingText = fs.readFileSync(grillingPath, 'utf8');
  assert.equal(grillingText.split(GRILLING_MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(grillingText.split(GRILLING_MARKER_END).length - 1, 1, '结束标记应该只有一个');
  assert.ok(grillingText.includes(GRILLING_BODY_START), 'plain-grilling 的正文应该写进目标文件');
  assert.ok(!grillingText.includes(MARKER_START), 'grilling 的文件里不该有 glossary-gate 的标记');

  const restoredGrilling = withoutBlock(grillingText, GRILLING_MARKER_START, GRILLING_MARKER_END, grillingEol);
  assert.ok(
    Buffer.from(restoredGrilling, 'utf8').equals(grillingBeforeBytes),
    '除了插入的块，其他字节必须原样',
  );
});

test('--apply：第二次跑报 “没问题”，文件字节一个都不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  const first = run(dir, '--apply');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const afterFirst = snapshot(dir);

  const second = run(dir, '--apply');
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(linesStartingWith(second.stdout, '[没问题]').length, 2, second.stdout);
  assertSameFiles(afterFirst, snapshot(dir));
});

test('--apply：规则正文改了，重跑替换旧块，标记还是一对', (t) => {
  const isolated = makeIsolatedRunner(t);

  const first = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(first.status, 0, first.stdout + first.stderr);

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    'answer decides the term, not you.',
    'answer decides the term, and nobody else.',
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该改得动');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const second = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(linesStartingWith(second.stdout, '[会替换]').length, 1, second.stdout);

  const afterText = fs.readFileSync(path.join(isolated.target, TARGET), 'utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '替换后开始标记还是一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '替换后结束标记还是一个');
  assert.ok(afterText.includes('and nobody else.'), '新正文应该在文件里');
  assert.ok(!afterText.includes('answer decides the term, not you.'), '旧正文应该被换掉');
});

test('--apply：替换旧块时 CRLF 和 BOM 也不变，去掉块后和最初输入逐字节相同', (t) => {
  const isolated = makeIsolatedRunner(t);
  const targetPath = path.join(isolated.target, TARGET);
  const inputText = fs.readFileSync(targetPath, 'utf8');
  const withBom = Buffer.concat([BOM, Buffer.from(asCrlf(inputText))]);
  fs.writeFileSync(targetPath, withBom);

  const first = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(linesStartingWith(first.stdout, '[会插入]').length, 2, first.stdout);

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    'answer decides the term, not you.',
    'answer decides the term, and nobody else.',
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该改得动');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const second = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(linesStartingWith(second.stdout, '[会替换]').length, 1, second.stdout);
  assert.match(second.stdout, /备份在/);

  const afterBytes = fs.readFileSync(targetPath);
  const afterText = afterBytes.toString('utf8');
  assert.deepEqual([...afterBytes.subarray(0, 3)], [...BOM], 'BOM 应该还在最前面');
  assert.ok(!afterBytes.subarray(3, 6).equals(BOM), 'BOM 不该出现两次');
  assert.equal(afterText.split('\uFEFF').length - 1, 1, 'BOM 应该只有一个');
  assert.equal(loneLfCount(afterText), 0, 'CRLF 文件里不该出现单独的 LF');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '替换后开始标记还是一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '替换后结束标记还是一个');
  assert.ok(afterText.includes('and nobody else.'), '新正文应该在文件里');
  assert.ok(
    Buffer.from(withoutInsertedBlock(afterText, '\r\n'), 'utf8').equals(withBom),
    '去掉块后必须和最初输入逐字节相同',
  );
});

test('--apply：改过的文件先复制进时间戳备份文件夹', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  const beforeBytes = fs.readFileSync(targetPath);

  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const backups = backupDirs(dir);
  assert.equal(backups.length, 1, `应该正好有一个备份文件夹：${backups.join(', ')}`);
  const copyPath = path.join(backups[0], TARGET);
  assert.ok(fs.existsSync(copyPath), `备份里应该有 ${TARGET}`);
  assert.ok(fs.readFileSync(copyPath).equals(beforeBytes), '备份应该是改动前的原样字节');
});

test('--apply：仓库克隆下按带 skills/ 前缀的路径写入和备份', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir, { underSkills: true });
  const targetPath = path.join(dir, 'skills', TARGET);
  const beforeBytes = fs.readFileSync(targetPath);

  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);

  const afterText = fs.readFileSync(targetPath, 'utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '结束标记应该只有一个');

  const backups = backupDirs(dir);
  assert.equal(backups.length, 1, `应该正好有一个备份文件夹：${backups.join(', ')}`);
  const copyPath = path.join(backups[0], 'skills', TARGET);
  assert.ok(fs.existsSync(copyPath), `备份里应该有 skills/${TARGET}`);
  assert.ok(fs.readFileSync(copyPath).equals(beforeBytes), '备份应该是改动前的原样字节');
});

test('--apply：CRLF 文件只加 CRLF 行，去掉插入块后和输入逐字节相同', (t) => {
  const { beforeBytes, afterText } = runApplyOnRewrittenTarget(t, (targetPath) => {
    fs.writeFileSync(targetPath, asCrlf(fs.readFileSync(targetPath, 'utf8')));
  });
  const beforeText = beforeBytes.toString('utf8');
  assert.ok(beforeText.includes('\r\n'), '测试输入应该先变成纯 CRLF');
  assert.equal(loneLfCount(beforeText), 0, '测试输入里不该有单独的 LF');
  assert.equal(loneLfCount(afterText), 0, 'CRLF 文件里不该出现单独的 LF');
  assert.ok(
    Buffer.from(withoutInsertedBlock(afterText, '\r\n'), 'utf8').equals(beforeBytes),
    '去掉插入块后必须和 CRLF 输入一样',
  );
});

test('--apply：LF 文件只加 LF 行，一个回车都不多，去掉插入块后和输入逐字节相同', (t) => {
  const { beforeBytes, afterText } = runApplyOnRewrittenTarget(t, (targetPath) => {
    fs.writeFileSync(targetPath, asLf(fs.readFileSync(targetPath, 'utf8')));
  });
  assert.ok(!beforeBytes.toString('utf8').includes('\r'), '测试输入应该是纯 LF');
  assert.ok(!afterText.includes('\r'), 'LF 文件里不该出现回车');
  assert.ok(
    Buffer.from(withoutInsertedBlock(afterText, '\n'), 'utf8').equals(beforeBytes),
    '去掉插入块后必须和 LF 输入一样',
  );
});

test('--apply：带 BOM 的文件写完 BOM 还在最前面，去掉插入块后和输入逐字节相同', async (t) => {
  const variants = [
    { label: 'LF', eol: '\n', toText: asLf },
    { label: 'CRLF', eol: '\r\n', toText: asCrlf },
  ];
  for (const variant of variants) {
    await t.test(variant.label, (st) => {
      const { beforeBytes: withBom, afterBytes, afterText } = runApplyOnRewrittenTarget(st, (targetPath) => {
        const original = fs.readFileSync(targetPath, 'utf8');
        fs.writeFileSync(
          targetPath,
          Buffer.concat([BOM, Buffer.from(variant.toText(original))]),
        );
      });
      assert.deepEqual([...afterBytes.subarray(0, 3)], [...BOM], 'BOM 应该是最前面的三个字节');
      assert.ok(!afterBytes.subarray(3, 6).equals(BOM), 'BOM 不该出现两次');
      assert.equal(afterText.split('\uFEFF').length - 1, 1, 'BOM 应该只有一个');
      if (variant.eol === '\n') {
        assert.ok(!afterText.includes('\r'), '带 BOM 的 LF 文件里不该出现回车');
      } else {
        assert.equal(loneLfCount(afterText), 0, '带 BOM 的 CRLF 文件里不该出现单独的 LF');
      }
      assert.ok(
        Buffer.from(withoutInsertedBlock(afterText, variant.eol), 'utf8').equals(withBom),
        `去掉插入块后必须和带 BOM 的 ${variant.label} 输入一样`,
      );
    });
  }
});

test('--apply：一个目标找不到定位句时，所有目标都不写', (t) => {
  const isolated = makeIsolatedRunner(t);

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    '\ntarget:\npath: engineering/tdd/SKILL.md\nafter: This sentence is not in the tdd file.\nposition: after-paragraph\n-->',
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进第二个目标');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const before = snapshot(isolated.target);
  const result = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  assertSameFiles(before, snapshot(isolated.target));
});

test('--apply：同一个文件被两个目标块指到，退出 1，一个字也不写', (t) => {
  const isolated = makeIsolatedRunner(t);

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    `\ntarget:\npath: ${TARGET}\nafter: ${SENTENCE}\nposition: after-paragraph\n-->`,
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进重复目标');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const before = snapshot(isolated.target);
  const result = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  assertSameFiles(before, snapshot(isolated.target));
});

test('--apply：目标文件里有非 UTF-8 字节时，报错且一个字也不写', (t) => {
  const isolated = makeIsolatedRunner(t);
  const targetPath = path.join(isolated.target, TARGET);
  const before = fs.readFileSync(targetPath);
  fs.writeFileSync(targetPath, Buffer.concat([before, Buffer.from([0xff])]));

  const changed = fs.readFileSync(targetPath);
  const result = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.match(result.stdout, /UTF-8/);
  assert.ok(fs.readFileSync(targetPath).equals(changed), '目标文件应该一个字节都不变');
  assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
});

test('--apply：目标路径中有一段不是文件夹时报错，这次全部不写', (t) => {
  const isolated = makeIsolatedRunner(t);
  const notDir = path.join(isolated.target, 'engineering', 'domain-modeling', 'not-a-dir');
  fs.writeFileSync(notDir, 'x\n');

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    `\ntarget:\npath: engineering/domain-modeling/not-a-dir/SKILL.md\nafter: ${SENTENCE}\nposition: after-paragraph\n-->`,
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进坏掉的目标路径');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const before = snapshot(isolated.target);
  const result = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.match(result.stdout, /中间有一段不是文件夹/);
  assert.match(result.stdout, /not-a-dir/);
  assert.match(result.stdout, /\[会插入\]/, '另一个正常目标应该照样报出来');
  assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  assertSameFiles(before, snapshot(isolated.target));
});

test('--apply：目标路径跑到目标根目录外面时报错，谁都不写', (t) => {
  const isolated = makeIsolatedRunner(t);
  const base = path.dirname(isolated.target);
  const outside = path.join(base, 'outside.md');
  fs.writeFileSync(outside, `${SENTENCE}\n`);
  const outsideBefore = fs.readFileSync(outside);

  const originalRule = fs.readFileSync(isolated.ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    `\ntarget:\npath: ../outside.md\nafter: ${SENTENCE}\nposition: after-paragraph\n-->`,
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进越界目标');
  fs.writeFileSync(isolated.ruleFile, changedRule);

  const before = snapshot(isolated.target);
  const result = runScript(isolated.script, isolated.target, '--apply');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.match(result.stdout, /目标根目录外面/);
  assert.ok(fs.readFileSync(outside).equals(outsideBefore), '根目录外的文件应该一个字节都不变');
  assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  assertSameFiles(before, snapshot(isolated.target));
});

test(
  '--apply：目标是根目录外的符号链接时报错，链接目标不变',
  { skip: process.platform === 'win32' },
  (t) => {
    const isolated = makeIsolatedRunner(t);
    const outside = path.join(path.dirname(isolated.target), 'linked-outside.md');
    fs.writeFileSync(outside, `${SENTENCE}\n`);
    const outsideBefore = fs.readFileSync(outside);

    const targetPath = path.join(isolated.target, TARGET);
    fs.rmSync(targetPath);
    fs.symlinkSync(outside, targetPath);

    const result = runScript(isolated.script, isolated.target, '--apply');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /\[出错了\]/);
    assert.match(result.stdout, /目标根目录外面/);
    assert.ok(fs.readFileSync(outside).equals(outsideBefore), '链接到根目录外的文件应该一个字节都不变');
    assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  },
);

test(
  '--apply：目标是符号链接时报错，链接指向的文件不变',
  { skip: process.platform === 'win32' },
  (t) => {
    const isolated = makeIsolatedRunner(t);
    const targetPath = path.join(isolated.target, TARGET);
    const linked = path.join(isolated.target, 'engineering', 'domain-modeling', 'linked.md');
    fs.renameSync(targetPath, linked);
    fs.symlinkSync(linked, targetPath);
    const linkedBefore = fs.readFileSync(linked);

    const result = runScript(isolated.script, isolated.target, '--apply');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /\[出错了\]/);
    assert.match(result.stdout, /符号链接/);
    assert.ok(fs.lstatSync(targetPath).isSymbolicLink(), '符号链接本身应该还在');
    assert.ok(fs.readFileSync(linked).equals(linkedBefore), '链接指向的文件应该一个字节都不变');
    assert.equal(backupDirs(isolated.target).length, 0, '出错时不该有备份文件夹');
  },
);

test(
  '--apply：写入后目标文件保留原来的权限，备份固定为 600',
  { skip: process.platform === 'win32' },
  (t) => {
    const dir = makeTempDir(t);
    copyInstalledFixture(dir);
    const targetPath = path.join(dir, TARGET);
    fs.chmodSync(targetPath, 0o600);

    const result = run(dir, '--apply');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.statSync(targetPath).mode & 0o777, 0o600, '目标文件的权限应该保持 600');

    const backups = backupDirs(dir);
    assert.equal(backups.length, 1, `应该正好有一个备份文件夹：${backups.join(', ')}`);
    assert.equal(fs.statSync(backups[0]).mode & 0o777, 0o700, '备份文件夹的权限应该是 700');
    const copyPath = path.join(backups[0], TARGET);
    assert.equal(fs.statSync(copyPath).mode & 0o777, 0o600, '备份文件的权限应该固定为 600');
  },
);

test(
  '--apply：目标写不进去时退出 3，原文件不动，不留临时文件',
  { skip: process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0 },
  (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jiahao-matt-'));
    const target = path.join(base, 'target');
    copyInstalledFixture(target);
    const targetPath = path.join(target, TARGET);
    const beforeBytes = fs.readFileSync(targetPath);

    let restore = () => {};
    t.after(() => {
      restore();
      fs.rmSync(base, { recursive: true, force: true });
    });
    restore = protectFromWrites(targetPath);

    const result = run(target, '--apply');
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stdout, /\[出错了\]/);
    assert.match(result.stdout, /写文件失败/);
    assert.ok(fs.readFileSync(targetPath).equals(beforeBytes), '原文件应该一个字节都不变');
    const leftovers = fs
      .readdirSync(path.dirname(targetPath))
      .filter((name) => name.includes('.jiahao-'));
    assert.deepEqual(leftovers, [], '临时文件不该留在目标文件夹里');
    assert.equal(backupDirs(target).length, 1, '写失败时备份应该还在');
  },
);

test(
  '--apply：第二个文件写不进去时退出 3，先写的文件恢复原样',
  { skip: process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0 },
  (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jiahao-matt-'));
  const target = path.join(base, 'target');
  copyInstalledFixture(target);
  const runner = path.join(base, 'runner');
  fs.mkdirSync(runner, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(runner, 'inject-rules.mjs'));
  fs.cpSync(path.join(HERE, '..', 'rules'), path.join(runner, 'rules'), { recursive: true });

  const ruleFile = path.join(runner, 'rules', 'glossary-gate.md');
  const originalRule = fs.readFileSync(ruleFile, 'utf8').replace(/\r\n/g, '\n');
  const changedRule = originalRule.replace(
    '\n-->',
    `\ntarget:\npath: ${CANDIDATE}\nafter: ${SENTENCE}\nposition: after-paragraph\n-->`,
  );
  assert.notEqual(changedRule, originalRule, '测试规则文件应该加得进第二个目标');
  fs.writeFileSync(ruleFile, changedRule);

  const secondPath = path.join(target, CANDIDATE);
  const secondBefore = fs.readFileSync(secondPath);
  const secondText = secondBefore.toString('utf8');
  const eol = secondText.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(secondPath, Buffer.from(`${secondText}${eol}${SENTENCE}${eol}`, 'utf8'));
  const secondReady = fs.readFileSync(secondPath);

  const firstPath = path.join(target, TARGET);
  const firstBefore = fs.readFileSync(firstPath);

  let restore = () => {};
  t.after(() => {
    restore();
    fs.rmSync(base, { recursive: true, force: true });
  });
  restore = protectFromWrites(secondPath);

  const result = runScript(path.join(runner, 'inject-rules.mjs'), target, '--apply');
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.match(result.stdout, /写文件失败/);
  assert.match(result.stdout, /恢复了原样|没恢复成功/);
  assert.ok(fs.readFileSync(firstPath).equals(firstBefore), '先写的文件应该恢复原样');
  assert.ok(fs.readFileSync(secondPath).equals(secondReady), '写不进去的文件应该一个字节都不变');
  assert.equal(backupDirs(target).length, 1, '写失败时备份应该还在');
});
