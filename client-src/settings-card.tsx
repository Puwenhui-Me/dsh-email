/**
 * 设置 → 插件 →「邮件」配置卡：邮箱连接与重要邮件提醒规则。
 * 交互与外观对齐宿主 PluginCard 模式：点击头部展开/收起、保存成功自动收起、
 * 未保存标记；颜色全部走宿主主题变量（--dsw-alias-*，跟随「通用设置」外观）。
 * 读写经宿主 settingsScope（revision fence）；「已覆盖」标记与恢复默认基于
 * user 层字段存在性；密码字段不回显，输入新值才写入。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

/** 结构类型：宿主 settingsScope.bind() 的返回（避免跨插件值导入） */
interface ScopeLike {
  getSnapshot(): { status: string; value: unknown; user: unknown; revision?: number }
  subscribe(listener: () => void): () => void
  mutate(ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>, expectedRevision?: number): Promise<void>
}

interface FieldDef {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
  placeholder?: string
  hint?: string
}

/** 字段清单（与宿主半边 MailSettings schema 保持同步） */
const FIELDS: FieldDef[] = [
  { key: 'user', label: '邮箱账号', type: 'string', placeholder: 'name@corp.com' },
  { key: 'pass', label: '邮箱密码', type: 'secret', hint: '留空表示不修改；未设置时使用环境变量' },
  { key: 'host', label: 'IMAP 收件服务器', type: 'string', placeholder: 'imap.263.net' },
  { key: 'port', label: 'IMAP 端口', type: 'number' },
  { key: 'tlsMode', label: '加密方式', type: 'string', placeholder: 'tls（可选 starttls / none）' },
  { key: 'smtpHost', label: 'SMTP 发件服务器', type: 'string', placeholder: 'smtp.263.net' },
  { key: 'smtpPort', label: 'SMTP 端口', type: 'number', hint: '263 为 25（无 SSL）；465 自动 SSL' },
  { key: 'smtpUser', label: 'SMTP 账号', type: 'string', placeholder: '默认同邮箱账号' },
  { key: 'smtpPass', label: 'SMTP 密码', type: 'secret', hint: '默认同邮箱密码；留空表示不修改' },
  { key: 'folders', label: '同步文件夹', type: 'array', placeholder: 'INBOX, 已发送, 垃圾邮件' },
  { key: 'pollSeconds', label: '同步间隔（秒）', type: 'number' },
  { key: 'backfillDays', label: '首次回填天数', type: 'number' },
  { key: 'notifyEnabled', label: '开启重要新邮件提醒', type: 'boolean' },
  { key: 'notifyAll', label: '所有新邮件都提醒', type: 'boolean', hint: '慎开，容易骚扰' },
  { key: 'notifyFrom', label: '重要发件人白名单', type: 'array', placeholder: 'leader@corp.com, 客户A' },
  { key: 'notifyKeywords', label: '主题关键词', type: 'array', placeholder: '审批, 紧急' },
]

export function SettingsCard({ scope }: { scope: ScopeLike }): JSX.Element | null {
  // 裸传方法引用会丢 this（scope.store 变 undefined），必须绑定
  const subscribe = useSync(scope, s => s.subscribe.bind(s))
  const getSnapshot = useSync(scope, s => s.getSnapshot.bind(s))
  const snap = useSyncExternalStore(subscribe, getSnapshot)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const saveStarted = useRef(false)

  const current = (snap.value ?? {}) as Record<string, unknown>
  const userLayer = (snap.user ?? {}) as Record<string, unknown>
  const shown = draft ?? current
  const dirty = draft !== null

  // 宿主 PluginCard 同款：保存成功（无失败、无未存编辑）后自动收起
  useEffect(() => {
    if (saving) { saveStarted.current = true; return }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!dirty && !failed) setOpen(false)
  }, [dirty, failed, saving])

  const edit = (key: string, value: unknown): void => {
    setMessage(null)
    setFailed(false)
    setDraft(prev => ({ ...(prev ?? { ...current }), [key]: value }))
  }

  const asText = (f: FieldDef): string => {
    const v = shown[f.key]
    if (f.type === 'array') return Array.isArray(v) ? v.join(', ') : String(v ?? '')
    return String(v ?? '')
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    try {
      const ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }> = []
      for (const f of FIELDS) {
        const after = draft[f.key]
        if (after === undefined) continue // 未改动
        if (f.type === 'secret' && String(after) === '') continue // 密码留空 = 不修改
        const before = current[f.key]
        if (JSON.stringify(after) === JSON.stringify(before)) continue
        ops.push({ op: 'set', path: [f.key], value: after })
      }
      if (ops.length > 0) await scope.mutate(ops, snap.revision)
      setDraft(null)
      setFailed(false)
      setMessage(ops.length > 0 ? '已保存，即时生效' : '无更改')
    } catch (e) {
      setFailed(true)
      setMessage(`保存失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  const resetField = async (f: FieldDef): Promise<void> => {
    setSaving(true)
    try {
      await scope.mutate([{ op: 'unset', path: [f.key] }], snap.revision)
      if (draft !== null) {
        const next = { ...draft }
        delete next[f.key]
        setDraft(next)
      }
      setMessage(`已恢复默认：${f.label}`)
    } catch (e) {
      setFailed(true)
      setMessage(`恢复失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  if (snap.status !== 'ready') {
    if (snap.status === 'unavailable') return null // 宿主未暴露该命名空间时不留痕迹
    return <div style={{ ...cardStyle, padding: '12px 16px', color: 'var(--dsw-alias-label-tertiary)' }}>邮件配置加载中…</div>
  }

  return (
    <div style={cardStyle}>
      {/* 头部：点击展开/收起（宿主 PluginCard 同款交互） */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
          background: 'transparent', border: 'none', padding: '2px 0',
          color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto' }}>
          <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--dsw-alias-label-primary)' }}>邮件</span>
          <span style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }}>邮箱连接（IMAP/SMTP）与重要新邮件提醒</span>
        </span>
        {dirty && <span style={{ fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px', padding: '1px 6px' }}>未保存</span>}
        <IconChevronDownOutline14 style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flex: '0 0 auto' }} />
      </button>

      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
          {FIELDS.map((f) => {
            const overridden = Object.hasOwn(userLayer, f.key)
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                  {f.label}
                  {f.type === 'secret'
                    ? (overridden && <span style={{ marginLeft: '6px', color: 'var(--dsw-alias-brand-primary)' }}>·已设置</span>)
                    : (overridden && <span style={{ marginLeft: '6px', color: 'var(--dsw-alias-brand-primary)' }} title="用户已覆盖默认值">·已覆盖</span>)}
                  {overridden && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => { void resetField(f) }}
                      style={{ marginLeft: '8px', padding: '0 6px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px', background: 'transparent', font: 'inherit', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}
                    >恢复默认</button>
                  )}
                </span>
                {f.type === 'boolean'
                  ? <input
                      type="checkbox"
                      checked={shown[f.key] === true}
                      onChange={(e) => { edit(f.key, e.target.checked) }}
                      style={{ width: '16px', height: '16px' }}
                    />
                  : <input
                      type={f.type === 'secret' ? 'password' : 'text'}
                      value={f.type === 'secret' ? String(draft?.[f.key] ?? '') : asText(f)}
                      placeholder={f.placeholder ?? (f.type === 'secret' ? '输入新值（不回显）' : '')}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (f.type === 'number') edit(f.key, raw === '' ? undefined : Number(raw))
                        else if (f.type === 'array') edit(f.key, raw === '' ? [] : raw.split(/[,，]/).map(s => s.trim()).filter(s => s !== ''))
                        else edit(f.key, raw)
                      }}
                      style={{
                        width: '100%', padding: '6px 10px', font: 'inherit', boxSizing: 'border-box',
                        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
                        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
                      }}
                    />}
                {f.hint !== undefined && <span style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' }}>{f.hint}</span>}
              </label>
            )
          })}
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => { void save() }}
              style={{
                padding: '6px 16px', borderRadius: '6px', font: 'inherit',
                border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)',
                color: 'var(--dsw-alias-label-primary-foreground)', cursor: dirty ? 'pointer' : 'default',
                opacity: dirty ? 1 : 0.6,
              }}
            >{saving ? '保存中…' : '保存'}</button>
            {dirty && (
              <button
                type="button"
                disabled={saving}
                onClick={() => { setDraft(null); setMessage(null); setFailed(false) }}
                style={{ padding: '6px 16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', background: 'transparent', font: 'inherit', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer' }}
              >放弃更改</button>
            )}
            {message !== null && <span style={{ fontSize: '12px', color: failed ? 'var(--dsw-alias-label-error)' : 'var(--dsw-alias-label-secondary)' }}>{message}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

/** 从 scope 派生稳定回调（绑定 this） */
function useSync<T>(scope: ScopeLike, pick: (s: ScopeLike) => T): T {
  const [fn] = useState(() => pick(scope))
  return fn
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: '10px',
  padding: '12px 16px',
  background: 'var(--dsw-alias-bg-layer-3)',
  font: '13px/1.5 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
  color: 'var(--dsw-alias-label-primary)',
}
