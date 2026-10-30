/**
 * Browser half for dsh-ugreen-nas.
 *
 * Registers the bundle's configuration page in the host's Plugins page.
 * The actual protocol logic stays in the host half; this form only edits the
 * four Config fields and never sees the access token after saving it.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ugreen-nas',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-ugreen-nas'

    const labelStyle = { display: 'block', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)', marginBottom: 4 }
    const inputStyle = {
      width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)', background: 'var(--dsw-alias-bg-l1, #fff)',
      color: 'var(--dsw-alias-label-primary, #1f1f1f)', fontSize: 13,
    }
    const rowStyle = { marginBottom: 14 }
    const hintStyle = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4 }

    function Field(props) {
      return h('div', { style: rowStyle },
        h('label', { style: labelStyle }, props.label),
        props.children,
        props.hint ? h('div', { style: hintStyle }, props.hint) : null,
      )
    }

    function SettingsPage(props) {
      const form = props.form
      const snapshot = form && form.state ? form.state : { status: 'loading', value: undefined }
      const saved = snapshot.value || {}
      const [draft, setDraft] = React.useState(saved)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const serialized = JSON.stringify(saved)
      React.useEffect(() => { setDraft(saved) }, [serialized])

      if (props.view === 'summary') return h('span', null, '绿联 NAS 访问令牌与只读查询工具')
      if (snapshot.status === 'loading') return h('div', { style: hintStyle }, '正在读取插件配置…')
      if (snapshot.status === 'unavailable') return h('div', { style: hintStyle }, '当前宿主机未暴露此插件配置。')

      const set = (field, value) => setDraft((current) => ({ ...current, [field]: value }))
      const save = async () => {
        if (!form || typeof form.set !== 'function') return
        setBusy(true)
        setMessage('')
        try {
          await form.set('endpoint', String(draft.endpoint || '').trim())
          if (String(draft.accessToken || '').trim() !== '') await form.set('accessToken', String(draft.accessToken).trim())
          await form.set('timeoutMs', Number(draft.timeoutMs) || 15000)
          await form.set('rejectUnauthorized', Boolean(draft.rejectUnauthorized))
          setMessage('已保存')
          setDraft((current) => ({ ...current, accessToken: '' }))
        } catch (error) {
          setMessage('保存失败：' + (error && error.message ? error.message : String(error)))
        } finally {
          setBusy(false)
        }
      }

      return h('div', { style: { maxWidth: 560 } },
        h('h3', { style: { margin: '0 0 6px', fontSize: 15 } }, '绿联 NAS 连接'),
        h('p', { style: { ...hintStyle, marginBottom: 16 } }, '使用访问令牌调用 UGOS Pro OpenCLI。当前插件只注册只读工具。'),
        h(Field, { label: 'NAS 地址', hint: 'IP、UGREENlink ID、DDNS 或完整 URL；裸 IP 默认加 https://:9443' },
          h('input', { style: inputStyle, value: draft.endpoint || '', placeholder: 'https://192.168.1.10:9443', onChange: (e) => set('endpoint', e.target.value) })),
        h(Field, { label: '访问令牌', hint: '格式为 ugpoa_v1.<token_id>.<secret>；已保存时留空表示不修改' },
          h('input', { style: inputStyle, type: 'password', value: draft.accessToken || '', placeholder: '<访问令牌>', onChange: (e) => set('accessToken', e.target.value) })),
        h(Field, { label: '超时（毫秒）' },
          h('input', { style: inputStyle, type: 'number', min: 1000, value: draft.timeoutMs || 15000, onChange: (e) => set('timeoutMs', Number(e.target.value)) })),
        h(Field, { label: '校验 HTTPS 证书', hint: 'NAS 自签证书保持关闭；有可信证书时再打开' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h('input', { type: 'checkbox', checked: Boolean(draft.rejectUnauthorized), onChange: (e) => set('rejectUnauthorized', e.target.checked) }),
            '启用证书校验')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 } },
          h('button', { type: 'button', disabled: busy, onClick: save, style: { padding: '7px 16px', borderRadius: 6, border: 0, background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff', cursor: busy ? 'wait' : 'pointer' } }, busy ? '保存中…' : '保存配置'),
          message ? h('span', { style: hintStyle }, message) : null),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: NS,
      }, (props) => h(SettingsPage, props)))
    }

    return { name: NS, inject: ['slots'], apply, SettingsPage }
  },
})
