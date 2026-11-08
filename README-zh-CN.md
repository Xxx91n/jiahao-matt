<h1 align="center">jiahao-matt</h1>

<p align="center">
  <a href="README.md">English</a> | <b>中文</b>
</p>

一个小脚本，往已经装好的 [mattpocock/skills](https://github.com/mattpocock/skills)
里加防止 AI 变成 [jiahao](https://github.com/Xxx91n/jiahao) 的规则。

改之前会把每一处要动的地方列出来

## 为什么弄这个

在使用 mattpocock 的 skills 时，如果你不懂得做约束， grilling 和 domain modeling 会让 Agent 自己
造垃圾词，写进 `GLOSSARY.md`。造出来的词经常一股翻译腔，后面越做越拉胯。

现有规则：

| 规则 | 加哪 | 管啥 |
| --- | --- | --- |
| `glossary-gate` | `engineering/domain-modeling/SKILL.md` | 往 `GLOSSARY.md` 新写、改名、改定义之前，先把词用一句大白话解释、然后把它替换掉的日常词摆给人看，等人同意 |
| `plain-grilling` | `productivity/grilling/SKILL.md` | 提问和推荐答案别写得像翻译过来的手册，要像人说话 |

> 规则放在 [`rules/`](rules/)，一条规则一个 Markdown 文件。

## 要求

Node 20.1及以上

## 用法

```bash
# 先看
node inject-rules.mjs <mattpocock skills安装位置>

# 看完没问题再写，写之前自动备份
node inject-rules.mjs <mattpocock skills安装位置> --apply

# 排除你不想更改的部分
node inject-rules.mjs <mattpocock skills安装位置> --apply \
  --skip productivity/grilling/SKILL.md
```

## 排障

每行开头是状态词：

| 状态词 | 意思 |
| --- | --- |
| `[会插入]` | 文件里还没有规则块，会在定位句那一段后面插进去 |
| `[会替换]` | 标记已经在了，但块里的文字和规则文件对不上，要换 |
| `[没问题]` | 块和规则文件一字不差，不用动 |
| `[跳过]` | 这一行被 `--skip` 点名了 |
| `[出错了]` | 有东西挡着，不敢写：规则文件头解析不了、目标不存在、两个目标指到同一个文件、路径中间有一段不是文件夹、定位句找不到或出现不止一次、标记不成对、目标是符号链接、路径跑到根目录外、文件读不了、或者字节不是 UTF-8 |
| `[候选]` | 别的文件提到了规则盯的词，但它不在目标清单里，所以不往里写 |

- 写之前检查出的 `[出错了]`，退出码是 1。加 `--apply` 时，只要有一处这种检查错误，
整轮就一个文件也不写，备份文件夹也不会建。
- 写到一半出的错退出码是 3：备份出错时目标
文件一个也不写，但备份文件夹可能已经建了一半；写失败会把已经写过的文件恢复原样；
要是恢复本身也失败，就用 `jiahao-backup-<时间戳>/` 里的备份还原。
- 退出码：`0` 正常，`1` 规则文件、目标或定位句有问题，`2` 参数不对，
`3` 写文件失败（备份建不出来也算）。写失败会把已经写过的文件恢复原样。

## 重跑

插进去的块外面有一对标记：

```markdown
<!-- jiahao:glossary-gate:start -->
... 规则正文 ...
<!-- jiahao:glossary-gate:end -->
```

- 第二次跑会认出这对标记，报 `[没问题]`，不重写，也不会建新的备份文件夹。改了规则正文再跑，会报 `[会替换]`，只换块里的字，也就一条。

- 写文件用的是「先写临时文件、再改名」的办法，临时文件就在原文件旁边。原来的每一行和开头的 BOM 都不动；插进去的块用这个文件里占多数的换行符，所以混着换行的文件
也只是多出一块，原有行不受影响。

- `--apply` 时，要改的文件会先复制到根目录下的
`jiahao-backup-<时间戳>/`。

## 如何自己增加要修改md

改规则文件的头部，重复一段 target：

```markdown
target:
path: engineering/tdd/SKILL.md
after: When exploring the codebase, read `GLOSSARY.md` (if it exists) ...
position: after-paragraph
```

`after` 必须在目标文件里只匹配到一行。先不带 `--apply` 跑一遍，看清楚结果再写。

## 测试

```bash
npm test
```

测试会把样本技能复制到临时目录，然后把真正的命令行脚本当子进程跑，并检查报告文字、
退出码、备份文件夹，还有磁盘上的字节。`test/fixtures/installed/` 里放着样本技能。

往真正的安装目录写之前，可以先用副本测一下：

```bash
cp -r ~/.agents/skills/matt /tmp/matt-copy
node inject-rules.mjs /tmp/matt-copy            # 只看报告
node inject-rules.mjs /tmp/matt-copy --apply    # 写到副本里
node inject-rules.mjs /tmp/matt-copy --apply    # 第二次跑报 [没问题]
```

## 开源协议

[MIT](LICENSE)。测试样本是从
[mattpocock/skills](https://github.com/mattpocock/skills) 复制过来的文件，它的 MIT
声明在 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
