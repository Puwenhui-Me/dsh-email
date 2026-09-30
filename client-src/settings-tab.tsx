/**
 * 设置 → 插件 →「邮件」标签页：邮箱连接与提醒规则表单（DSH 0.2.0 形态）。
 * 数据层：describe 拉取 namespace 视图（schema/value/user/revision），mutate 原子写
 * （落 profile patch 的 entry config，宿主自动重挂载插件）。
 * 「已覆盖」标记与恢复默认基于 user 层字段存在性；密码字段不回显，输入新值才写入。
 */
import { useCallback, useEffect, useState } from 'react'
import type { SettingsFace } from './index.tsx'

interface NamespaceView {
  ns: string
  value?: Record<string, unknown>
  user?: Record<string, unknown>
  revision?: number
}

interface FieldDef {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'secret'
  placeholder?: string
  hint?: string
}

/** 字段清单（与宿主半边 Config schema 保持同步） */
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

export function MailSettingsTab(props: { face: SettingsFace }): JSX.Element {
  const face = props.face
  const [ns, setNs] = useState<string | null>(null)
  const [view, setView] = useState<NamespaceView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async () => {
    setError(null)
    if (face === undefined || typeof face.describe !== 'function') {
      setError('组件未收到设置读写面（inject face 缺失）')
      return
    }
    // 挂起兜底：8 秒无响应按超时报错，不让界面永远停在加载中
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('settings.describe 8 秒未响应')), 8000))
    let result: Awaited<ReturnType<typeof face.describe>>
    try {
      result = await Promise.race([face.describe(), timeout])
    } catch (e) {
      setError(`读取设置失败：${String((e as Error).message)}`)
      return
    }
    if ('error' in result) {
      setError(result.error)
      return
    }
    // 本插件的 namespace：entry id 优先，回退按名字找
    const rows = (result.namespaces ?? []) as NamespaceView[]
    const hit = rows.find(row => row.ns === 'email-tools')
      ?? rows.find(row => row.ns === 'dsh-email')
      ?? rows.find(row => row.ns === '@puwenhui/dsh-email')
    if (hit === undefined) {
      setError(`设置视图中未找到邮件插件命名空间（共 ${String(rows.length)} 个：${rows.map(r => r.ns).slice(0, 8).join(', ')}…）`)
      return
    }
    setNs(hit.ns)
    setView(hit)
    setDraft(null)
  }, [face])

  useEffect(() => { void reload() }, [reload])

  const current = (view?.value ?? {}) as Record<string, unknown>
  const userLayer = (view?.user ?? {}) as Record<string, unknown>
  const shown = draft ?? current

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
    if (draft === null || ns === null || view === undefined) return
    setSaving(true)
    try {
      const ops: Array<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }> = []
      for (const f of FIELDS) {
        const after = draft[f.key]
        if (after === undefined) continue
        if (f.type === 'secret' && String(after) === '') continue
        const before = current[f.key]
        if (JSON.stringify(after) === JSON.stringify(before)) continue
        ops.push({ op: 'set', path: [f.key], value: after })
      }
      if (ops.length > 0) {
        const result = await face.mutate(ns, ops, view.revision)
        if (!result.ok) throw new Error(result.error ?? '写入失败')
      }
      setDraft(null)
      setFailed(false)
      setMessage(ops.length > 0 ? '已保存，插件已按新配置自动重载' : '无更改')
      await reload()
    } catch (e) {
      setFailed(true)
      setMessage(`保存失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  const resetField = async (f: FieldDef): Promise<void> => {
    if (ns === null || view === undefined) return
    setSaving(true)
    try {
      const result = await face.mutate(ns, [{ op: 'unset', path: [f.key] }], view.revision)
      if (!result.ok) throw new Error(result.error ?? '写入失败')
      if (draft !== null) {
        const next = { ...draft }
        delete next[f.key]
        setDraft(next)
      }
      setMessage(`已恢复默认：${f.label}`)
      await reload()
    } catch (e) {
      setFailed(true)
      setMessage(`恢复失败：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 10px', font: 'inherit', boxSizing: 'border-box',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
    background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)',
  }

  if (error !== null) {
    return (
      <div style={{ ...cardStyle, color: 'var(--dsw-alias-label-tertiary)' }}>
        邮件配置加载失败：{error}
        <button type="button" onClick={() => { void reload() }} style={{ ...btnStyle, marginLeft: '10px' }}>重试</button>
      </div>
    )
  }
  if (view === null) {
    return <div style={{ ...cardStyle, color: 'var(--dsw-alias-label-tertiary)' }}>邮件配置加载中…</div>
  }

  return (
    <div style={cardStyle}>
      <strong style={{ fontSize: '14px' }}>邮箱连接与提醒</strong>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginTop: '12px' }}>
        {FIELDS.map((f) => {
          const overridden = Object.hasOwn(userLayer, f.key)
          return (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
              <span style={{ color: 'var(--dsw-alias-label-secondary)' }}>
                {f.label}
                {overridden && (
                  <span style={{ marginLeft: '6px', color: 'var(--dsw-alias-brand-primary)' }} title="用户已覆盖默认值">
                    {f.type === 'secret' ? '·已设置' : '·已覆盖'}
                  </span>
                )}
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
                    style={inputStyle}
                  />}
              {f.hint !== undefined && <span style={{ fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' }}>{f.hint}</span>}
            </label>
          )
        })}
        <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            disabled={saving || draft === null}
            onClick={() => { void save() }}
            style={{
              padding: '6px 16px', borderRadius: '6px', font: 'inherit',
              border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)',
              color: 'var(--dsw-alias-label-primary-foreground)', cursor: draft === null ? 'default' : 'pointer',
              opacity: draft === null ? 0.6 : 1,
            }}
          >{saving ? '保存中…' : '保存'}</button>
          {draft !== null && (
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
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: '10px',
  padding: '14px 16px',
  background: 'var(--dsw-alias-bg-layer-3)',
  font: '13px/1.5 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
  color: 'var(--dsw-alias-label-primary)',
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px',
  background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
}
