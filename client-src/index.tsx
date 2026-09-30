/**
 * 浏览器半边（DSH 0.2.0 形态）：
 * 1) 设置 → 插件 →「邮件」标签页（settings.plugins.tab 槽）：邮箱连接与提醒规则表单，
 *    读写经 remote.settings——写入落 profile patch 的 email-tools entry config，
 *    宿主自动按新配置重挂载插件，保存即生效
 * 2) 重要新邮件提醒：宿主 SSE（/dsh-email/notify）→ 桌面通知 + 页内横幅
 */
import { createElement as h, useSyncExternalStore } from 'react'
import { MailSettingsTab } from './settings-tab.tsx'

export const name = 'dsh-email'
export const inject = ['slots', 'locale', 'remote', 'remote.settings']

/** 词典命名空间（标签页 locale 字段所需，极小词条） */
const NS = 'dsh-email'
const zh = { tab: '邮件' }
const en = { tab: 'Mail' }

/** 注入给表单的读写面（remote.settings 的窄化封装） */
export interface SettingsFace {
  describe(): Promise<{ namespaces: unknown[] } | { error: string }>
  mutate(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, revision?: number): Promise<{ ok: boolean; error?: string }>
}

interface ImportantMail {
  subject: string
  from: string
  snippet: string
  tag: string
}

interface Banner extends ImportantMail {
  key: number
}

// ── 模块级状态（横幅队列 + 通知权限快照），渲染器经 useSyncExternalStore 消费 ──
let banners: Banner[] = []
let permission: NotificationPermission | 'unsupported' =
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

const store = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  },
  getBanners(): Banner[] {
    return banners
  },
  getPermission(): NotificationPermission | 'unsupported' {
    return permission
  },
}

let bannerSeq = 0
function pushBanner(mail: ImportantMail): void {
  bannerSeq += 1
  const banner: Banner = { ...mail, key: bannerSeq }
  banners = [...banners, banner].slice(-4) // 最多同时 4 条
  emit()
  setTimeout(() => {
    banners = banners.filter(b => b.key !== banner.key)
    emit()
  }, 8000)
}

function showNotification(mail: ImportantMail): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const n = new Notification(`新邮件：${mail.subject}`, {
      body: `${mail.from}\n${mail.snippet}`,
      tag: mail.tag, // 同一封邮件只弹一次
    })
    n.onclick = () => { window.focus(); n.close() }
  } catch { /* 通知失败不影响横幅 */ }
}

function onImportantMails(mails: ImportantMail[]): void {
  for (const mail of mails) {
    showNotification(mail)
    pushBanner(mail)
  }
}

/** SSE 地址相对 document.baseURI 解析（反向代理子路径部署安全） */
function notifyUrl(): string {
  return new URL('dsh-email/notify', document.baseURI).toString()
}

function connectSse(): () => void {
  if (typeof document === 'undefined') return () => {}
  const es = new EventSource(notifyUrl())
  es.addEventListener('important-mail', (ev) => {
    try { onImportantMails(JSON.parse((ev as MessageEvent).data as string) as ImportantMail[]) } catch { /* 忽略坏包 */ }
  })
  return () => es.close()
}

async function requestNotifyPermission(): Promise<void> {
  if (typeof Notification === 'undefined') return
  permission = await Notification.requestPermission()
  emit()
}

export function apply(ctx: {
  slots: {
    inject: (slot: string, register: () => () => void) => () => void
    register: (options: Record<string, unknown>, component: (props?: unknown) => unknown) => () => void
  }
  locale: { register(ns: string, dict: Record<string, Record<string, string>>): unknown }
  remote: { settings: SettingsFace }
  effect: (fn: () => unknown, label?: string) => () => void
}): void {
  // 1) 设置 → 插件 →「邮件」标签页（0.2.0 的插件区 tab 槽）
  ctx.effect(() => {
    try { ctx.locale.register(NS, { zh, en }) } catch { /* 已注册 */ }
    const t = (key: keyof typeof zh) => zh[key] ?? String(key)
    const face: SettingsFace = {
      describe: async () => {
        const response = await ctx.remote.settings.describe()
        return response.ok && response.value !== undefined
          ? { namespaces: response.value.namespaces }
          : { error: response.error?.message ?? 'settings.describe failed' }
      },
      mutate: async (ns, ops, revision) => {
        const response = await ctx.remote.settings.mutate(ns, ops, revision)
        return response.ok ? { ok: true } : { ok: false, error: response.error?.message ?? 'settings.mutate failed' }
      },
    }
    const offTab = ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
      name: 'settings.plugins.tab',
      id: 'dsh-email',
      order: 30,
      label: () => t('tab'),
      locale: NS,
      inject: () => ({ face }),
    }, MailSettingsTab))
    return () => { offTab() }
  }, 'dsh-email: settings tab')

  // 2) 重要邮件提醒：SSE → 桌面通知 + 页内横幅
  ctx.effect(() => {
    const disconnect = connectSse()
    const offOverlay = ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-email-notify', label: () => 'dsh-email' },
        () => h(NotifyLayer),
      ))
    return () => { disconnect(); offOverlay() }
  }, 'dsh-email: notify')
}

function NotifyLayer(): JSX.Element | null {
  const list = useSyncExternalStore(store.subscribe, store.getBanners)
  const perm = useSyncExternalStore(store.subscribe, store.getPermission)
  const showGuide = perm === 'default'
  if (list.length === 0 && !showGuide) return null
  return h('div', {
    style: {
      position: 'fixed', top: '14px', right: '14px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '360px',
      pointerEvents: 'none',
    } satisfies React.CSSProperties,
  },
    showGuide && h('div', {
      style: {
        pointerEvents: 'auto', padding: '8px 12px', borderRadius: '8px',
        background: 'rgba(29,29,31,0.86)', color: '#fff',
        display: 'flex', alignItems: 'center', gap: '8px',
        font: '13px/1.4 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      } satisfies React.CSSProperties,
    },
      h('span', null, '邮件提醒'),
      h('button', {
        type: 'button',
        onClick: () => { void requestNotifyPermission() },
        style: {
          padding: '3px 10px', borderRadius: '6px', border: 'none',
          background: '#2563eb', color: '#fff', font: 'inherit', cursor: 'pointer',
        } satisfies React.CSSProperties,
      }, '开启桌面通知'),
    ),
    ...list.map(b => h('div', {
      key: b.key,
      style: {
        pointerEvents: 'auto', padding: '10px 14px', borderRadius: '10px',
        background: 'rgba(29,29,31,0.92)', color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        font: '13px/1.45 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
      } satisfies React.CSSProperties,
    },
      h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, `✉️ ${b.subject}`),
      h('div', { style: { opacity: 0.85 } }, b.from),
      b.snippet !== '' && h('div', { style: { opacity: 0.65, marginTop: '2px' } }, b.snippet),
    )),
  )
}
