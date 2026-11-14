/**
 * Browser half for dsh-ugreen-nas.
 *
 * Registers the bundle configuration page in the Plugins page. The access
 * token is write-only: status reports its presence, never its value.
 *
 * Visual language follows the official plugin settings pages: full-width
 * content, bordered 10px cards, 14px section titles, 12px tertiary
 * descriptions and 0.5px dividers. All colors come from --dsw-alias-* tokens
 * so light and dark themes are rendered by the host.
 */

window.__ModuleLoader__.load({
  id: 'dsh-ugreen-nas',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-ugreen-nas'
    const CSS = "\n.ugn-page { width: 100%; box-sizing: border-box; margin: 0; padding: 12px 0 28px; counter-reset: ugn-section; color: var(--dsw-alias-label-primary); display: flex; flex-direction: column; gap: 14px; font-size: 13px; }\n.ugn-hero { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 2px 2px 4px; }\n.ugn-brand { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }\n.ugn-mark { width: 42px; height: 42px; border-radius: 10px; overflow: hidden; flex: none; }\n.ugn-mark-icon, .ugn-mark-icon svg { display: block; width: 100%; height: 100%; }\n.ugn-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -.01em; }\n.ugn-sub { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }\n.ugn-status { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }\n.ugn-status[data-tone=\"ok\"] { color: var(--dsw-alias-state-success-primary); }\n.ugn-status[data-tone=\"error\"] { color: var(--dsw-alias-state-error-primary); }\n.ugn-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); flex: none; }\n.ugn-status[data-tone=\"ok\"] .ugn-dot { background: var(--dsw-alias-state-success-primary); }\n.ugn-status[data-tone=\"error\"] .ugn-dot { background: var(--dsw-alias-state-error-primary); }\n.ugn-card { counter-increment: ugn-section; border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 0.7%, var(--dsw-alias-bg-base)); overflow: hidden; box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }\n.ugn-card-head { padding: 15px 16px 12px; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }\n.ugn-card-head-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }\n.ugn-card-title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }\n.ugn-card-title::before { content: counter(ugn-section, decimal-leading-zero); margin-right: 8px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .08em; }\n.ugn-card-desc { margin: 3px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.ugn-form { padding: 12px 16px 10px; }\n.ugn-row { display: grid; grid-template-columns: 128px minmax(0, 1fr); gap: 12px; align-items: start; padding: 12px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }\n.ugn-row:last-child { border-bottom: 0; }\n.ugn-label { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 34px; }\n.ugn-control { min-width: 0; }\n.ugn-input, .ugn-select { width: 100%; height: 34px; box-sizing: border-box; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-layer-1, transparent); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }\n.ugn-input::placeholder { color: var(--dsw-alias-label-tertiary); }\n.ugn-input:focus, .ugn-select:focus { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); }\n.ugn-hint { margin: 5px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.ugn-suffix { position: relative; }\n.ugn-suffix .ugn-input { padding-right: 44px; }\n.ugn-suffix-unit { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--dsw-alias-label-tertiary); font-size: 12px; pointer-events: none; }\n.ugn-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 34px; cursor: pointer; }\n.ugn-switch-row span { color: var(--dsw-alias-label-primary); font-size: 13px; }\n.ugn-switch { appearance: none; width: 36px; height: 20px; border-radius: 999px; background: var(--dsw-alias-border-l2, #d9d9d9); position: relative; cursor: pointer; transition: background .15s ease; flex: none; margin: 0; }\n.ugn-switch::after { content: \"\"; position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #fff; top: 2px; left: 2px; transition: transform .15s ease; box-shadow: 0 1px 2px rgba(0,0,0,.18); }\n.ugn-switch:checked { background: var(--dsw-alias-state-business-primary); }\n.ugn-switch:checked::after { transform: translateX(16px); }\n.ugn-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }\n.ugn-mode { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 0 6px; }\n.ugn-mode button { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 11px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 1%, transparent); color: inherit; font: inherit; cursor: pointer; transition: background-color .12s ease, border-color .12s ease; }\n.ugn-mode button:hover { background: var(--dsw-alias-interactive-bg-hover); }\n.ugn-mode button[data-active=\"true\"] { border-color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, transparent); }\n.ugn-mode-title { font-size: 13px; font-weight: 600; line-height: 18px; }\n.ugn-mode-desc { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 17px; }\n.ugn-caps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px 16px 14px; }\n.ugn-cap { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 9px 10px; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent); }\n.ugn-cap[data-state=\"granted\"] .ugn-dot { background: var(--dsw-alias-state-success-primary); }\n.ugn-cap[data-state=\"denied\"] .ugn-dot { background: var(--dsw-alias-state-error-primary); }\n.ugn-cap-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }\n.ugn-cap-state { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; white-space: nowrap; }\n.ugn-cap[data-state=\"granted\"] .ugn-cap-state { color: var(--dsw-alias-state-success-primary); }\n.ugn-cap[data-state=\"denied\"] .ugn-cap-state { color: var(--dsw-alias-state-error-primary); }\n.ugn-note { margin: 0; padding: 0 16px 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.ugn-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 2px 2px 0; }\n.ugn-btn { height: 32px; padding: 0 14px; border: .5px solid transparent; border-radius: 6px; font: inherit; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }\n.ugn-btn:disabled { cursor: not-allowed; opacity: .55; }\n.ugn-btn-primary { background: var(--dsw-alias-state-business-primary); color: #fff; }\n.ugn-btn-ghost { border-color: var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); }\n.ugn-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n.ugn-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; }\n.ugn-message { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 18px; }\n.ugn-message[data-kind=\"ok\"] { color: var(--dsw-alias-state-success-primary); }\n.ugn-message[data-kind=\"err\"] { color: var(--dsw-alias-state-error-primary); }\n.ugn-alert { border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); padding: 14px 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }\n.ugn-alert[data-kind=\"error\"] { color: var(--dsw-alias-state-error-primary); }\n.ugn-skeleton { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }\n.ugn-skeleton-line { height: 14px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover); }\n@media (max-width: 640px) { .ugn-page { padding-top: 8px; } .ugn-hero { flex-direction: column; gap: 10px; } .ugn-row { grid-template-columns: minmax(0, 1fr); gap: 6px; } .ugn-label { line-height: 18px; } .ugn-mode { grid-template-columns: 1fr; } .ugn-caps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }\n"
    if (typeof document !== 'undefined') {
      const tagId = NS + '/settings.css'
      if (!document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = tagId
        tag.textContent = CSS + ".ugn-textarea { height: auto; min-height: 82px; padding: 10px; padding-right: 10px; resize: vertical; line-height: 20px; }\n.ugn-confirm-help { margin-top: 10px; min-height: 108px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l1); border-left-width: 2px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1, transparent); box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; }\n.ugn-confirm-help[data-tone=\"info\"] { border-left-color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 4%, transparent); }\n.ugn-confirm-help[data-tone=\"warn\"] { border-left-color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 6%, transparent); }\n.ugn-confirm-help[data-tone=\"warn\"] .ugn-confirm-help-main { color: var(--dsw-alias-state-warn-label); }\n.ugn-confirm-help-main { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }\n.ugn-confirm-help-note { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }\n.ugn-mode[data-tone=\"warn\"] button[data-active=\"true\"] { border-color: var(--dsw-alias-state-warn-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 7%, transparent); }"
        document.head.appendChild(tag)
      }
    }
const UGN_ICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\">\n  <defs>\n    <linearGradient id=\"ugn-bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">\n      <stop offset=\"0\" stop-color=\"#38cd66\"/>\n      <stop offset=\"1\" stop-color=\"#1e9e4a\"/>\n    </linearGradient>\n    <linearGradient id=\"ugn-case\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\">\n      <stop offset=\"0\" stop-color=\"#1b2d22\"/>\n      <stop offset=\"1\" stop-color=\"#122019\"/>\n    </linearGradient>\n  </defs>\n  <rect width=\"512\" height=\"512\" rx=\"116\" fill=\"url(#ugn-bg)\"/>\n  <rect x=\"146\" y=\"92\" width=\"220\" height=\"328\" rx=\"30\" fill=\"url(#ugn-case)\" stroke=\"#0d1a12\" stroke-width=\"3\"/>\n  <g stroke=\"#233f2e\" stroke-width=\"2.5\">\n    <rect x=\"176\" y=\"128\" width=\"160\" height=\"64\" rx=\"14\" fill=\"#0d1710\"/>\n    <rect x=\"176\" y=\"216\" width=\"160\" height=\"64\" rx=\"14\" fill=\"#0d1710\"/>\n  </g>\n  <g fill=\"#2e4d3a\">\n    <circle cx=\"206\" cy=\"160\" r=\"10\"/>\n    <circle cx=\"206\" cy=\"248\" r=\"10\"/>\n    <rect x=\"232\" y=\"154\" width=\"84\" height=\"12\" rx=\"6\"/>\n    <rect x=\"232\" y=\"242\" width=\"84\" height=\"12\" rx=\"6\"/>\n  </g>\n  <circle cx=\"206\" cy=\"352\" r=\"18\" fill=\"#8ff5b5\" opacity=\"0.22\"/>\n  <circle cx=\"206\" cy=\"352\" r=\"11\" fill=\"#8ff5b5\"/>\n  <rect x=\"232\" y=\"346\" width=\"84\" height=\"12\" rx=\"6\" fill=\"#2e4d3a\"/>\n</svg>\n";

    const GROUP_META = {
      app: { label: '应用中心', short: '安装与启停' },
      files: { label: '文件管理', short: '读写与标签' },
      storage: { label: '存储管理', short: '磁盘与卷' },
      tasks: { label: '任务管理', short: '系统指标' },
      docker: { label: 'Docker', short: '容器与镜像' },
      downloads: { label: '下载中心', short: '任务管理' },
      ctl: { label: '控制面板', short: '系统与网络' },
      search: { label: '全局搜索', short: '文件检索' },
    }
    const GROUP_ORDER = ['app', 'files', 'storage', 'tasks', 'docker', 'downloads', 'ctl', 'search']
    function makeInvoke(connection) {
      return async (method, args = {}) => {
        if (!connection || typeof connection.rpc?.call !== 'function') {
          const error = new Error('连接通道不可用（请刷新页面）')
          error.code = 'no_connection'
          throw error
        }
        const result = await connection.rpc.call('/api', 'ug/' + method, { args })
        if (!result || !result.ok) {
          const error = new Error(result?.error?.message ?? ('ug.' + method + ' 调用失败'))
          error.code = result?.error?.code ?? 'rpc_error'
          throw error
        }
        return result.value
      }
    }
    function Field(props) {
      return h('div', { className: 'ugn-row' },
        h('label', { className: 'ugn-label', htmlFor: props.id }, props.label),
        h('div', { className: 'ugn-control' },
          props.children,
          props.hint ? h('p', { className: 'ugn-hint' + (props.hintClassName ? ' ' + props.hintClassName : '') }, props.hint) : null,
        ),
      )
    }
    function Button(props) {
      return h('button', {
        type: 'button',
        className: 'ugn-btn ' + (props.variant === 'primary' ? 'ugn-btn-primary' : 'ugn-btn-ghost') + (props.small ? ' ugn-btn-sm' : ''),
        disabled: Boolean(props.disabled),
        onClick: props.onClick,
      }, props.children)
    }
    function SettingsPage(props) {
      const invoke = props.invoke
      const [status, setStatus] = React.useState(null)
      const [loadError, setLoadError] = React.useState('')
      const [endpoint, setEndpoint] = React.useState('')
      const [accessToken, setAccessToken] = React.useState('')
      const [timeoutMs, setTimeoutMs] = React.useState(15000)
      const [rejectUnauthorized, setRejectUnauthorized] = React.useState(false)
      const [mode, setMode] = React.useState('full')
      const [accessLevel, setAccessLevel] = React.useState('admin')
      const [confirmMode, setConfirmMode] = React.useState('ask')
      const [allowedRootsText, setAllowedRootsText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [testing, setTesting] = React.useState(false)
      const [unbinding, setUnbinding] = React.useState(false)
      const [capsBusy, setCapsBusy] = React.useState(false)
      const [caps, setCaps] = React.useState(null)
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
            setMode(value.mode || 'full')
            setAccessLevel(value.accessLevel || 'admin')
            setConfirmMode(value.confirmMode || 'ask')
            setAllowedRootsText(Array.isArray(value.allowedRoots) ? value.allowedRoots.join('\n') : '')
            invoke('capabilities').then((next) => setCaps(next)).catch(() => {})
          })
          .catch((error) => setLoadError(error?.message ?? String(error)))
      }, [])
      if (props.view === 'summary') {
        return h('span', null, status?.configured ? ('已配置 ' + (status.endpoint || '')) : '通过访问令牌连接 UGOS Pro（未配置）')
      }
      if (loadError) {
        return h('div', { className: 'ugn-page' }, h('div', { className: 'ugn-alert', 'data-kind': 'error' }, '读取配置失败：' + loadError))
      }
      if (!status) {
        return h('div', { className: 'ugn-page ugn-skeleton' },
          h('div', { className: 'ugn-skeleton-line', style: { width: '35%' } }),
          h('div', { className: 'ugn-skeleton-line', style: { width: '72%' } }),
          h('div', { className: 'ugn-skeleton-line', style: { width: '58%' } }),
        )
      }
      const refreshCaps = async () => {
        setCapsBusy(true)
        try { setCaps(await invoke('capabilities')) } catch { /* keep previous snapshot */ }
        finally { setCapsBusy(false) }
      }
      const save = async () => {
        setBusy(true)
        setMessage(null)
        try {
          const next = await invoke('save', {
            endpoint,
            accessToken,
            timeoutMs: Number(timeoutMs) || 15000,
            rejectUnauthorized,
            mode,
            accessLevel,
            confirmMode,
            allowedRoots: allowedRootsText.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
          })
          setStatus(next)
          setEndpoint(next.endpoint || '')
          setAccessToken('')
          setMessage({ kind: 'ok', text: '配置已保存' })
          await refreshCaps()
        } catch (error) {
          setMessage({ kind: 'err', text: '保存失败：' + (error?.message ?? String(error)) })
        } finally {
          setBusy(false)
        }
      }
      const unbind = async () => {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function'
          && !window.confirm('解除绑定会清除本机保存的访问令牌，并断开与 NAS 的连接。确定吗？')) return
        setUnbinding(true)
        setMessage(null)
        try {
          const next = await invoke('unbind')
          setStatus(next)
          setAccessToken('')
          setMessage({ kind: 'ok', text: '已解除绑定，访问令牌已清除' })
          await refreshCaps()
        } catch (error) {
          setMessage({ kind: 'err', text: '解除绑定失败：' + (error?.message ?? String(error)) })
        } finally {
          setUnbinding(false)
        }
      }
      const test = async () => {
        setTesting(true)
        setMessage(null)
        try {
          const result = await invoke('test', {
            endpoint,
            accessToken,
            timeoutMs: Number(timeoutMs) || 15000,
            rejectUnauthorized,
          })
          const apps = result?.apps?.status ?? result?.apps ?? {}
          const names = Object.keys(apps)
          setMessage({ kind: 'ok', text: names.length ? ('连接正常：' + names.join('、')) : '连接正常' })
          await refreshCaps()
        } catch (error) {
          setMessage({ kind: 'err', text: '连接失败：' + (error?.message ?? String(error)) })
        } finally {
          setTesting(false)
        }
      }
      const auth = caps?.auth
      const tone = !status.configured ? 'off' : auth === 'invalid' ? 'error' : auth === 'ok' ? 'ok' : 'idle'
      const stateText = !status.configured ? '未配置' : auth === 'invalid' ? '令牌无效' : auth === 'ok' ? '已连接' : '已配置'
      const groups = caps?.groups ?? {}
      const granted = GROUP_ORDER.filter((group) => groups[group] === 'granted').length
      return h('div', { className: 'ugn-page' },
        h('header', { className: 'ugn-hero' },
          h('div', { className: 'ugn-brand' },
            h('div', { className: 'ugn-mark' },
              h('div', { className: 'ugn-mark-icon', title: 'UGREEN NAS', dangerouslySetInnerHTML: { __html: UGN_ICON_SVG } }),
            ),
            h('div', { style: { minWidth: 0 } },
              h('h2', { className: 'ugn-title' }, '绿联 NAS'),
              h('p', { className: 'ugn-sub' }, '通过访问令牌连接 UGOS Pro，让模型帮你管理文件、Docker 和下载任务，并查看系统状态。'),
            ),
          ),
          h('div', { className: 'ugn-status', 'data-tone': tone },
            h('span', { className: 'ugn-dot' }),
            stateText,
          ),
        ),
        h('section', { className: 'ugn-card' },
          h('div', { className: 'ugn-card-head' },
            h('h3', { className: 'ugn-card-title' }, '连接'),
            h('p', { className: 'ugn-card-desc' }, 'OpenCLI 地址和访问令牌，令牌只在保存时写入本机设置。'),
          ),
          h('div', { className: 'ugn-form' },
            h(Field, { id: 'ugn-endpoint', label: 'NAS 地址', hint: 'IP、UGREENlink ID / 短链、DDNS 或完整 URL；裸 IP 默认补 https://:9443，UGREENlink ID 自动解析' },
              h('input', {
                id: 'ugn-endpoint',
                className: 'ugn-input',
                value: endpoint,
                placeholder: '192.168.1.10 或 UGREENlink ID（如 myNAS123）',
                autoComplete: 'off',
                onChange: (event) => setEndpoint(event.target.value),
              }),
            ),
            h(Field, {
              id: 'ugn-token',
              label: '访问令牌',
              hint: status.hasToken ? '已保存。留空表示不修改；重新填写会覆盖旧令牌。' : '格式为「前缀.token_id.secret」，只在创建时完整显示一次。',
            },
              h('input', {
                id: 'ugn-token',
                className: 'ugn-input',
                type: 'password',
                value: accessToken,
                placeholder: status.hasToken ? '已保存，留空不修改' : '粘贴访问令牌',
                autoComplete: 'off',
                onChange: (event) => setAccessToken(event.target.value),
              }),
            ),
            h(Field, { id: 'ugn-timeout', label: '请求超时' },
              h('div', { className: 'ugn-suffix' },
                h('input', {
                  id: 'ugn-timeout',
                  className: 'ugn-input',
                  type: 'number',
                  min: 1000,
                  value: timeoutMs,
                  onChange: (event) => setTimeoutMs(Number(event.target.value)),
                }),
                h('span', { className: 'ugn-suffix-unit' }, '毫秒'),
              ),
            ),
            h('div', { className: 'ugn-row' },
              h('span', { className: 'ugn-label' }, 'HTTPS 证书'),
              h('div', { className: 'ugn-control' },
                h('label', { className: 'ugn-switch-row' },
                  h('span', null, '校验 HTTPS 证书'),
                  h('input', {
                    className: 'ugn-switch',
                    type: 'checkbox',
                    checked: rejectUnauthorized,
                    onChange: (event) => setRejectUnauthorized(event.target.checked),
                  }),
                ),
                h('p', { className: 'ugn-hint' }, 'NAS 自签证书保持关闭；有可信证书时再打开。'),
              ),
            ),
          ),
        ),
        h('section', { className: 'ugn-card' },
          h('div', { className: 'ugn-card-head' },
            h('h3', { className: 'ugn-card-title' }, '工具范围'),
            h('p', { className: 'ugn-card-desc' }, '控制注册给模型的工具数量；无论选哪种，都受 NAS 端令牌权限约束。'),
          ),
          h('div', { className: 'ugn-form' },
            h('div', { className: 'ugn-mode' },
              h('button', { type: 'button', 'data-active': mode === 'full' ? 'true' : 'false', onClick: () => setMode('full') },
                h('span', { className: 'ugn-mode-title' }, '完整能力'),
                h('span', { className: 'ugn-mode-desc' }, '按令牌勾选注册全部工具，含写入、删除和执行。'),
              ),
              h('button', { type: 'button', 'data-active': mode === 'readonly' ? 'true' : 'false', onClick: () => setMode('readonly') },
                h('span', { className: 'ugn-mode-title' }, '只读模式'),
                h('span', { className: 'ugn-mode-desc' }, '只注册只读工具，不暴露写、删、执行能力。'),
              ),
            ),
          ),
        ),
        h('section', { className: 'ugn-card' },
          h('div', { className: 'ugn-card-head' },
            h('h3', { className: 'ugn-card-title' }, '角色与确认'),
            h('p', { className: 'ugn-card-desc' }, '普通用户模式只注册文件、下载与全局搜索工具；写、删、执行操作默认走 DSH 审批。'),
          ),
          h('div', { className: 'ugn-form' },
            h(Field, { id: 'ugn-access-level', label: '账号角色', hint: '按访问令牌所属账号选择；实际权限仍由 NAS 端令牌决定。' },
              h('div', { className: 'ugn-mode' },
                h('button', { type: 'button', 'data-active': accessLevel === 'admin' ? 'true' : 'false', onClick: () => setAccessLevel('admin') },
                  h('span', { className: 'ugn-mode-title' }, '管理员'),
                  h('span', { className: 'ugn-mode-desc' }, '开放应用、Docker、存储、任务与账号管理等系统能力。'),
                ),
                h('button', { type: 'button', 'data-active': accessLevel === 'user' ? 'true' : 'false', onClick: () => setAccessLevel('user') },
                  h('span', { className: 'ugn-mode-title' }, '普通用户'),
                  h('span', { className: 'ugn-mode-desc' }, '仅文件、下载与全局搜索等非系统类能力。'),
                ),
              ),
            ),
            h(Field, { id: 'ugn-confirm-mode', label: '高风险确认' },
              h('div', { className: 'ugn-mode', 'data-tone': confirmMode === 'ask' ? 'info' : 'warn' },
                h('button', { type: 'button', 'data-active': confirmMode === 'ask' ? 'true' : 'false', onClick: () => setConfirmMode('ask') },
                  h('span', { className: 'ugn-mode-title' }, '每次确认'),
                  h('span', { className: 'ugn-mode-desc' }, '写、删除、启停、安装等操作先经 DSH 审批。'),
                ),
                h('button', { type: 'button', 'data-active': confirmMode === 'off' ? 'true' : 'false', onClick: () => setConfirmMode('off') },
                  h('span', { className: 'ugn-mode-title' }, '直接执行'),
                  h('span', { className: 'ugn-mode-desc' }, '关闭插件级确认，仅保留 NAS 令牌权限边界。'),
                ),
              ),
              h('div', { className: 'ugn-confirm-help', 'data-tone': confirmMode === 'ask' ? 'info' : 'warn' },
                h('p', { className: 'ugn-confirm-help-main' },
                  confirmMode === 'ask'
                    ? '当前策略：每次确认。写、删除、执行前请求 DSH 审批；完全权限档会直接拒绝且不弹窗。'
                    : '当前策略：直接执行。写、删除、执行不再触发插件级审批，仅保留 NAS 令牌权限边界。'
                ),
                h('p', { className: 'ugn-confirm-help-note' },
                  confirmMode === 'ask'
                    ? '提示：完全权限档（approval: never）下，DSH 会直接拒绝写操作且不弹审批窗口；需要弹窗请切换到「工作区内修改」或「只读」档。'
                    : '提示：已关闭插件级确认，写、删除、执行会直接执行；请确保 NAS 访问令牌只勾选了必要的权限。'
                ),
              ),
            ),
          ),
        ),
        h('section', { className: 'ugn-card' },
          h('div', { className: 'ugn-card-head' },
            h('h3', { className: 'ugn-card-title' }, '目录白名单'),
            h('p', { className: 'ugn-card-desc' }, '限制模型可读写的 NAS 目录；留空=不额外限制（仍受 NAS 账号权限约束）。'),
          ),
          h('div', { className: 'ugn-form' },
            h(Field, { id: 'ugn-allowed-roots', label: '允许的绝对路径', hint: '每行一个，例如 /volume1/Photos 或 /volume1/work。配置后文件列表必须指定 path。' },
              h('textarea', {
                id: 'ugn-allowed-roots',
                className: 'ugn-input ugn-textarea',
                rows: 4,
                value: allowedRootsText,
                placeholder: '/volume1/Photos\n/volume1/work',
                onChange: (event) => setAllowedRootsText(event.target.value),
              }),
            ),
          ),
        ),
        h('section', { className: 'ugn-card' },
          h('div', { className: 'ugn-card-head ugn-card-head-row' },
            h('div', null,
              h('h3', { className: 'ugn-card-title' }, '令牌能力'),
              h('p', { className: 'ugn-card-desc' }, caps ? (granted + ' / ' + GROUP_ORDER.length + ' 个大类已授予 · 70 项权限') : '正在探测 NAS 端勾选结果…'),
            ),
            h(Button, { small: true, disabled: capsBusy, onClick: refreshCaps }, capsBusy ? '探测中…' : '重新探测'),
          ),
          h('div', { className: 'ugn-caps' },
            GROUP_ORDER.map((group) => {
              const state = groups[group] ?? 'unknown'
              const meta = GROUP_META[group]
              return h('div', { className: 'ugn-cap', 'data-state': state, key: group },
                h('span', { className: 'ugn-dot' }),
                h('span', { className: 'ugn-cap-name', title: meta.short }, meta.label),
                h('span', { className: 'ugn-cap-state' }, state === 'granted' ? '已授予' : state === 'denied' ? '未授予' : '待探测'),
              )
            }),
          ),
          h('p', { className: 'ugn-note' }, '未授予的大类不会注册对应工具；改权限需在 NAS 控制面板重建访问令牌。'),
        ),
        h('div', { className: 'ugn-footer' },
          h(Button, { variant: 'primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存配置'),
          h(Button, { disabled: testing || busy, onClick: test }, testing ? '测试中…' : '测试连接'),
          h(Button, { disabled: unbinding || busy || !status.configured, onClick: unbind }, unbinding ? '解绑中…' : '解除绑定'),
          message ? h('span', { className: 'ugn-message', 'data-kind': message.kind }, message.text) : null,
        ),
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
