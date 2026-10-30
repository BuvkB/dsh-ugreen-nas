/**
 * Browser half for dsh-ugreen-nas.
 *
 * Registers the bundle's configuration page in the host's Plugins page. This
 * host build passes no form object to plugins.bundle.config, so the page reads
 * and writes settings through the plugin's own 'ug' Remote gateway over the
 * authenticated /api RPC channel (lib/gateway.js). The access token is write-
 * only: the status call reports its presence, never its value.
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
    const buttonStyle = (busy) => ({
      padding: '7px 16px', borderRadius: 6, border: 0, cursor: busy ? 'wait' : 'pointer',
      background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff',
    })
    const ghostButtonStyle = {
      padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
      border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
      background: 'var(--dsw-alias-bg-l1, #fff)', color: 'var(--dsw-alias-label-primary, #1f1f1f)',
    }

    function makeInvoke(connection) {
      return async (method, args = {}) => {
        if (!connection || typeof connection.rpc?.call !== 'function') {
          const error = new Error('连接通道不可用（请刷新页面）')
          error.code = 'no_connection'
          throw error
        }
        const result = await connection.rpc.call('/api', `ug/${method}`, { args })
        if (!result || !result.ok) {
          const error = new Error(result?.error?.message ?? `ug.${method} 调用失败`)
          error.code = result?.error?.code ?? 'rpc_error'
          throw error
        }
        return result.value
      }
    }

    function Field(props) {
      return h('div', { style: rowStyle },
        h('label', { style: labelStyle }, props.label),
        props.children,
        props.hint ? h('div', { style: hintStyle }, props.hint) : null,
      )
    }

    function SettingsPage(props) {
      const invoke = props.invoke
      const [status, setStatus] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const [endpoint, setEndpoint] = React.useState('')
      const [accessToken, setAccessToken] = React.useState('')
      const [timeoutMs, setTimeoutMs] = React.useState(15000)
      const [rejectUnauthorized, setRejectUnauthorized] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const loadedRef = React.useRef(false)

      React.useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true
        invoke('status')
          .then((value) => {
            setStatus(value)
            setEndpoint(value.endpoint || '')
            setTimeoutMs(value.timeoutMs || 15000)
            setRejectUnauthorized(Boolean(value.rejectUnauthorized))
          })
          .catch((error) => setLoadError(error?.message ?? String(error)))
      }, [])

      if (props.view === 'summary') {
        return h('span', null, status?.configured ? `已连接 ${status.endpoint || ''}` : '绿联 NAS 访问令牌与只读查询工具（未配置）')
      }
      if (loadError) return h('div', { style: { ...hintStyle, color: 'var(--dsw-alias-state-danger, #d4380d)' } }, '读取配置失败：' + loadError)
      if (!status) return h('div', { style: hintStyle }, '正在读取插件配置…')

      const save = async () => {
        setBusy(true)
        setMessage(null)
        try {
          const next = await invoke('save', {
            endpoint,
            accessToken,
            timeoutMs: Number(timeoutMs) || 15000,
            rejectUnauthorized,
          })
          setStatus(next)
          setEndpoint(next.endpoint || '')
          setAccessToken('')
          setMessage({ kind: 'ok', text: '已保存' })
        } catch (error) {
          setMessage({ kind: 'err', text: '保存失败：' + (error?.message ?? String(error)) })
        } finally {
          setBusy(false)
        }
      }
      const test = async () => {
        setTesting(true)
        setMessage(null)
        try {
          const result = await invoke('test')
          const apps = result?.apps?.status ?? result?.apps ?? {}
          const names = Object.keys(apps)
          setMessage({ kind: 'ok', text: `连接成功：${names.join('、') || '无应用'}` })
        } catch (error) {
          setMessage({ kind: 'err', text: '连接失败：' + (error?.message ?? String(error)) })
        } finally {
          setTesting(false)
        }
      }

      return h('div', { style: { maxWidth: 560 } },
        h('h3', { style: { margin: '0 0 6px', fontSize: 15 } }, '绿联 NAS 连接'),
        h('p', { style: { ...hintStyle, marginBottom: 16 } }, '使用访问令牌调用 UGOS Pro OpenCLI。当前插件只注册只读工具。'),
        h(Field, { label: 'NAS 地址', hint: 'IP、UGREENlink ID、DDNS 或完整 URL；裸 IP 默认加 https://:9443' },
          h('input', { style: inputStyle, value: endpoint, placeholder: 'https://192.168.1.10:9443', onChange: (e) => setEndpoint(e.target.value) })),
        h(Field, { label: status?.hasToken ? '访问令牌（已保存，留空表示不修改）' : '访问令牌', hint: '格式为 ugpoa_v1.<token_id>.<secret>；只在创建时完整显示一次' },
          h('input', { style: inputStyle, type: 'password', value: accessToken, placeholder: '<访问令牌>', onChange: (e) => setAccessToken(e.target.value) })),
        h(Field, { label: '超时（毫秒）' },
          h('input', { style: inputStyle, type: 'number', min: 1000, value: timeoutMs, onChange: (e) => setTimeoutMs(Number(e.target.value)) })),
        h(Field, { label: '校验 HTTPS 证书', hint: 'NAS 自签证书保持关闭；有可信证书时再打开' },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 } },
            h('input', { type: 'checkbox', checked: rejectUnauthorized, onChange: (e) => setRejectUnauthorized(e.target.checked) }),
            '启用证书校验')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' } },
          h('button', { type: 'button', disabled: busy, onClick: save, style: buttonStyle(busy) }, busy ? '保存中…' : '保存配置'),
          h('button', { type: 'button', disabled: testing || busy, onClick: test, style: ghostButtonStyle }, testing ? '测试中…' : '测试连接'),
          message ? h('span', { style: { ...hintStyle, color: message.kind === 'err' ? 'var(--dsw-alias-state-danger, #d4380d)' : 'var(--dsw-alias-state-success, #389e0d)' } }, message.text) : null),
      )
    }

    function apply(ctx) {
      const connection = ctx.get('connection')
      const invoke = makeInvoke(connection)
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: NS,
      }, (props) => h(SettingsPage, { ...props, invoke })))
    }

    return { name: NS, inject: ['slots', 'connection'], apply, SettingsPage }
  },
})
