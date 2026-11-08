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

function outputLines(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line !== '');
}

function linesStartingWith(stdout, word) {
  return outputLines(stdout).filter((line) => line.startsWith(word));
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
