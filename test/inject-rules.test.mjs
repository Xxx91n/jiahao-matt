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
const CANDIDATE = 'engineering/tdd/SKILL.md';
const SENTENCE = 'When a term is resolved, update `GLOSSARY.md` right there.';
const MARKER_START = '<!-- jiahao:glossary-gate:start -->';
const MARKER_END = '<!-- jiahao:glossary-gate:end -->';
const BODY_START = "**A term is the user's decision.**";

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

function withoutInsertedBlock(text, eol) {
  const startAt = text.indexOf(MARKER_START);
  const endAt = text.indexOf(MARKER_END);
  assert.notEqual(startAt, -1, '应该有开始标记');
  assert.notEqual(endAt, -1, '应该有结束标记');
  assert.ok(endAt > startAt, '结束标记应该在开始标记后面');
  const removeFrom = startAt - 2 * eol.length;
  assert.ok(removeFrom >= 0, '插入的块前面应该有两个换行');
  return text.slice(0, removeFrom) + text.slice(endAt + MARKER_END.length);
}

function runApplyOnRewrittenTarget(t, rewrite) {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  rewrite(targetPath);
  const beforeBytes = fs.readFileSync(targetPath);
  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 1, result.stdout);
  assert.match(result.stdout, /备份在/);
  const afterBytes = fs.readFileSync(targetPath);
  const afterText = afterBytes.toString('utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '结束标记应该只有一个');
  return { beforeBytes, afterBytes, afterText };
}

const FIXTURE_TARGET_LINE = 62;
const FIXTURE_INSERT_LINE = 63;

test('已安装副本：报出布局和一个会插入的目标，文件一个字节都不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const before = snapshot(dir);

  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已安装副本/);

  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 1, result.stdout);
  assert.ok(inserts[0].includes(TARGET), result.stdout);

  const fixtureText = fs.readFileSync(path.join(dir, TARGET), 'utf8');
  const fixtureLines = fixtureText.split(/\r?\n/);
  assert.ok(fixtureLines[FIXTURE_TARGET_LINE - 1].includes(SENTENCE), '测试样本里的定位句应该在已知的行上');
  assert.ok(inserts[0].includes(`:${FIXTURE_INSERT_LINE}`), `期望行号 ${FIXTURE_INSERT_LINE}：${inserts[0]}`);

  assert.match(result.stdout, /小结/);
  assert.match(result.stdout, /试运行/);
  assert.match(result.stdout, /没有写/);
  assertSameFiles(before, snapshot(dir));
});

test('仓库克隆：根目录里有 skills/ 时按仓库布局扫描，路径带前缀', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir, { underSkills: true });
  const before = snapshot(dir);

  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /仓库克隆/);

  const inserts = linesStartingWith(result.stdout, '[会插入]');
  assert.equal(inserts.length, 1, result.stdout);
  assert.ok(inserts[0].includes(`skills/${TARGET}`), result.stdout);

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
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 0, result.stdout);
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
});

test('参数不对：退出码 2', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
});

test('--apply：插入一对标记和规则正文，块外每个字节都原样', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);
  const targetPath = path.join(dir, TARGET);
  const beforeBytes = fs.readFileSync(targetPath);
  const beforeText = beforeBytes.toString('utf8');
  const eol = beforeText.includes('\r\n') ? '\r\n' : '\n';

  const result = run(dir, '--apply');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(linesStartingWith(result.stdout, '[会插入]').length, 1, result.stdout);
  assert.match(result.stdout, /备份在/);

  const afterText = fs.readFileSync(targetPath, 'utf8');
  assert.equal(afterText.split(MARKER_START).length - 1, 1, '开始标记应该只有一个');
  assert.equal(afterText.split(MARKER_END).length - 1, 1, '结束标记应该只有一个');
  assert.ok(afterText.includes(BODY_START), '规则正文应该写进目标文件');

  const restored = withoutInsertedBlock(afterText, eol);
  assert.ok(Buffer.from(restored, 'utf8').equals(beforeBytes), '除了插入的块，其他字节必须原样');
});

test('--apply：第二次跑报 “没问题”，文件字节一个都不变', (t) => {
  const dir = makeTempDir(t);
  copyInstalledFixture(dir);

  const first = run(dir, '--apply');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const afterFirst = snapshot(dir);

  const second = run(dir, '--apply');
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(linesStartingWith(second.stdout, '[没问题]').length, 1, second.stdout);
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

test('--apply：带 BOM 的文件写完 BOM 还在最前面，去掉插入块后和输入逐字节相同', (t) => {
  const { beforeBytes: withBom, afterBytes, afterText } = runApplyOnRewrittenTarget(t, (targetPath) => {
    const original = fs.readFileSync(targetPath, 'utf8');
    fs.writeFileSync(targetPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(asLf(original))]));
  });
  assert.ok(!withBom.toString('utf8').includes('\r'), '测试输入应该是带 BOM 的纯 LF');
  assert.deepEqual([...afterBytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM 应该是最前面的三个字节');
  assert.ok(!(afterBytes[3] === 0xef && afterBytes[4] === 0xbb && afterBytes[5] === 0xbf), 'BOM 不该出现两次');
  assert.equal(afterText.split('\uFEFF').length - 1, 1, 'BOM 应该只有一个');
  assert.ok(!afterText.includes('\r'), '带 BOM 的 LF 文件里不该出现回车');
  assert.ok(
    Buffer.from(withoutInsertedBlock(afterText, '\n'), 'utf8').equals(withBom),
    '去掉插入块后必须和带 BOM 的输入一样',
  );
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
  assert.match(result.stdout, /不是文件夹/);
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
  '--apply：唯一的目标写不进去时退出 3，原文件不动，不留临时文件',
  { skip: process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0 },
  (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jiahao-matt-'));
    const target = path.join(base, 'target');
    copyInstalledFixture(target);
    const targetPath = path.join(target, TARGET);
    const beforeBytes = fs.readFileSync(targetPath);

    let restore;
    if (process.platform === 'win32') {
      fs.chmodSync(targetPath, 0o444);
      restore = () => fs.chmodSync(targetPath, 0o666);
    } else {
      fs.chmodSync(path.dirname(targetPath), 0o555);
      restore = () => fs.chmodSync(path.dirname(targetPath), 0o755);
    }
    t.after(() => {
      restore();
      fs.rmSync(base, { recursive: true, force: true });
    });

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

  let restore;
  if (process.platform === 'win32') {
    fs.chmodSync(secondPath, 0o444);
    restore = () => fs.chmodSync(secondPath, 0o666);
  } else {
    fs.chmodSync(path.dirname(secondPath), 0o555);
    restore = () => fs.chmodSync(path.dirname(secondPath), 0o755);
  }
  t.after(() => {
    restore();
    fs.rmSync(base, { recursive: true, force: true });
  });

  const result = runScript(path.join(runner, 'inject-rules.mjs'), target, '--apply');
  assert.equal(result.status, 3, result.stdout + result.stderr);
  assert.match(result.stdout, /\[出错了\]/);
  assert.match(result.stdout, /写文件失败/);
  assert.match(result.stdout, /恢复了原样|没恢复成功/);
  assert.ok(fs.readFileSync(firstPath).equals(firstBefore), '先写的文件应该恢复原样');
  assert.ok(fs.readFileSync(secondPath).equals(secondReady), '写不进去的文件应该一个字节都不变');
  assert.equal(backupDirs(target).length, 1, '写失败时备份应该还在');
});
