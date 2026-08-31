# @puwenhui/dsh-email

DSH 邮件助手插件：**IMAP 同步 + 本地全文索引（SQLite FTS5，中文可用）+ 会话线程归并 + 10 个模型工具 + 邮箱配置卡 + 重要新邮件提醒**。

定位：在 DSH 对话里**查邮件、找附件、发回复、收提醒**；邮件的日常浏览与整理仍交给 Foxmail 等邮箱客户端，本插件不提供（也不做）删除等破坏性操作。

> 普通用户请阅读 **[USAGE.zh.md](./USAGE.zh.md)** 使用帮助（含全部对话用例）。

## 版本要求

- **DSH ≥ 0.1.2-alpha 系列**（依赖该线的 `ctx.settings.installSection` 设置卡机制与客户端模块基线；在 0.1.2-alpha.2 上开发与验证）。rc.7/rc.8 老宿主不保证兼容。

## 安装

```sh
dsh plugin --profile web add @puwenhui/dsh-email
```

安装后自动进入 profile 插件层（配置卡与页面能力随 `dsh web` 自动加载），或本地试用：

```sh
dsh plugin --profile web add file:<本插件目录>
```

## 配置（每用户一次，非技术人员照做即可）

安装后打开 `dsh web` 网页，**三步完成**（详见 [USAGE.zh.md](./USAGE.zh.md) 开头的图文步骤）：

1. **设置 → 插件 →「邮件」卡**：填「邮箱账号」+「邮箱密码」→ 保存（服务器等已预置 263 默认值，不用动；保存即时生效，首次同步约 1~2 分钟）
2. 需要提醒的人：同卡勾「开启重要新邮件提醒」+ 填白名单或关键词 → 保存
3. 点网页**右上角「开启桌面通知」**，浏览器点「允许」（一次性，之后有新邮件弹桌面通知）

管理员可用环境变量兜底（`$DSH_HOME/.env`，配置卡未覆盖时生效）：`EMAIL_IMAP_USER` / `EMAIL_IMAP_PASS`（可选 `EMAIL_SMTP_HOST` / `EMAIL_SMTP_PORT` / `EMAIL_SMTP_PASS`，默认按 IMAP 推导）。

## 功能一览

**设置卡**（设置 → 插件 → 邮件）：连接配置 + 提醒规则，点击展开/收起，跟随宿主外观主题。

**重要新邮件提醒**：后台每 60 秒轮询同步，新邮件按规则（发件人白名单 / 主题关键词 / 全部开关）判定，命中即**浏览器桌面通知 + 页内横幅**；水位去重，同一封只提醒一次。

**模型工具**（对话中由 AI 调用）：

| 工具 | 说明 |
|---|---|
| `email_search` | 全文搜索（主题/发件人/正文，中文可用） |
| `email_recent` | 最近 N 小时新邮件 |
| `email_threads` / `email_thread_view` | 会话线程列表 / 完整往来时间线 |
| `email_sync` / `email_stats` | 手动同步 / 库统计 |
| `email_mark_read` | 标已读（单封/整线程） |
| `email_attachment_list` / `email_attachment_get` | 附件列表 / 下载到本地 |
| `email_send` | 发信 / 回复（自动 In-Reply-To 归线程） |

## 已知边界（263 实测）

- 143/STARTTLS 不可用，收件仅 993/SSL；SMTP 为 25 端口无 SSL（465 自动 SSL）；
- 服务端搜索失效——全部搜索走本地 FTS5（<3 字符自动回退模糊匹配）；
- 单封邮件抓取上限默认 10MB（配置卡可调），超限只索引主题/发件人；
- 存量老邮件的附件元数据在首次安装时不会回填，需重建索引。

## 目录结构

- `lib/plugin.mjs` — 宿主半边（工具 + 设置命名空间 + SSE 提醒通道 + 同步引擎）
- `lib/client.js` — 浏览器半边（配置卡 + 通知横幅）
- `USAGE.zh.md` — 面向公司用户的使用帮助

## License

MIT
