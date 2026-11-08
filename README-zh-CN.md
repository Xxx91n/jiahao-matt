# jiahao-matt

<p align="center">
  <a href="README.md">English</a> | <b>中文</b>
</p>

一个小脚本，往已经装好的 [mattpocock/skills](https://github.com/mattpocock/skills)
里加我自己的规则。

改之前先把每一处要动的地方列出来；每个文件原来的换行符和 BOM 都保留；跑多少遍，
一条规则也只留一份。

## 为什么弄这个

mattpocock 的 skills 本身不错，但 grilling 和 domain modeling 会让 Agent 自己
造词，还顺手写进 `GLOSSARY.md`。造出来的词经常一股翻译腔，然后跟着后面的活一起
扩散。

两条规则只管这两个会出事的地方：

| 规则 | 加到哪 | 管什么 |
| --- | --- | --- |
| `glossary-gate` | `engineering/domain-modeling/SKILL.md` | 往 `GLOSSARY.md` 新写、改名、改定义之前，先把词、一句大白话解释、以及它替换掉的日常词摆给用户看，等用户点头 |
| `plain-grilling` | `productivity/grilling/SKILL.md` | 提问和推荐答案别写得像翻译过来的手册，要像人说话 |

两条规则都在 [`rules/`](rules/)，一条规则一个 Markdown 文件。文件头写明：动哪个
技能文件、拿哪句话当落脚点、建候选清单时盯哪个词。

## 要求

Node 20 或更新。没有别的依赖。

## 用法

```bash
# 先看，一个字节都不写
node inject-rules.mjs ~/.agents/skills/grill

# 看完没问题再写，写之前自动备份
node inject-rules.mjs ~/.agents/skills/grill --apply

# 这一次不动某个技能文件
node inject-rules.mjs ~/.agents/skills/grill --apply \
  --skip productivity/grilling/SKILL.md
```

Windows 下的安装位置一般是 `C:\Users\<你>\.agents\skills\grill`。

第一个参数是安装目录的根。脚本看根目录下有没有 `skills/` 文件夹，以此区分两种
布局：

- **已安装副本**：没有 `skills/` 文件夹，目标路径直接从根目录算。这就是
  `scripts/link-skills.sh` 装出来的那种平铺结构。
- **仓库克隆**：有 `skills/` 文件夹，所有目标路径都带上 `skills/` 前缀。

## 报告怎么看

每行开头是状态词：

| 状态词 | 意思 |
| --- | --- |
| `[会插入]` | 文件里还没有规则块，会在定位句那一段后面插进去 |
| `[会替换]` | 标记已经在了，但块里的文字和规则文件对不上，要换 |
| `[没问题]` | 块和规则文件一字不差，不用动 |
| `[跳过]` | 这一行被 `--skip` 点名了 |
| `[出错了]` | 有东西挡着，不敢写：规则文件头解析不了、目标不存在、两个目标指到同一个文件、路径中间有一段不是文件夹、定位句找不到或出现不止一次、标记不成对、目标是符号链接、路径跑到根目录外、文件读不了、或者字节不是 UTF-8 |
| `[候选]` | 别的文件提到了规则盯的词，但它不在目标清单里，所以不往里写 |

试运行时出现 `[出错了]`，退出码是 1。加 `--apply` 时，只要有一处 `[出错了]`，
整轮就一个文件也不写，备份文件夹也不建。

退出码：`0` 正常，`1` 规则文件、目标或定位句有问题，`2` 参数不对，
`3` 写文件失败（备份建不出来也算）。写失败会把已经写过的文件恢复原样。

## 重跑

插进去的块外面有一对标记：

```markdown
<!-- jiahao:glossary-gate:start -->
... 规则正文 ...
<!-- jiahao:glossary-gate:end -->
```

第二次跑会认出这对标记，报 `[没问题]`，不重写，也不建新的备份文件夹。改了规则
正文再跑，会报 `[会替换]`，只换块里的字，还是一条。

写文件用的是「先写临时文件、再改名」的办法，临时文件就在原文件旁边。原来的每一
行和开头的 BOM 都不动；插进去的块用这个文件里占多数的换行符，所以混着换行的文件
也只是多出一块，原有行不受影响。`--apply` 时，要改的文件会先复制到根目录下的
`jiahao-backup-<时间戳>/`。

## 加一个目标

改规则文件的头部，重复一段 target：

```markdown
target:
path: engineering/tdd/SKILL.md
after: When exploring the codebase, read `GLOSSARY.md` (if it exists) ...
position: after-paragraph
```

`after` 必须在目标文件里只匹配到一行。先不带 `--apply` 跑一遍，看清楚报告再写。

## 测试

```bash
npm test
```

测试会把样本技能复制到临时目录，然后把真正的命令行脚本当子进程跑。检查报告文字、
退出码、备份文件夹，还有磁盘上的字节。`test/fixtures/installed/` 里的样本就是真实
装好的技能文件，定位句来自上游，不是现编一份刚好能过的样例。

CI 用 Node 20 跑同一条命令。

往真正的安装目录写之前，先拿一份副本演练：

```bash
cp -r ~/.agents/skills/grill /tmp/grill-copy
node inject-rules.mjs /tmp/grill-copy            # 只看报告
node inject-rules.mjs /tmp/grill-copy --apply    # 写到副本里
node inject-rules.mjs /tmp/grill-copy --apply    # 第二次跑报 [没问题]
```

Windows 上不用 `cp -r`，拿资源管理器复制一份就行，三条命令照跑。第一次应该看到
两行 `[会插入]`，第三次看到两行 `[没问题]`，也不再冒出新的备份文件夹。

## 开源协议

[MIT](LICENSE)
