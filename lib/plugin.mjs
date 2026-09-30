// src/config.ts
import fs from "node:fs";
import z from "@deepseek-ai/schemastery";
function loadLocal() {
  for (const candidate of ["config.local.json", "../email-plugin/config.local.json"]) {
    try {
      return JSON.parse(fs.readFileSync(new URL(candidate, import.meta.url), "utf8"));
    } catch {
    }
  }
  return {};
}
// 用户数据根（宿主规范：$DSH_HOME，缺省 ~/.dsh）：相对路径的索引库与附件都落在 storages/dsh-email/，
// 与包安装目录解耦——升级/重装插件不丢数据
var dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== '' ? process.env.DSH_HOME : path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh');
function resolveDataPath(rel) {
  return path.isAbsolute(rel) ? rel : path.join(dshHome, 'storages', 'dsh-email', rel);
}
function resolveConfig(overrides = {}) {
  const env = process.env;
  const local = loadLocal();
  // 空数组跳过：schemastery 的 z.array 缺省会产出 []，不能让空配置覆盖内置默认文件夹
  const pick = (...vals) => vals.find((v) => v !== void 0 && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  const tlsModeRaw = pick(overrides.tlsMode, env.EMAIL_IMAP_TLS, env.PROBE_IMAP_TLS, local.tls, "tls");
  const host = pick(overrides.host, env.EMAIL_IMAP_HOST, env.PROBE_IMAP_HOST, local.host, "imap.263.net");
  const user = pick(overrides.user, env.EMAIL_IMAP_USER, env.PROBE_IMAP_USER, local.user) ?? "";
  const pass = pick(overrides.pass, env.EMAIL_IMAP_PASS, env.PROBE_IMAP_PASS, local.pass) ?? "";
  const cfg = {
    host,
    port: Number(pick(overrides.port, env.EMAIL_IMAP_PORT, env.PROBE_IMAP_PORT, local.port, 993)),
    tlsMode: ["tls", "starttls", "none"].includes(String(tlsModeRaw)) ? tlsModeRaw : "tls",
    user,
    pass,
    dbPath: pick(overrides.dbPath, env.EMAIL_DB_PATH, local.dbPath, "mail.db"),
    folders: pick(overrides.folders, local.folders, ["INBOX", "\u5DF2\u53D1\u9001", "\u5783\u573E\u90AE\u4EF6"]),
    backfillDays: Number(pick(overrides.backfillDays, env.EMAIL_BACKFILL_DAYS, local.backfillDays, 90)),
    pollSeconds: Number(pick(overrides.pollSeconds, env.EMAIL_POLL_SECONDS, 60)),
    maxSourceBytes: Number(pick(overrides.maxSourceBytes, env.EMAIL_MAX_SOURCE_BYTES, local.maxSourceBytes, 10 * 1024 * 1024)),
    // SMTP \u53D1\u4EF6\uFF1A263 \u4E3A smtp.263.net:25 \u65E0 SSL\uFF08secure \u7531 port===465 \u63A8\u5B9A\uFF0C
    // 587 \u8D70 STARTTLS\uFF09\uFF1B\u5BC6\u7801\u56FA\u5B9A\u8D70 EMAIL_SMTP_PASS\uFF0C\u7F3A\u7701\u56DE\u9000 IMAP \u5BC6\u7801
    smtpHost: pick(overrides.smtpHost, env.EMAIL_SMTP_HOST, local.smtpHost, host.replace(/^imap\./, "smtp.")),
    smtpPort: Number(pick(overrides.smtpPort, env.EMAIL_SMTP_PORT, local.smtpPort, 25)),
    smtpUser: pick(overrides.smtpUser, env.EMAIL_SMTP_USER, local.smtpUser) ?? user,
    smtpPass: pick(env.EMAIL_SMTP_PASS, local.smtpPass) ?? pass,
    // \u9644\u4EF6\u4E0B\u8F7D\u4FDD\u5B58\u76EE\u5F55\uFF08\u76F8\u5BF9\u63D2\u4EF6\u76EE\u5F55\uFF09
    attachmentDir: pick(overrides.attachmentDir, env.EMAIL_ATTACHMENT_DIR, local.attachmentDir, "data/attachments"),
    notifyEnabled: overrides.notifyEnabled === true,
    notifyAll: overrides.notifyAll === true,
    notifyFrom: Array.isArray(overrides.notifyFrom) ? overrides.notifyFrom : [],
    notifyKeywords: Array.isArray(overrides.notifyKeywords) ? overrides.notifyKeywords : []
  };
  if (!cfg.user || !cfg.pass) throw new Error("\u7F3A\u5C11\u8D26\u53F7\u914D\u7F6E\uFF1A\u8BBE\u7F6E\u73AF\u5883\u53D8\u91CF EMAIL_IMAP_USER / EMAIL_IMAP_PASS\uFF08\u6216 config.local.json / CLI \u53C2\u6570\uFF09");
  return cfg;
}

// src/store.ts
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
var SCHEMA = `
CREATE TABLE IF NOT EXISTS messages(
  mailbox TEXT NOT NULL,
  uid INTEGER NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,
  thread_id INTEGER NOT NULL,
  from_addr TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  subject_norm TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  flags TEXT NOT NULL DEFAULT '[]',
  has_attachment INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(mailbox, uid)
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
CREATE INDEX IF NOT EXISTS idx_messages_subjectnorm ON messages(subject_norm);
CREATE TABLE IF NOT EXISTS threads(
  id INTEGER PRIMARY KEY,
  subject_norm TEXT NOT NULL DEFAULT '',
  first_at TEXT NOT NULL DEFAULT '',
  last_at TEXT NOT NULL DEFAULT '',
  msg_count INTEGER NOT NULL DEFAULT 0,
  unseen INTEGER NOT NULL DEFAULT 0,
  participants TEXT NOT NULL DEFAULT '[]',
  last_subject TEXT NOT NULL DEFAULT '',
  importance INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mailbox TEXT NOT NULL,
  uid INTEGER NOT NULL,
  part_id TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  UNIQUE(mailbox, uid, part_id)
);
CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(mailbox, uid);
CREATE VIRTUAL TABLE IF NOT EXISTS mail_fts USING fts5(
  subject, from_text, body, thread_id UNINDEXED, mailbox UNINDEXED, uid UNINDEXED,
  tokenize='trigram'
);
CREATE TABLE IF NOT EXISTS sync_state(
  mailbox TEXT PRIMARY KEY,
  uidvalidity INTEGER NOT NULL DEFAULT 0,
  last_uid INTEGER NOT NULL DEFAULT 0,
  last_sync_at TEXT NOT NULL DEFAULT ''
);
`;
var Store = class {
  db;
  constructor(dbPath) {
    let resolved;
    if (dbPath === ':memory:') resolved = ':memory:';
    else if (path.isAbsolute(dbPath)) resolved = dbPath;
    else resolved = resolveDataPath(dbPath);
    if (resolved !== ':memory:') fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.db.exec(SCHEMA);
  }
  /* ---------- 同步状态 ---------- */
  getSyncState(mailbox) {
    return this.db.prepare("SELECT * FROM sync_state WHERE mailbox=?").get(mailbox);
  }
  setSyncState(mailbox, uidvalidity, lastUid) {
    this.db.prepare("INSERT INTO sync_state(mailbox,uidvalidity,last_uid,last_sync_at) VALUES(?,?,?,?) ON CONFLICT(mailbox) DO UPDATE SET uidvalidity=excluded.uidvalidity, last_uid=excluded.last_uid, last_sync_at=excluded.last_sync_at").run(mailbox, uidvalidity, lastUid, (/* @__PURE__ */ new Date()).toISOString());
  }
  /* ---------- 线程 ---------- */
  allocThreadId() {
    const row = this.db.prepare("SELECT COALESCE(MAX(id),0)+1 AS next FROM threads").get();
    return row.next;
  }
  createThread(id, subjectNorm) {
    this.db.prepare("INSERT OR IGNORE INTO threads(id, subject_norm) VALUES(?,?)").run(id, subjectNorm);
  }
  threadParticipants(threadId) {
    const row = this.db.prepare("SELECT participants FROM threads WHERE id=?").get(threadId);
    try {
      return row ? JSON.parse(row.participants) : [];
    } catch {
      return [];
    }
  }
  /** 全量重建线程聚合（同步后/重算后调用）。 */
  refreshThreadAggregates() {
    this.db.exec(`
      UPDATE threads SET
        first_at = COALESCE((SELECT MIN(date) FROM messages m WHERE m.thread_id=threads.id AND m.date!=''),''),
        last_at  = COALESCE((SELECT MAX(date) FROM messages m WHERE m.thread_id=threads.id AND m.date!=''),''),
        msg_count = (SELECT COUNT(*) FROM messages m WHERE m.thread_id=threads.id),
        unseen = (SELECT COUNT(*) FROM messages m WHERE m.thread_id=threads.id AND m.flags NOT LIKE '%Seen%'),
        last_subject = COALESCE((SELECT subject FROM messages m WHERE m.thread_id=threads.id AND m.date=(SELECT MAX(date) FROM messages m2 WHERE m2.thread_id=threads.id) LIMIT 1),'')
    `);
  }
  /* ---------- 邮件 ---------- */
  upsertMessage(row) {
    this.db.prepare(`INSERT INTO messages(mailbox,uid,message_id,in_reply_to,refs,thread_id,from_addr,from_name,to_addrs,cc_addrs,subject,subject_norm,date,size,snippet,body_text,flags,has_attachment,fetched_at)
      VALUES(@mailbox,@uid,@message_id,@in_reply_to,@refs,@thread_id,@from_addr,@from_name,@to_addrs,@cc_addrs,@subject,@subject_norm,@date,@size,@snippet,@body_text,@flags,@has_attachment,@fetched_at)
      ON CONFLICT(mailbox,uid) DO UPDATE SET
        message_id=excluded.message_id, in_reply_to=excluded.in_reply_to, refs=excluded.refs, thread_id=excluded.thread_id,
        from_addr=excluded.from_addr, from_name=excluded.from_name, to_addrs=excluded.to_addrs, cc_addrs=excluded.cc_addrs,
        subject=excluded.subject, subject_norm=excluded.subject_norm, date=excluded.date, size=excluded.size,
        snippet=excluded.snippet, body_text=excluded.body_text, flags=excluded.flags, has_attachment=excluded.has_attachment,
        fetched_at=excluded.fetched_at`).run(row);
    this.db.prepare("DELETE FROM mail_fts WHERE mailbox=? AND uid=?").run(row.mailbox, row.uid);
    this.db.prepare("INSERT INTO mail_fts(subject,from_text,body,thread_id,mailbox,uid) VALUES(?,?,?,?,?,?)").run(row.subject, `${row.from_name} ${row.from_addr}`, row.body_text.slice(0, 1e5), row.thread_id, row.mailbox, row.uid);
  }
  updateFlags(mailbox, uid, flags) {
    this.db.prepare("UPDATE messages SET flags=? WHERE mailbox=? AND uid=?").run(flags, mailbox, uid);
  }
  wipeFolder(mailbox) {
    this.db.prepare("DELETE FROM messages WHERE mailbox=?").run(mailbox);
    this.db.prepare("DELETE FROM mail_fts WHERE mailbox=?").run(mailbox);
    this.db.prepare("DELETE FROM sync_state WHERE mailbox=?").run(mailbox);
  }
  clearThreading() {
    this.db.prepare("UPDATE messages SET thread_id=0").run();
    this.db.prepare("DELETE FROM threads").run();
  }
  setThreadId(mailbox, uid, threadId) {
    this.db.prepare("UPDATE messages SET thread_id=? WHERE mailbox=? AND uid=?").run(threadId, mailbox, uid);
  }
  messageCount(mailbox) {
    const row = mailbox ? this.db.prepare("SELECT COUNT(*) AS c FROM messages WHERE mailbox=?").get(mailbox) : this.db.prepare("SELECT COUNT(*) AS c FROM messages").get();
    return row.c;
  }
  oldestDate() {
    const row = this.db.prepare("SELECT MIN(date) AS d FROM messages WHERE date!=''").get();
    return row.d || "";
  }
};

// src/sync.ts
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// src/thread.ts
function normalizeSubject(subject) {
  let s = (subject || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const prefixes = /^(re(\d+)?|fw(d)?|fwd|aw|sv|回复|答复|转发|转寄|回覆)\s*[:：]\s*/i;
  for (let i = 0; i < 10; i++) {
    const next = s.replace(prefixes, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}
function extractMessageIds(refs) {
  const raw = String(refs || "");
  const out = [];
  const re = /<([^<>]+)>/g;
  let m;
  while ((m = re.exec(raw)) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
function domainOf(addr) {
  const at = String(addr || "").lastIndexOf("@");
  return at === -1 ? "" : String(addr).slice(at + 1).toLowerCase();
}
function createThreadResolver(allocThreadId, onThreadCreated) {
  const r = {
    idToThread: /* @__PURE__ */ new Map(),
    subjectIndex: /* @__PURE__ */ new Map(),
    resolve(c) {
      for (let i = c.ancestors.length - 1; i >= 0; i--) {
        const t = this.idToThread.get(c.ancestors[i]);
        if (t !== void 0) return t;
      }
      if (c.messageId && this.idToThread.has(c.messageId)) return this.idToThread.get(c.messageId);
      const candidates = this.subjectIndex.get(c.subjectNorm) || [];
      for (const tid2 of candidates) {
        const parts = c.threadParticipants || [];
        const sameAddr = parts.some((p) => p.toLowerCase() === c.fromAddr.toLowerCase());
        const sameDomain = parts.some((p) => domainOf(p) === domainOf(c.fromAddr) && domainOf(c.fromAddr) !== "");
        if (sameAddr || sameDomain) return tid2;
      }
      const tid = allocThreadId();
      onThreadCreated(tid, c.subjectNorm);
      return tid;
    },
    register(messageId, ancestors, threadId) {
      if (messageId) this.idToThread.set(messageId, threadId);
      for (const a of ancestors) if (!this.idToThread.has(a)) this.idToThread.set(a, threadId);
    }
  };
  return r;
}

// src/htmltext.ts
function htmlToText(html) {
  // 先把超链接以「文字 (URL)」形式落进文本，再剥其余标签——否则 <a href> 的地址会被无条件丢弃
  const withLinks = html.replace(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => `${inner.replace(/<[^>]+>/g, "").trim() || "链接"} (${href})`);
  return withLinks.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// src/sync.ts
var PER_MAIL_TIMEOUT_MS = 2e4;
function withTimeout(p, ms, tag) {
  let settled = false;
  return Promise.race([
    p.then((value) => {
      settled = true;
      return { ok: true, value };
    }, () => {
      settled = true;
      return { ok: false };
    }),
    new Promise((res) => setTimeout(() => {
      if (!settled) console.warn(`[dsh-email][sync] \u23F1 ${tag} \u8D85\u65F6`);
      res({ ok: false });
    }, ms))
  ]);
}
var SyncEngine = class {
  constructor(cfg, store) {
    this.cfg = cfg;
    this.store = store;
  }
  cfg;
  store;
  client = null;
  async connect() {
    // 活性检查：imapflow 的 usable 在连接关闭（含服务器静默断开、空闲超时）时置 false。
    // 死连接直接弃用——否则所有操作永远报 "Connection not available" 直到宿主重启
    if (this.client?.usable === true) return this.client;
    if (this.client) {
      try { this.client.close(); } catch { }
      this.client = null;
    }
    this.client = await this.makeClient();
    return this.client;
  }
  async makeClient() {
    // 连接级错误兜底：未监听的 error 事件会直接击穿宿主进程（网络闪断必现）
    const client = new ImapFlow({
      host: this.cfg.host,
      port: this.cfg.port,
      secure: this.cfg.tlsMode === "tls",
      auth: { user: this.cfg.user, pass: this.cfg.pass },
      logger: false,
      connectionTimeout: 2e4,
      greetingTimeout: 2e4,
      socketTimeout: 6e4
    });
    // 静默断连兜底：服务器侧 FIN / 空闲 watchdog 超时走 close() 不发 error，
    // 只有 'close' 事件能感知——缓存不清则连接永久卡死
    client.on('close', () => {
      if (this.client === client) this.client = null;
    });
    client.on('error', (err) => {
      console.error('[dsh-email][sync] IMAP 连接错误（将自动重连）:', String(err?.message ?? err));
      try { client.close(); } catch { }
      if (this.client === client) this.client = null;
    });
    await client.connect();
    return client;
  }
  /** 强制重连（单封 source 卡死后协议失步，唯一安全的恢复方式）。 */
  async reconnect() {
    try {
      this.client?.close();
    } catch {
    }
    this.client = null;
    return this.connect();
  }
  async close() {
    try {
      this.client?.logout();
    } catch {
      try {
        this.client?.close();
      } catch {
      }
    }
    this.client = null;
  }
  async syncOnce(verbose = false) {
    let client = await this.connect();
    const reports = [];
    for (const folder of this.cfg.folders) {
      reports.push(await this.syncFolder(client, folder, verbose));
      client = this.client ?? client;
    }
    this.store.refreshThreadAggregates();
    return reports;
  }
  async syncFolder(clientIn, folder, verbose = false) {
    let client = clientIn;
    const t0 = Date.now();
    const log = verbose ? (m) => console.log(`[dsh-email][sync] ${folder}: ${m}（+${Date.now() - t0}ms）`) : () => { };
    log("\u5F00\u59CB");
    let lock = await client.getMailboxLock(folder);
    const report = { folder, fetched: 0, bodyOk: 0, bodySkipped: 0, bodyHang: 0, lastUid: 0, rescan: false };
    try {
      const uidValidity = Number(client.mailbox.uidValidity ?? 0);
      const state = this.store.getSyncState(folder);
      let lastUid = state?.last_uid ?? 0;
      if (state && Number(state.uidvalidity) !== uidValidity) {
        this.store.wipeFolder(folder);
        lastUid = 0;
        report.rescan = true;
      }
      let targetUids = [];
      if (lastUid === 0) {
        const since = new Date(Date.now() - this.cfg.backfillDays * 864e5);
        const found = await client.search({ since }, { uid: true });
        targetUids = [...new Set(found ?? [])].sort((a, b) => a - b);
      } else {
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        targetUids = [...new Set(found ?? [])].filter((u) => u > lastUid).sort((a, b) => a - b);
      }
      report.lastUid = Math.max(lastUid, ...targetUids, 0);
      log(`\u63A2\u6D4B ${targetUids.length} \u4E2A\u65B0 uid\uFF08lastUid=${lastUid}\uFF09`);
      const metaBatch = 40;
      const rows = [];
      for (let i = 0; i < targetUids.length; i += metaBatch) {
        const batch = targetUids.slice(i, i + metaBatch);
        const range = `${batch[0]}:${batch[batch.length - 1]}`;
        for await (const m of client.fetch(range, { uid: true, envelope: true, internalDate: true, size: true, flags: true }, { uid: true })) {
          if (!batch.includes(m.uid)) continue;
          const row = this.envelopeToRow(folder, m);
          if (row) {
            rows.push(row);
            this.store.upsertMessage(row);
            report.fetched++;
          }
        }
        log(`\u5143\u6570\u636E ${Math.min(i + metaBatch, targetUids.length)}/${targetUids.length}`);
      }
      for (const row of rows) {
        if ((row.size ?? 0) > this.cfg.maxSourceBytes) {
          report.bodySkipped++;
          continue;
        }
        const existing = this.store.db.prepare("SELECT body_text FROM messages WHERE mailbox=? AND uid=?").get(row.mailbox, row.uid);
        if (existing && existing.body_text) {
          report.bodyOk++;
          continue;
        }
        const got = await withTimeout(this.fetchSource(client, row.uid), PER_MAIL_TIMEOUT_MS, `source ${row.uid}`);
        if (!got.ok) {
          report.bodyHang++;
          client = await this.reconnect();
          lock.release();
          lock = await client.getMailboxLock(folder);
          continue;
        }
        if (got.value) {
          await this.applySource(row, got.value);
          report.bodyOk++;
        } else report.bodySkipped++;
        if ((report.bodyOk + report.bodySkipped + report.bodyHang) % 10 === 0) log(`\u6B63\u6587 ${report.bodyOk + report.bodySkipped + report.bodyHang}/${rows.length}`);
      }
      log("\u5237\u65B0 flags\u2026");
      await this.refreshFlags(client, folder);
      this.store.setSyncState(folder, uidValidity, report.lastUid);
      log(`\u5B8C\u6210 fetched=${report.fetched} bodyOk=${report.bodyOk} skip=${report.bodySkipped} hang=${report.bodyHang}`);
      if (!verbose && (report.fetched > 0 || report.bodyHang > 0 || report.rescan)) {
        console.log(`[dsh-email][sync] ${folder}: 新增 ${report.fetched}（正文 ${report.bodyOk} 成功/${report.bodySkipped} 跳过/${report.bodyHang} 卡死跳过）${report.rescan ? "（UIDVALIDITY 变化全量重扫）" : ""}`);
      }
      return report;
    } finally {
      lock.release();
    }
  }
  /** 单封 source：返回 Buffer 或 null（无数据）。 */
  async fetchSource(client, uid) {
    for await (const m of client.fetch(String(uid), { source: true }, { uid: true })) return m.source ?? null;
    return null;
  }
  /** imapflow envelope 对象 → MessageRow（无线程归并的元数据行）。 */
  envelopeToRow(folder, m) {
    const env = m.envelope;
    if (!env) return null;
    const messageId = String(env.messageId || "").replace(/[<>]/g, "") || null;
    const subject = env.subject ?? "";
    const date = new Date(env.date || m.internalDate || 0);
    const toAddrs = (env.to ?? []).map((a) => a.address).filter(Boolean);
    const ccAddrs = (env.cc ?? []).map((a) => a.address).filter(Boolean);
    const row = {
      mailbox: folder,
      uid: m.uid,
      message_id: messageId,
      in_reply_to: env.inReplyTo ? String(env.inReplyTo) : null,
      refs: null,
      thread_id: 0,
      from_addr: env.from?.[0]?.address ?? "",
      from_name: env.from?.[0]?.name ?? "",
      to_addrs: JSON.stringify(toAddrs),
      cc_addrs: JSON.stringify(ccAddrs),
      subject,
      subject_norm: normalizeSubject(subject),
      date: date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : "",
      size: m.size ?? 0,
      snippet: "",
      body_text: "",
      flags: JSON.stringify([...m.flags ?? []]),
      has_attachment: 0,
      fetched_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    row.thread_id = this.resolveThreadFor(row);
    return row;
  }
  /** 解析 source 并回填正文/附件/References（更新 DB 与 FTS）。 */
  async applySource(row, source) {
    try {
      const parsed = await simpleParser(source);
      const refsHeader = parsed.references ? String(parsed.references) : null;
      const bodyText = parsed.text?.trim() || (parsed.html ? htmlToText(String(parsed.html)) : "");
      const snippet = bodyText.replace(/\s+/g, " ").slice(0, 200);
      this.store.db.prepare("UPDATE messages SET body_text=?, snippet=?, refs=COALESCE(?,refs), has_attachment=? WHERE mailbox=? AND uid=?").run(bodyText.slice(0, 2e5), snippet, refsHeader, (parsed.attachments?.length ?? 0) > 0 ? 1 : 0, row.mailbox, row.uid);
      this.store.db.prepare("DELETE FROM mail_fts WHERE mailbox=? AND uid=?").run(row.mailbox, row.uid);
      this.store.db.prepare("INSERT INTO mail_fts(subject,from_text,body,thread_id,mailbox,uid) VALUES(?,?,?,?,?,?)").run(row.subject, `${row.from_name} ${row.from_addr}`, bodyText.slice(0, 1e5), row.thread_id, row.mailbox, row.uid);
      // 附件元数据入库（partId 定位 MIME 部件，供 email_attachment_list / get 使用）
      this.store.db.prepare("DELETE FROM attachments WHERE mailbox=? AND uid=?").run(row.mailbox, row.uid);
      const insAtt = this.store.db.prepare("INSERT OR IGNORE INTO attachments(mailbox,uid,part_id,filename,content_type,size) VALUES(?,?,?,?,?,?)");
      for (const att of parsed.attachments ?? []) {
        insAtt.run(row.mailbox, row.uid, String(att.partId ?? ""), att.filename || "(未命名)", att.contentType || "", Number(att.size ?? att.content?.length ?? 0));
      }
    } catch (e) {
      console.error(`[dsh-email][sync] \u89E3\u6790\u5931\u8D25 ${row.mailbox}#${row.uid}: ${String(e)}`);
    }
  }
  async refreshFlags(client, folder) {
    const rows = this.store.db.prepare("SELECT uid FROM messages WHERE mailbox=? ORDER BY uid").all(folder);
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const range = `${chunk[0].uid}:${chunk[chunk.length - 1].uid}`;
      for await (const m of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
        this.store.updateFlags(folder, m.uid, JSON.stringify([...m.flags ?? []]));
      }
    }
  }
  /* ---------- 线程归并（内存 resolver + DB 冷启动） ---------- */
  threadResolver = createThreadResolver(
    () => this.store.allocThreadId(),
    (id, subjectNorm) => {
      this.store.createThread(id, subjectNorm);
    }
  );
  resolverWarm = false;
  warmResolver() {
    if (this.resolverWarm) return;
    this.resolverWarm = true;
    const rows = this.store.db.prepare("SELECT message_id, refs, thread_id FROM messages WHERE message_id IS NOT NULL AND message_id!=''").all();
    for (const r of rows) this.threadResolver.register(r.message_id, extractMessageIds(r.refs ?? ""), r.thread_id);
    const threads = this.store.db.prepare("SELECT id, subject_norm FROM threads").all();
    for (const t of threads) {
      const arr = this.threadResolver.subjectIndex.get(t.subject_norm) ?? [];
      arr.push(t.id);
      this.threadResolver.subjectIndex.set(t.subject_norm, arr);
    }
  }
  resolveThreadFor(row) {
    this.warmResolver();
    const ancestors = extractMessageIds(row.in_reply_to ?? "");
    const participants = this.knownParticipantsFor(row.subject_norm);
    const tid = this.threadResolver.resolve({
      messageId: row.message_id,
      ancestors,
      subjectNorm: row.subject_norm,
      fromAddr: row.from_addr,
      threadParticipants: participants
    });
    this.threadResolver.register(row.message_id, ancestors, tid);
    const arr = this.threadResolver.subjectIndex.get(row.subject_norm) ?? [];
    if (!arr.includes(tid)) {
      arr.push(tid);
      this.threadResolver.subjectIndex.set(row.subject_norm, arr);
    }
    try {
      const rowP = this.store.db.prepare("SELECT participants FROM threads WHERE id=?").get(tid);
      if (rowP) {
        const list = JSON.parse(rowP.participants);
        for (const p of [row.from_addr, ...JSON.parse(row.to_addrs ?? "[]"), ...participants]) if (p && !list.includes(p)) list.push(p);
        this.store.db.prepare("UPDATE threads SET participants=? WHERE id=?").run(JSON.stringify(list.slice(0, 50)), tid);
      }
    } catch {
    }
    return tid;
  }
  knownParticipantsFor(subjectNorm) {
    const rows = this.store.db.prepare("SELECT participants FROM threads WHERE subject_norm=?").all(subjectNorm);
    const out = [];
    for (const r of rows) {
      try {
        for (const p of JSON.parse(r.participants)) if (!out.includes(p)) out.push(p);
      } catch {
      }
    }
    return out;
  }
};

// src/search.ts
function likeEscape(s) {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}
function search(store, f) {
  const limit = Math.min(Math.max(f.limit ?? 20, 1), 200);
  const where = [];
  const params = {};
  let baseJoin = "FROM messages m";
  let useFts = false;
  if (f.query && f.query.trim()) {
    const q = f.query.trim();
    if (q.length >= 3) {
      useFts = true;
      baseJoin = "FROM mail_fts f JOIN messages m ON m.mailbox=f.mailbox AND m.uid=f.uid";
      where.push(`f.mail_fts MATCH @match`);
      params.match = q.replace(/"/g, " ").replace(/(\bNOT\b|\bOR\b|\bAND\b|\bNEAR\b)/gi, " ");
    } else {
      const esc = `%${likeEscape(q)}%`;
      where.push(`(m.subject LIKE @q ESCAPE '\\' OR m.from_name LIKE @q ESCAPE '\\' OR m.from_addr LIKE @q ESCAPE '\\' OR m.snippet LIKE @q ESCAPE '\\')`);
      params.q = esc;
    }
  }
  if (f.from) {
    where.push("(m.from_addr LIKE @from ESCAPE '\\' OR m.from_name LIKE @from ESCAPE '\\')");
    params.from = `%${likeEscape(f.from)}%`;
  }
  if (f.sinceDays && f.sinceDays > 0) {
    where.push("m.date >= @since");
    params.since = new Date(Date.now() - f.sinceDays * 864e5).toISOString();
  }
  if (f.threadId) {
    where.push("m.thread_id = @thread");
    params.thread = f.threadId;
  }
  if (f.mailbox) {
    where.push("m.mailbox = @mailbox");
    params.mailbox = f.mailbox;
  }
  if (f.unreadOnly) {
    where.push(`m.flags NOT LIKE '%Seen%'`);
  }
  if (f.hasAttachment) {
    where.push("m.has_attachment = 1");
  }
  const sql = `SELECT m.mailbox, m.uid, m.subject, m.from_name, m.from_addr, m.date, m.snippet, m.thread_id, m.flags, m.has_attachment
    ${baseJoin} ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY m.date DESC LIMIT ${limit} OFFSET ${Math.max(f.offset ?? 0, 0)}`;
  const rows = store.db.prepare(sql).all(params);
  return rows.map((r) => ({
    mailbox: r.mailbox,
    uid: r.uid,
    subject: r.subject ?? "",
    from_name: r.from_name ?? "",
    from_addr: r.from_addr ?? "",
    date: r.date ?? "",
    snippet: r.snippet ?? "",
    thread_id: r.thread_id,
    unread: !String(r.flags ?? "[]").includes("\\Seen"),
    has_attachment: r.has_attachment
  }));
}
function listThreads(store, top = 15) {
  const rows = store.db.prepare("SELECT * FROM threads ORDER BY last_at DESC LIMIT ?").all(top);
  return rows.map((r) => ({
    id: r.id,
    subject_norm: r.subject_norm,
    last_subject: r.last_subject ?? r.subject_norm,
    msg_count: r.msg_count,
    unseen: r.unseen,
    first_at: r.first_at,
    last_at: r.last_at,
    participants: (() => {
      try {
        return JSON.parse(r.participants);
      } catch {
        return [];
      }
    })()
  }));
}
function threadTimeline(store, threadId, includeBody = false) {
  const rows = store.db.prepare("SELECT * FROM messages WHERE thread_id=? ORDER BY date ASC").all(threadId);
  return rows.map((r) => ({
    mailbox: r.mailbox,
    uid: r.uid,
    subject: r.subject,
    from_name: r.from_name,
    from_addr: r.from_addr,
    date: r.date,
    snippet: r.snippet,
    unread: !String(r.flags ?? "").includes("\\Seen"),
    ...includeBody ? { body: (r.body_text || "").slice(0, 4e3) } : {}
  }));
}
function stats(store) {
  const total = store.messageCount();
  const byFolder = store.db.prepare("SELECT mailbox, COUNT(*) AS c FROM messages GROUP BY mailbox").all();
  const threads = store.db.prepare("SELECT COUNT(*) AS c FROM threads").get().c;
  const multi = store.db.prepare("SELECT COUNT(*) AS c FROM threads WHERE msg_count>1").get().c;
  const unseen = store.db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE flags NOT LIKE '%\\"\\\\Seen"%'`).get().c;
  return { total, byFolder, threads, multiMemberThreads: multi, unseen, oldest: store.oldestDate() };
}

// src/service.ts
var EmailService = class {
  cfg;
  store;
  engine;
  pollTimer = null;
  constructor(cfg) {
    this.cfg = resolveConfig(cfg);
    this.store = new Store(this.cfg.dbPath);
    this.engine = new SyncEngine(this.cfg, this.store);
  }
  async sync(verbose = false) {
    // \u8BB0\u5F55\u540C\u6B65\u524D\u5404\u6587\u4EF6\u5939\u6C34\u4F4D\uFF0C\u7528\u4E8E\u540C\u6B65\u540E\u8BC6\u522B\u300C\u672C\u6B21\u65B0\u589E\u300D\u90AE\u4EF6\u5E76\u505A\u91CD\u8981\u5224\u5B9A
    const before = {};
    for (const st of this.store.db.prepare("SELECT * FROM sync_state").all()) before[st.mailbox] = st.last_uid;
    const reports = await this.engine.syncOnce(verbose);
    this.notifyNewMails(before);
    return reports.map((r) => `${r.folder}: \u65B0\u589E ${r.fetched}\uFF08\u6B63\u6587 ${r.bodyOk} \u6210\u529F/${r.bodySkipped} \u8DF3\u8FC7/${r.bodyHang} \u5361\u6B7B\u8DF3\u8FC7\uFF09${r.rescan ? "\uFF08UIDVALIDITY \u53D8\u5316\u5168\u91CF\u91CD\u626B\uFF09" : ""}`).join("; ");
  }
  async shutdown() {
    this.stopPolling();
    await this.engine.close();
  }
  /** 同步后判定新增邮件是否「重要」（全部开关/发件人白名单/主题关键词），命中则 SSE 广播。 */
  notifyNewMails(before) {
    // 0.2.0：提醒配置来自 entry config（构造时已并入 this.cfg）；0.1.x 走 settingsOverride
    const cfg = this.cfg.notifyEnabled !== undefined ? this.cfg : (settingsOverride?.() ?? {});
    if (cfg.notifyEnabled !== true) return;
    const fromList = Array.isArray(cfg.notifyFrom) ? cfg.notifyFrom : [];
    const kwList = Array.isArray(cfg.notifyKeywords) ? cfg.notifyKeywords : [];
    const important = [];
    for (const folder of this.cfg.folders) {
      if (folder === "已发送" || folder === "垃圾邮件") continue;
      const last = before[folder] ?? 0;
      const rows = this.store.db.prepare("SELECT mailbox, uid, subject, from_name, from_addr, snippet FROM messages WHERE mailbox=? AND uid>? ORDER BY uid").all(folder, last);
      for (const r of rows) {
        const fromHit = fromList.some((f) => f && (r.from_addr.includes(f) || (r.from_name ?? "").includes(f)));
        const kwHit = kwList.some((k) => k && r.subject.includes(k));
        if (cfg.notifyAll === true || fromHit || kwHit) {
          important.push({ subject: r.subject || "（无主题）", from: r.from_name || r.from_addr, snippet: (r.snippet ?? "").slice(0, 80), tag: `${r.mailbox}#${r.uid}` });
        }
      }
    }
    broadcastImportantMails(important);
    if (important.length > 0) console.log(`[dsh-email][notify] 命中 ${important.length} 封重要新邮件，已广播`);
  }
  startPolling(seconds = this.cfg.pollSeconds) {
    if (this.pollTimer) return;
    const run = () => {
      this.sync().catch((e) => console.error("[dsh-email][email] \u8F6E\u8BE2\u540C\u6B65\u5931\u8D25:", String(e)));
    };
    this.pollTimer = setInterval(run, Math.max(30, seconds) * 1e3);
  }
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  search = (f) => search(this.store, f);
  threads = (top) => listThreads(this.store, top);
  timeline = (threadId, includeBody) => threadTimeline(this.store, threadId, includeBody);
  recent = (hours = 24) => search(this.store, { sinceDays: hours / 24, limit: 50 });
  stats = () => stats(this.store);
  /** 标记已读：mailbox+uid 精确标记，或 thread_id 标记整个线程。 */
  async markRead({ mailbox, uid, threadId }) {
    let targets;
    if (mailbox && uid) {
      targets = [{ mailbox, uid }];
    } else if (threadId) {
      targets = this.store.db.prepare("SELECT mailbox, uid FROM messages WHERE thread_id=?").all(threadId);
    } else {
      throw new Error("需要 mailbox+uid 或 thread_id");
    }
    const client = await this.engine.connect();
    let marked = 0;
    for (const t of targets) {
      try {
        const lock = await client.getMailboxLock(t.mailbox);
        try {
          await client.messageFlagsAdd(String(t.uid), ["\\Seen"], { uid: true });
        } finally {
          lock.release();
        }
      } catch (e) {
        console.error(`[dsh-email][markRead] ${t.mailbox}#${t.uid}: ${String(e)}`);
        continue;
      }
      // 本地 flags 同步追加 \Seen，保持与服务端一致
      try {
        const row = this.store.db.prepare("SELECT flags FROM messages WHERE mailbox=? AND uid=?").get(t.mailbox, t.uid);
        const flags = new Set(JSON.parse(row?.flags ?? "[]"));
        flags.add("\\Seen");
        this.store.updateFlags(t.mailbox, t.uid, JSON.stringify([...flags]));
      } catch {
      }
      marked++;
    }
    this.store.refreshThreadAggregates();
    return { marked, total: targets.length };
  }
  /** 列出附件元数据：thread_id 或 mailbox+uid。 */
  listAttachments({ threadId, mailbox, uid }) {
    const conds = [];
    const args = [];
    if (threadId) {
      conds.push("m.thread_id=?");
      args.push(threadId);
    }
    if (mailbox) {
      conds.push("a.mailbox=?");
      args.push(mailbox);
    }
    if (uid) {
      conds.push("a.uid=?");
      args.push(uid);
    }
    if (!conds.length) throw new Error("需要 thread_id 或 mailbox+uid");
    return this.store.db.prepare(
      `SELECT a.id, a.mailbox, a.uid, a.part_id, a.filename, a.content_type, a.size, m.subject, m.date
       FROM attachments a JOIN messages m ON m.mailbox=a.mailbox AND m.uid=a.uid
       WHERE ${conds.join(" AND ")} ORDER BY m.date DESC, a.id`
    ).all(...args);
  }
  /** 下载附件到本地目录并返回文件路径（内容经原件重新解析）。 */
  async getAttachment(id, saveDirOverride) {
    const att = this.store.db.prepare("SELECT * FROM attachments WHERE id=?").get(id);
    if (!att) throw new Error(`附件 #${id} 不存在（正文同步后附件元数据才入库，先跑 email_sync）`);
    const client = await this.engine.connect();
    const lock = await client.getMailboxLock(att.mailbox);
    let source;
    try {
      source = await this.engine.fetchSource(client, att.uid);
    } finally {
      lock.release();
    }
    if (!source) throw new Error(`取原件失败 ${att.mailbox}#${att.uid}`);
    const parsed = await simpleParser(source);
    const list = parsed.attachments ?? [];
    const hit = list.find((a) => String(a.partId ?? "") === att.part_id) ?? list[0];
    if (!hit?.content) throw new Error("附件内容解析失败");
    const dir = resolveDataPath(saveDirOverride || this.cfg.attachmentDir);
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(hit.filename || att.filename || `attachment-${id}`).replace(/[\\/:*?"<>|]/g, "_");
    const file = path.join(dir, `${att.mailbox}-${att.uid}-${safe}`);
    fs.writeFileSync(file, hit.content);
    return { path: file, filename: hit.filename || att.filename, size: hit.content.length, content_type: hit.contentType || att.content_type };
  }
  /** 读取原始邮件（RFC822 全文 + 提取链接清单），用于链接丢失/正文缺失时的取证。 */
  async readRaw(mailbox, uid, maxChars = 5e4) {
    const client = await this.engine.connect();
    const lock = await client.getMailboxLock(mailbox);
    let source;
    try { source = await this.engine.fetchSource(client, uid); } finally { lock.release(); }
    if (!source) throw new Error(`取原件失败 ${mailbox}#${uid}`);
    const text = source.toString("utf8");
    const links = [...text.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    return {
      mailbox, uid, size: source.length,
      links: [...new Set(links)].slice(0, 100),
      raw: text.slice(0, maxChars),
      truncated: text.length > maxChars
    };
  }
  /** SMTP 发件；支持按线程/消息回复（自动补 In-Reply-To、References 与 Re: 前缀）。 */
  async send({ to, subject, body, cc, replyToThreadId, replyToMessageId }) {
    const nodemailer = (await import("nodemailer")).default;
    let inReplyTo;
    let references;
    if (replyToThreadId || replyToMessageId) {
      const orig = this.store.db.prepare(
        `SELECT message_id, refs, in_reply_to, subject FROM messages WHERE ${replyToMessageId ? "message_id=?" : "thread_id=?"} ORDER BY date DESC LIMIT 1`
      ).get(replyToMessageId ?? replyToThreadId);
      if (!orig?.message_id) throw new Error("找不到要回复的原邮件（先 email_sync 同步）");
      inReplyTo = `<${orig.message_id}>`;
      const refList = [orig.refs, orig.in_reply_to, orig.message_id].filter(Boolean).join(" ").split(/\s+/).filter(Boolean);
      references = [...new Set(refList)].map((r) => `<${r.replace(/[<>]/g, "")}>`).join(" ");
      if (!String(subject ?? "").toLowerCase().startsWith("re:")) subject = `Re: ${orig.subject || subject || ""}`;
    }
    const transporter = nodemailer.createTransport({
      host: this.cfg.smtpHost,
      port: this.cfg.smtpPort,
      secure: this.cfg.smtpPort === 465,
      auth: { user: this.cfg.smtpUser, pass: this.cfg.smtpPass },
      connectionTimeout: 2e4
    });
    try {
      const info = await transporter.sendMail({
        from: `"DSH" <${this.cfg.smtpUser}>`,
        to: Array.isArray(to) ? to.join(",") : to,
        cc: cc ? (Array.isArray(cc) ? cc.join(",") : cc) : void 0,
        subject,
        text: body,
        headers: inReplyTo ? { "In-Reply-To": inReplyTo, References: references } : {}
      });
      return {
        message_id: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
        ...inReplyTo ? { in_reply_to: inReplyTo } : {}
      };
    } finally {
      try {
        await transporter.close();
      } catch {
      }
    }
  }
};

// src/plugin-entry.ts
var name = "dsh-email-tools";
var inject = ["tools"];
var svc = null;
var svcError = null;
// 模块级保存 apply(ctx, config) 第二参数传入的 entry 配置
var cfg = {};
// 设置命名空间的当前权威值（installSection 的 setSource 注入）
var settingsOverride = null;
// 重要邮件提醒：宿主侧判定 → SSE 广播给已订阅的浏览器连接
var notifyListeners = new Set();
function broadcastImportantMails(mails) {
  if (notifyListeners.size === 0 || mails.length === 0) return;
  const payload = `event: important-mail\ndata: ${JSON.stringify(mails)}\n\n`;
  for (const write of notifyListeners) {
    try { write(payload); } catch { }
  }
}
function getConfig() {
  return cfg;
}
function makeService() {
  if (svc) return svc;
  const c = { ...getConfig(), ...(settingsOverride?.() ?? {}) };
  const user = c.user ?? process.env.EMAIL_IMAP_USER ?? process.env.PROBE_IMAP_USER ?? "";
  const pass = process.env[c.passwordEnv ?? "EMAIL_IMAP_PASS"] ?? process.env.PROBE_IMAP_PASS ?? "";
  if (!user || !pass) throw new Error("\u90AE\u7BB1\u8D26\u53F7\u672A\u914D\u7F6E\uFF1A\u8BF7\u5728 $DSH_HOME/.env \u8BBE\u7F6E EMAIL_IMAP_USER / EMAIL_IMAP_PASS\uFF08\u6216\u7ECF\u8BBE\u7F6E\u9875\u914D\u7F6E\uFF09");
  svc = new EmailService({
    host: c.host,
    port: c.port,
    tlsMode: c.tlsMode,
    dbPath: c.dbPath,
    folders: c.folders,
    backfillDays: c.backfillDays,
    pollSeconds: c.pollSeconds,
    maxSourceBytes: c.maxSourceBytes,
    smtpHost: c.smtpHost,
    smtpPort: c.smtpPort,
    smtpUser: c.smtpUser,
    attachmentDir: c.attachmentDir,
    user,
    pass
  });
  return svc;
}
function service(ctx) {
  if (svcError) throw new Error(svcError);
  try {
    const s = makeService();
    svcError = null;
    return s;
  } catch (e) {
    svcError = String(e.message ?? e);
    throw e;
  }
}
function apply(ctx, c = {}) {
  cfg = c;
  // 参考官方 defineTool（@deepseek-ai/dsh-tools schema.ts parameterSchemaSpecToJsonSchema）
  // 的 spec 编译：扁平参数 spec {字段: {type, required?, description?, items?}}
  // 编译为标准 JSON Schema；output.schema 用空对象表示「任意 JSON」
  const compileParameters = (spec) => {
    const properties = {};
    const required = [];
    for (const [key, def] of Object.entries(spec ?? {})) {
      const { required: req, ...rest } = def;
      properties[key] = rest;
      if (req) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
  };
  const T = (name2, description, parameters, execute) => ctx.tools.register({
    name: name2,
    description,
    parameters: compileParameters(parameters),
    output: {
      schema: {},
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args) {
      return await Promise.resolve(execute(args)).catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
    }
  });
  T("email_search", "\u641C\u7D22\u672C\u5730\u90AE\u4EF6\u7D22\u5F15\uFF08\u5168\u6587/\u4E3B\u9898/\u53D1\u4EF6\u4EBA\uFF0C\u4E2D\u6587\u53EF\u7528\uFF1B\u670D\u52A1\u7AEF\u641C\u7D22\u4E0D\u53EF\u7528\u6545\u5168\u90E8\u672C\u5730\u68C0\u7D22\uFF09\u3002query \u81F3\u5C11 3 \u4E2A\u5B57\u7B26\u8D70\u5168\u6587\u7D22\u5F15\uFF0C\u77ED\u8BCD\u81EA\u52A8\u56DE\u9000\u6A21\u7CCA\u5339\u914D\u3002", {
    query: { type: "string", description: "\u5173\u952E\u8BCD\uFF08\u4E2D\u6587/\u82F1\u6587\u5747\u53EF\uFF09" },
    mailbox: { type: "string", description: "限定文件夹（如 INBOX、垃圾邮件、已发送）" },
    from: { type: "string", description: "\u6309\u53D1\u4EF6\u4EBA\u5730\u5740\u6216\u59D3\u540D\u8FC7\u6EE4\uFF08\u5B50\u4E32\uFF09" },
    since_days: { type: "number", description: "\u53EA\u770B\u6700\u8FD1 N \u5929" },
    thread_id: { type: "number", description: "\u9650\u5B9A\u7EBF\u7A0B id" },
    unread_only: { type: "boolean", description: "\u53EA\u770B\u672A\u8BFB" },
    has_attachment: { type: "boolean", description: "\u53EA\u770B\u5E26\u9644\u4EF6" },
    limit: { type: "number", description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650\uFF08\u9ED8\u8BA4 20\uFF0C\u6700\u5927 200\uFF09" }
  }, (args) => {
    const hits = service(ctx).search({
      query: args.query,
      from: args.from,
      sinceDays: args.since_days,
      threadId: args.thread_id,
      unreadOnly: args.unread_only,
      hasAttachment: args.has_attachment,
      limit: args.limit
    });
    return { ok: true, count: hits.length, hits };
  });
  T("email_recent", "\u5217\u51FA\u6700\u8FD1\u65B0\u90AE\u4EF6\uFF08\u9ED8\u8BA4 24 \u5C0F\u65F6\uFF09\u3002", {
    hours: { type: "number", description: "\u56DE\u770B\u5C0F\u65F6\u6570\uFF08\u9ED8\u8BA4 24\uFF09" }
  }, (args) => {
    const hits = service(ctx).recent(args.hours ?? 24);
    return { ok: true, count: hits.length, hits };
  });
  T("email_threads", "\u5217\u51FA\u90AE\u4EF6\u7EBF\u7A0B\uFF08\u540C\u4E00\u4E3B\u9898\u5F80\u6765\u7684\u5F52\u5E76\u7EC4\uFF09\uFF0C\u6309\u6700\u8FD1\u6D3B\u8DC3\u6392\u5E8F\u3002", {
    top: { type: "number", description: "\u8FD4\u56DE\u7EBF\u7A0B\u6570\uFF08\u9ED8\u8BA4 15\uFF09" }
  }, (args) => {
    const list = service(ctx).threads(args.top ?? 15);
    return { ok: true, count: list.length, threads: list };
  });
  T("email_thread_view", "\u67E5\u770B\u4E00\u4E2A\u7EBF\u7A0B\u7684\u5B8C\u6574\u65F6\u95F4\u7EBF\uFF08\u8C01\u5728\u4F55\u65F6\u8BF4\u4E86\u4EC0\u4E48\uFF09\u3002thread_id \u53EF\u4ECE email_search/email_threads \u83B7\u5F97\u3002", {
    thread_id: { type: "number", required: true, description: "\u7EBF\u7A0B id" },
    full_body: { type: "boolean", description: "\u662F\u5426\u5E26\u6B63\u6587\u7247\u6BB5\uFF08\u9ED8\u8BA4\u4EC5\u6458\u8981\uFF09" }
  }, (args) => {
    const timeline = service(ctx).timeline(args.thread_id, args.full_body);
    return { ok: true, count: timeline.length, timeline };
  });
  T("email_sync", "\u624B\u52A8\u89E6\u53D1\u4E00\u6B21\u90AE\u4EF6\u540C\u6B65\uFF08\u5E38\u89C4\u60C5\u51B5\u4E0B\u540E\u53F0\u8F6E\u8BE2\u81EA\u52A8\u540C\u6B65\uFF0C\u65E0\u9700\u8C03\u7528\uFF09\u3002\u8FD4\u56DE\u5404\u6587\u4EF6\u5939\u540C\u6B65\u62A5\u544A\u3002", {}, async () => {
    const report = await service(ctx).sync(true);
    return { ok: true, report };
  });
  T("email_raw", "读取一封邮件的原始内容（RFC822 原文与全部链接），用于正文里的链接丢失、正文缺失等取证场景。mailbox+uid 可从 email_search 结果获得。", {
    mailbox: { type: "string", required: true, description: "文件夹（如 INBOX / 垃圾邮件）" },
    uid: { type: "number", required: true, description: "邮件 uid" },
    max_chars: { type: "number", description: "返回原文的最大字符数（默认 50000）" }
  }, (args) => service(ctx).readRaw(args.mailbox, args.uid, args.max_chars));
  T("email_stats", "\u672C\u5730\u90AE\u4EF6\u5E93\u7EDF\u8BA1\uFF1A\u603B\u6570/\u7EBF\u7A0B\u6570/\u672A\u8BFB/\u65F6\u95F4\u8303\u56F4\u3002", {}, () => service(ctx).stats());
  T("email_mark_read", "\u6807\u8BB0\u90AE\u4EF6\u4E3A\u5DF2\u8BFB\uFF1A\u7ED9 mailbox+uid \u6807\u5355\u5C01\uFF0C\u6216\u7ED9 thread_id \u6807\u6574\u4E2A\u7EBF\u7A0B\u3002", {
    mailbox: { type: "string", description: "\u90AE\u7BB1\u6587\u4EF6\u5939\uFF08\u5982 INBOX\uFF09" },
    uid: { type: "number", description: "\u6D88\u606F uid\uFF08\u4E0E mailbox \u914D\u5408\u4F7F\u7528\uFF09" },
    thread_id: { type: "number", description: "\u7EBF\u7A0B id\uFF08\u6807\u8BB0\u6574\u4E2A\u7EBF\u7A0B\u7684\u6240\u6709\u672A\u8BFB\uFF09" }
  }, (args) => service(ctx).markRead(args));
  T("email_attachment_list", "\u5217\u51FA\u90AE\u4EF6\u9644\u4EF6\uFF1A\u6309 thread_id \u6216 mailbox+uid\u3002\u8FD4\u56DE\u9644\u4EF6 id\u3001\u6587\u4EF6\u540D\u3001\u7C7B\u578B\u3001\u5927\u5C0F\u3002", {
    thread_id: { type: "number", description: "\u7EBF\u7A0B id" },
    mailbox: { type: "string", description: "\u90AE\u7BB1\u6587\u4EF6\u5939" },
    uid: { type: "number", description: "\u6D88\u606F uid" }
  }, (args) => service(ctx).listAttachments(args));
  T("email_attachment_get", "\u4E0B\u8F7D\u9644\u4EF6\u5230\u672C\u5730\u5E76\u8FD4\u56DE\u6587\u4EF6\u8DEF\u5F84\uFF08\u540E\u7EED\u53EF\u7528\u8BFB\u6587\u4EF6\u5DE5\u5177\u67E5\u770B\uFF09\u3002", {
    attachment_id: { type: "number", required: true, description: "email_attachment_list \u8FD4\u56DE\u7684\u9644\u4EF6 id" },
    save_dir: { type: "string", description: "\u4FDD\u5B58\u76EE\u5F55\uFF08\u76F8\u5BF9\u63D2\u4EF6\u76EE\u5F55\uFF0C\u7F3A\u7701\u7528\u914D\u7F6E\u7684 attachmentDir\uFF09" }
  }, (args) => service(ctx).getAttachment(args.attachment_id, args.save_dir));
  T("email_send", "\u53D1\u9001\u90AE\u4EF6\uFF08SMTP\uFF09\u3002\u56DE\u590D\u573A\u666F\u7ED9 reply_to_thread_id \u6216 reply_to_message_id\uFF0C\u81EA\u52A8\u8865 In-Reply-To/References \u4E0E Re: \u524D\u7F00\uFF0C\u5BF9\u65B9\u90AE\u4EF6\u5BA2\u6237\u7AEF\u4F1A\u5F52\u5230\u540C\u4E00\u4F1A\u8BDD\u3002", {
    to: { type: "string", required: true, description: "\u6536\u4EF6\u4EBA\u5730\u5740\uFF0C\u591A\u4E2A\u7528\u9017\u53F7\u5206\u9694" },
    body: { type: "string", required: true, description: "\u6B63\u6587\uFF08\u7EAF\u6587\u672C\uFF09" },
    subject: { type: "string", description: "\u4E3B\u9898\uFF08\u56DE\u590D\u65F6\u53EF\u7701\u7565\uFF0C\u81EA\u52A8\u751F\u6210 Re:\uFF09" },
    cc: { type: "string", description: "\u6284\u9001\uFF0C\u591A\u4E2A\u9017\u53F7\u5206\u9694" },
    reply_to_thread_id: { type: "number", description: "\u8981\u56DE\u590D\u7684\u7EBF\u7A0B id" },
    reply_to_message_id: { type: "string", description: "\u8981\u56DE\u590D\u7684\u539F\u90AE\u4EF6 message-id" }
  }, (args) => service(ctx).send(args));


  // ── 邮箱连接配置卡（设置 → 插件 → 邮件）：宿主 settings 命名空间 ──
  // 值持久化在宿主 settings 文档；配置变更即时生效（销毁服务实例，下次调用按新配置重建）。
  ctx.inject(["settings"], (sctx) => {
    if (typeof sctx.settings?.installSection !== "function") {
      return;
    }
    try {
      sctx.settings.installSection(ctx, "dsh-email", MailSettings, {
      user: process.env.EMAIL_IMAP_USER ?? "",
      host: "imap.263.net",
      port: 993,
      tlsMode: "tls",
      smtpHost: "smtp.263.net",
      smtpPort: 25,
      pollSeconds: 60,
      backfillDays: 90
    }, {
      setSource: (current) => { settingsOverride = current; },
      onChange: () => {
        try { svc?.stopPolling(); void svc?.shutdown(); } catch { }
        svc = null;
        svcError = null;
        // 配置变更后立即按新配置重建服务并恢复后台轮询
        // （轮询定时器在服务实例上，只销毁不重建会让同步静默停摆）
        try {
          service(ctx).startPolling();
          console.log("[dsh-email][settings] 配置已变更，服务按新配置重建并恢复轮询");
        } catch (e) {
          console.warn("[dsh-email][settings] 新配置下服务重建暂缓（如凭据不全），待下次调用诊断:", String(e?.message ?? e));
        }
      }
    });
      console.log("[dsh-email][settings] 命名空间 dsh-email 注册成功");
    } catch (e) {
      console.error("[dsh-email][settings] 命名空间注册失败:", e);
    }
  });

  // ── 重要邮件提醒通道（SSE）：浏览器 EventSource 订阅 /dsh-email/notify ──
  ctx.inject(["webServer"], (hostCtx) => {
    hostCtx.effect(() => hostCtx.webServer.register({
      kind: "exact",
      path: "/dsh-email/notify",
      handler: (request, response) => {
        // 与 dshmarket 下载路由同款信任边界：loopback 对端、无代理转发头、
        // 无 Origin 放行（EventSource 同源 GET 不带 Origin）、有 Origin 必须==Host
        const loopbackOk = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress ?? "");
        const noProxy = request.headers.forwarded === undefined
          && request.headers["x-forwarded-for"] === undefined
          && request.headers["x-real-ip"] === undefined;
        let originOk = true;
        if (typeof request.headers.origin === "string" && typeof request.headers.host === "string") {
          try { originOk = new URL(request.headers.origin).host === request.headers.host; } catch { originOk = false; }
        }
        if (!loopbackOk || !noProxy || !originOk) { response.writeHead(403); response.end(); return; }
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "connection": "keep-alive"
        });
        response.write("retry: 3000\n\n");
        const write = (chunk) => response.write(chunk);
        notifyListeners.add(write);
        const heartbeat = setInterval(() => { try { response.write(": ping\n\n"); } catch { } }, 25000);
        request.on("close", () => { clearInterval(heartbeat); notifyListeners.delete(write); });
      }
    }), "dsh-email: notify sse");
  });

  const user = c.user ?? process.env.EMAIL_IMAP_USER;
  const pass = process.env[c.passwordEnv ?? "EMAIL_IMAP_PASS"];
  if (user && pass) {
    const timer = setTimeout(() => {
      try {
        service(ctx).startPolling(c.pollSeconds ?? 60);
      } catch {
      }
    }, 1e4);
    ctx.effect(() => {
      clearTimeout(timer);
      svc?.stopPolling();
      void svc?.shutdown();
      // 配置变更触发 fiber 重挂载：清掉单例，下次调用按新配置重建服务
      svc = null;
      svcError = null;
    });
  } else {
    ctx.effect(() => {
      void svc?.shutdown();
      svc = null;
      svcError = null;
    });
  }
}
// 设置命名空间的配置 schema（设置 → 插件 → 邮件卡自动渲染表单；密码脱敏由宿主处理）
var MailSettings = z.object({
  user: z.string().description("邮箱账号（IMAP 登录名）"),
  pass: z.string().role("secret").description("邮箱密码（未设置时回退环境变量 EMAIL_IMAP_PASS）"),
  host: z.string().description("IMAP 收件服务器（263：imap.263.net）"),
  port: z.number().description("IMAP 端口（默认 993，SSL）"),
  tlsMode: z.string().description("加密方式：tls / starttls / none（默认 tls）"),
  smtpHost: z.string().description("SMTP 发件服务器（263：smtp.263.net）"),
  smtpPort: z.number().description("SMTP 端口（263 为 25 无 SSL；465 自动 SSL）"),
  smtpUser: z.string().description("SMTP 账号（默认同邮箱账号）"),
  smtpPass: z.string().role("secret").description("SMTP 密码（默认同 IMAP 密码）"),
  folders: z.array(z.string()).description("同步的文件夹（默认 INBOX 与 已发送）"),
  pollSeconds: z.number().default(60).description("后台同步间隔秒（默认 60）"),
  backfillDays: z.number().description("首次同步回填天数（默认 90）"),
  notifyEnabled: z.boolean().default(false).description("开启重要新邮件提醒（浏览器桌面通知 + 页内横幅）"),
  notifyAll: z.boolean().default(false).description("所有新邮件都提醒（慎开，容易骚扰）"),
  notifyFrom: z.array(z.string()).description("重要发件人白名单（地址或姓名，子串匹配）"),
  notifyKeywords: z.array(z.string()).description("主题关键词（命中任一即提醒）")
});
// 宿主插件配置页渲染的配置 schema（cordis 读取插件导出的 Config）。
// 字段与 resolveConfig 的 override 入参一一对应；密码只走环境变量
// （passwordEnv 指定变量名），不落任何配置文件。
export const Config = (() => {
  const schema = z.object({
  user: z.string().description("邮箱账号（IMAP 登录名；留空回退环境变量 EMAIL_IMAP_USER）"),
  passwordEnv: z.string().default("EMAIL_IMAP_PASS").description("存邮箱密码的环境变量名"),
  host: z.string().default("imap.263.net").description("IMAP 收件服务器"),
  port: z.number().default(993).description("IMAP 端口"),
  tlsMode: z.string().default("tls").description("加密方式：tls / starttls / none"),
  dbPath: z.string().description("本地 SQLite 索引库路径（默认 mail.db，相对插件目录）"),
  folders: z.array(z.string()).default(["INBOX", "已发送", "垃圾邮件"]).description("同步的文件夹列表"),
  backfillDays: z.number().default(90).description("首次回填天数"),
  pollSeconds: z.number().default(60).description("轮询同步间隔秒数（最小 30）"),
  smtpHost: z.string().default("smtp.263.net").description("SMTP 发件服务器"),
  smtpPort: z.number().default(25).description("SMTP 端口（465 自动 SSL，587 走 STARTTLS）"),
  smtpUser: z.string().description("SMTP 账号（默认同 IMAP user；密码走环境变量 EMAIL_SMTP_PASS，缺省回退 IMAP 密码）"),
  attachmentDir: z.string().description("附件下载保存目录（相对插件目录，默认 data/attachments）"),
  maxSourceBytes: z.number().description("单封邮件正文抓取的大小上限字节（默认 10MB；超限邮件跳过正文与附件索引）"),
  pass: z.string().role("secret").description("邮箱密码（未设置时回退环境变量 EMAIL_IMAP_PASS）"),
  smtpPass: z.string().role("secret").description("SMTP 密码（默认同邮箱密码）"),
  notifyEnabled: z.boolean().default(false).description("开启重要新邮件提醒（浏览器桌面通知 + 页内横幅）"),
  notifyAll: z.boolean().default(false).description("所有新邮件都提醒（慎开，容易骚扰）"),
  notifyFrom: z.array(z.string()).description("重要发件人白名单（地址或姓名，子串匹配）"),
  notifyKeywords: z.array(z.string()).description("主题关键词（命中任一即提醒）")
});
  // npm 版 schemastery 没有 .volatile()（宿主 vendor 增强才有），直接注入 meta：
  // 0.2.0 的设置表单只收录 meta.volatile 字段，不标的插件整个不进 describe
  for (const child of Object.values(schema.dict ?? {})) child.meta.volatile = true;
  return schema;
})();
export {
  apply,
  inject,
  name
};
