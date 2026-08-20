// 设置面板：全屏 modal 覆盖。监控项 CRUD（表单按 provider 动态显示）、外观、预警、语言。
// 所有外观/预警改动即时预览（hooks.onConfigChange 应用 CSS 变量 + 持久化）。
import { el, deepMerge, rgbaToHexAlpha, hexAlphaToRgba } from './dom.js';
import { t, getLocale, setLocale } from './i18n.js';
import { state, getProviderMeta, computeReorderIds } from './state.js';
import { showToast } from './toast.js';

let overlay = null;
let hooks = {};
let editingId = null; // null=列表视图；'new' 或 monitor id=表单视图
let draft = null;

// 预览 + 持久化一处走：本地合并 state.config，交给 app.js 应用 CSS 变量并 config:patch
function applyPreview(patch) {
  state.config = deepMerge(state.config, patch);
  hooks.onConfigChange(patch);
}

// ---------- 监控项表单 ----------

function emptyDraft() {
  return {
    name: '',
    provider: 'opencode-go',
    kind: 'usage',
    enabled: true,
    refreshMode: 'manual',
    refreshMinutes: 5,
    apiKey: '',
    baseUrl: '',
    siteUrl: '',
    accessKey: '',
    secretKey: '',
    currency: 'RMB',
    targetUrl: '',
    extractJs: '',
    alertOverride: false,
    alert: null,
  };
}

function draftFromMonitor(m) {
  return {
    name: m.name || '',
    provider: m.provider,
    kind: m.kind,
    enabled: m.enabled !== false,
    refreshMode: (m.refresh && m.refresh.mode) || 'manual',
    refreshMinutes: (m.refresh && m.refresh.minutes) || 5,
    apiKey: (m.auth && m.auth.apiKey) || '',
    baseUrl: (m.auth && m.auth.baseUrl) || '',
    siteUrl: (m.auth && m.auth.siteUrl) || '',
    accessKey: (m.auth && m.auth.accessKey) || '',
    secretKey: (m.auth && m.auth.secretKey) || '',
    currency: m.currency === 'USD' ? 'USD' : 'RMB',
    targetUrl: (m.auth && m.auth.targetUrl) || '',
    extractJs: (m.auth && m.auth.extractJs) || '',
    alertOverride: !!m.alert,
    alert: m.alert ? JSON.parse(JSON.stringify(m.alert)) : null,
  };
}

function field(labelText, input) {
  // 用 div 而非 label：内部可能含 radio/checkbox 组，嵌套 label 会导致误触发
  return el('div', { class: 'form-field' }, [el('span', { class: 'form-label' }, labelText), input]);
}

function textInput(fieldName, value, placeholder) {
  return el('input', {
    class: 'form-input',
    type: 'text',
    value: value || '',
    placeholder: placeholder || '',
    dataset: { field: fieldName },
    oninput: (e) => {
      draft[fieldName] = e.target.value;
    },
  });
}

function showBaseUrlField(meta) {
  return meta.needsApiKey || meta.needsBaseUrl || meta.needsAkSk;
}

function buildWebsyncBlock(meta) {
  const status = el('span', { class: 'websync-status' }, '…');
  window.api.websyncHasAuth(draft.provider).then((ok) => {
    status.textContent = ok ? t('monitor.websyncLoggedIn') : t('monitor.websyncNotLoggedIn');
    status.classList.toggle('logged-in', !!ok);
  });

  const loginBtn = el(
    'button',
    {
      class: 'form-btn',
      onclick: async () => {
        loginBtn.disabled = true;
        loginBtn.textContent = t('monitor.websyncLoggingIn');
        try {
          const result = await window.api.websyncLogin(draft.provider);
          if (result && result.success) {
            showToast(t('toast.loginSuccess'));
            status.textContent = t('monitor.websyncLoggedIn');
            status.classList.add('logged-in');
            hooks.onMonitorsChanged();
          } else {
            showToast(`${t('toast.loginFailed')}: ${(result && result.error) || ''}`, 'error');
          }
        } finally {
          loginBtn.disabled = false;
          loginBtn.textContent = t('monitor.websyncLogin');
        }
      },
    },
    t('monitor.websyncLogin')
  );

  const advanced = el('details', { class: 'form-advanced' }, [
    el('summary', {}, t('monitor.advanced')),
    field(t('monitor.targetUrl'), textInput('targetUrl', draft.targetUrl, 'https://…')),
    field(t('monitor.extractJs'), el('textarea', {
      class: 'form-input form-textarea',
      dataset: { field: 'extractJs' },
      placeholder: '(usage) {fiveHours,week,month} / (balance) {balance}',
      oninput: (e) => {
        draft.extractJs = e.target.value;
      },
    }, draft.extractJs || '')),
  ]);

  return el('div', { class: 'form-websync' }, [el('div', { class: 'websync-row' }, [loginBtn, status]), advanced]);
}

function buildMonitorForm() {
  const meta = getProviderMeta(draft.provider) || { supportedKinds: ['usage'] };
  if (!meta.supportedKinds.includes(draft.kind)) draft.kind = meta.supportedKinds[0];

  const form = el('div', { class: 'monitor-form' });

  form.appendChild(field(t('monitor.name'), textInput('name', draft.name, t('monitor.namePlaceholder'))));

  form.appendChild(
    field(
      t('monitor.provider'),
      el(
        'select',
        {
          class: 'form-input',
          onchange: (e) => {
            draft.provider = e.target.value;
            renderSettings(); // 按新 provider 重排表单（draft 已随 oninput 持久）
          },
        },
        state.providers.map((p) =>
          el('option', { value: p.id, selected: p.id === draft.provider }, t(`provider.${p.id}`))
        )
      )
    )
  );

  form.appendChild(
    field(
      t('monitor.kind'),
      el(
        'select',
        {
          class: 'form-input',
          disabled: meta.supportedKinds.length <= 1,
          onchange: (e) => {
            draft.kind = e.target.value;
            renderSettings();
          },
        },
        meta.supportedKinds.map((k) =>
          el('option', { value: k, selected: k === draft.kind }, k === 'balance' ? t('monitor.kindBalance') : t('monitor.kindUsage'))
        )
      )
    )
  );

  if (meta.needsApiKey) {
    form.appendChild(field(t('monitor.apiKey'), textInput('apiKey', draft.apiKey, 'sk-…')));
  }
  if (meta.needsAkSk) {
    form.appendChild(field(t('monitor.accessKey'), textInput('accessKey', draft.accessKey)));
    form.appendChild(field(t('monitor.secretKey'), textInput('secretKey', draft.secretKey)));
  }
  if (showBaseUrlField(meta)) {
    const label = meta.needsBaseUrl ? t('monitor.baseUrl') : t('monitor.baseUrlOptional');
    form.appendChild(field(label, textInput('baseUrl', draft.baseUrl, meta.defaultBaseUrl || 'https://…')));
  }
  form.appendChild(
    field(
      t('monitor.siteUrl'),
      textInput('siteUrl', draft.siteUrl, meta.siteUrl || 'https://…')
    )
  );
  if (meta.isWebSync) {
    form.appendChild(buildWebsyncBlock(meta));
  }
  if (draft.kind === 'balance') {
    form.appendChild(
      field(
        t('monitor.currency'),
        el(
          'select',
          { class: 'form-input', onchange: (e) => (draft.currency = e.target.value) },
          ['RMB', 'USD'].map((c) => el('option', { value: c, selected: c === draft.currency }, c))
        )
      )
    );
  }

  const refreshRow = el('div', { class: 'radio-row' }, [
    radioOption('refresh-mode', 'manual', draft.refreshMode === 'manual', t('monitor.manual'), () => (draft.refreshMode = 'manual')),
    ...[1, 5, 10, 30].map((n) =>
      radioOption('refresh-mode', String(n), draft.refreshMode === 'interval' && draft.refreshMinutes === n, t('monitor.intervalMinutes', { n }), () => {
        draft.refreshMode = 'interval';
        draft.refreshMinutes = n;
      })
    ),
  ]);
  form.appendChild(field(t('monitor.refreshRule'), refreshRow));

  form.appendChild(buildMonitorAlertBlock());

  form.appendChild(
    el('label', { class: 'form-field form-check' }, [
      el('input', { type: 'checkbox', checked: draft.enabled, onchange: (e) => (draft.enabled = e.target.checked) }),
      el('span', {}, t('monitor.enabled')),
    ])
  );

  form.appendChild(
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'form-btn', onclick: () => { editingId = null; draft = null; renderSettings(); } }, t('monitor.cancel')),
      el('button', { class: 'form-btn form-btn-primary', onclick: saveMonitor }, t('monitor.save')),
    ])
  );
  return form;
}

function radioOption(name, value, checked, labelText, onCheck) {
  return el('label', { class: 'radio-option' }, [
    el('input', { type: 'radio', name, value, checked, onchange: onCheck }),
    el('span', {}, labelText),
  ]);
}

async function saveMonitor() {
  const meta = getProviderMeta(draft.provider) || {};
  if (!draft.name.trim()) return showToast(t('toast.invalidForm'), 'error');
  if (meta.needsApiKey && !draft.apiKey.trim()) return showToast(t('toast.invalidForm'), 'error');
  if (meta.needsAkSk && (!draft.accessKey.trim() || !draft.secretKey.trim())) return showToast(t('toast.invalidForm'), 'error');
  if (meta.needsBaseUrl && !draft.baseUrl.trim()) return showToast(t('toast.invalidForm'), 'error');

  const auth = {};
  if (meta.needsApiKey) auth.apiKey = draft.apiKey.trim();
  if (meta.needsAkSk) {
    auth.accessKey = draft.accessKey.trim();
    auth.secretKey = draft.secretKey.trim();
  }
  if (showBaseUrlField(meta)) auth.baseUrl = draft.baseUrl.trim();
  auth.siteUrl = draft.siteUrl.trim(); // 空值回落厂商预设 siteUrl（getSiteUrl 处理）
  if (meta.isWebSync) {
    auth.targetUrl = draft.targetUrl.trim();
    auth.extractJs = draft.extractJs;
  }

  const data = {
    name: draft.name.trim(),
    provider: draft.provider,
    kind: draft.kind,
    enabled: draft.enabled,
    refresh: { mode: draft.refreshMode, minutes: draft.refreshMinutes },
    auth,
    currency: draft.currency,
  };

  // 预警覆盖：勾选时按类型写入；编辑态未勾选则显式清除旧覆盖
  if (draft.alertOverride && draft.alert) {
    const a = draft.alert;
    if (draft.kind === 'usage') {
      if (!(a.threshold1 > 0 && a.threshold1 < a.threshold2 && a.threshold2 < 100)) {
        return showToast(t('alert.thresholdError'), 'error');
      }
      data.alert = {
        mode: a.mode,
        threshold1: Number(a.threshold1),
        threshold2: Number(a.threshold2),
        colors: { ...a.colors },
        images: { ...a.images },
      };
    } else {
      if (!(a.balanceThreshold1 > a.balanceThreshold2 && a.balanceThreshold2 >= 0)) {
        return showToast(t('alert.balanceThresholdError'), 'error');
      }
      data.alert = {
        mode: a.mode,
        balanceThreshold1: Number(a.balanceThreshold1),
        balanceThreshold2: Number(a.balanceThreshold2),
        colors: { ...a.colors },
        images: { ...a.images },
      };
    }
  } else if (editingId !== 'new') {
    data.alert = null;
  }

  if (editingId === 'new') await window.api.addMonitor(data);
  else await window.api.updateMonitor(editingId, data);

  showToast(t('toast.saved'));
  editingId = null;
  draft = null;
  await hooks.onMonitorsChanged();
  renderSettings();
}

// ---------- 监控项列表 ----------

function refreshSummary(m) {
  if (m.refresh && m.refresh.mode === 'interval') return t('monitor.refreshInterval', { n: m.refresh.minutes });
  return t('monitor.refreshManual');
}

let dragId = null; // 拖动中的监控项 id
let dropTarget = null; // { id, after } 最近一次 dragover 的目标

function clearDragState(section) {
  if (section) {
    section.querySelectorAll('.monitor-row.dragging, .monitor-row.drag-over-before, .monitor-row.drag-over-after').forEach((r) => {
      r.classList.remove('dragging', 'drag-over-before', 'drag-over-after');
    });
  }
  dragId = null;
  dropTarget = null;
}

function buildMonitorRow(m) {
  const row = el('div', { class: 'monitor-row' + (m.enabled === false ? ' disabled' : ''), dataset: { id: m.id } }, [
    // 三横线手柄：按住上下拖动即可调整监控项顺序，主页按同一顺序展示
    el(
      'button',
      {
        class: 'monitor-drag',
        type: 'button',
        draggable: true,
        title: t('monitor.drag'),
        ondragstart: (e) => {
          dragId = m.id;
          dropTarget = null;
          row.classList.add('dragging');
          // 拖拽影子用整行，而不是只有手柄本身
          const rect = row.getBoundingClientRect();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', m.id);
          e.dataTransfer.setDragImage(row, Math.max(0, Math.round(e.clientX - rect.left)), Math.max(0, Math.round(e.clientY - rect.top)));
        },
        ondragend: () => clearDragState(row.parentNode),
      },
      [
        el('span', { class: 'monitor-drag-bar' }),
        el('span', { class: 'monitor-drag-bar' }),
        el('span', { class: 'monitor-drag-bar' }),
      ]
    ),
    el('div', { class: 'monitor-info' }, [
      el('span', { class: 'monitor-name' }, m.name || m.provider),
      el('span', { class: 'monitor-sub' }, `${t(`provider.${m.provider}`)} · ${m.kind === 'balance' ? t('monitor.kindBalance') : t('monitor.kindUsage')} · ${refreshSummary(m)}`),
    ]),
    // 打勾 = 启用该监控项（主页显示/隐藏、是否定时刷新都受 enabled 控制）
    el('label', { class: 'monitor-check', title: t('monitor.enabled') }, [
      el('input', {
        type: 'checkbox',
        checked: m.enabled !== false,
        onchange: async (e) => {
          await window.api.updateMonitor(m.id, { enabled: e.target.checked });
          showToast(e.target.checked ? t('toast.enabled') : t('toast.disabled'));
          await hooks.onMonitorsChanged();
          renderSettings();
        },
      }),
    ]),
    el('button', { class: 'form-btn', onclick: () => { editingId = m.id; draft = draftFromMonitor(m); renderSettings(); } }, t('monitor.edit')),
    el('button', {
      class: 'form-btn form-btn-danger',
      onclick: async () => {
        if (!confirm(t('monitor.confirmDelete', { name: m.name || m.provider }))) return;
        await window.api.removeMonitor(m.id);
        showToast(t('toast.deleted'));
        await hooks.onMonitorsChanged();
        renderSettings();
      },
    }, t('monitor.delete')),
  ]);

  // 拖动经过其他行时只标记插入位置（上/下半行），不移动 DOM；
  // 松手后再按目标位置计算新顺序并持久化，避免拖放被中途打断
  row.addEventListener('dragover', (e) => {
    if (!dragId || dragId === m.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    dropTarget = { id: m.id, after };
    row.classList.remove('drag-over-before', 'drag-over-after');
    row.classList.add(after ? 'drag-over-after' : 'drag-over-before');
  });

  row.addEventListener('dragleave', (e) => {
    if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over-before', 'drag-over-after');
  });

  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    const section = row.parentNode;
    const target = dropTarget || { id: m.id, after: false };
    const ids = computeReorderIds(dragId, target.id, target.after);
    clearDragState(section);
    if (!ids) return;
    try {
      await window.api.reorderMonitors(ids);
      await hooks.onMonitorsChanged();
    } finally {
      renderSettings();
    }
  });

  return row;
}

function buildMonitorsSection() {
  const section = el('section', { class: 'settings-section' }, [el('h4', {}, t('settings.monitors'))]);
  if (editingId !== null) {
    section.appendChild(buildMonitorForm());
    return section;
  }
  for (const m of state.monitors) section.appendChild(buildMonitorRow(m));
  section.appendChild(
    el('button', { class: 'form-btn form-btn-primary monitor-add', onclick: () => { editingId = 'new'; draft = emptyDraft(); renderSettings(); } }, `+ ${t('monitor.add')}`)
  );
  return section;
}

// ---------- 外观 ----------

// 皮肤预设：切换皮肤 = 写入 theme + 套用该外观色板（appearance/opacity）。
// dark=项目默认深炭黑；light=明亮浅色（原自定义外观）；glass=液态玻璃（半透明+高光）。
// 导出供测试断言键完整性，并供渲染层按需引用。
export const THEME_PRESETS = {
  dark: {
    opacity: 0.92,
    appearance: {
      borderWidth: 8,
      bgColor: 'rgba(24, 24, 27, 0.88)',
      cardBgColor: 'rgba(39, 39, 42, 0.86)',
      ringTrackColor: 'rgba(255, 255, 255, 0.10)',
      ringUsedColor: 'rgba(250, 250, 250, 0.95)',
      fontColor: '#FAFAFA',
      fontSize: 11,
    },
  },
  light: {
    opacity: 1,
    appearance: {
      borderWidth: 0,
      bgColor: 'rgba(242, 246, 250, 1)',
      cardBgColor: 'rgba(203, 214, 235, 0.7)',
      ringTrackColor: 'rgba(242, 240, 255, 0.1)',
      ringUsedColor: 'rgba(218, 226, 236, 0.95)',
      fontColor: 'rgba(13, 12, 13, 1)',
      fontSize: 11,
    },
  },
  glass: {
    opacity: 1,
    appearance: {
      borderWidth: 0, // 液态玻璃用渐变描边（CSS 内阴影），不再画实体边框
      bgColor: 'rgba(14, 18, 36, 0.40)',
      cardBgColor: 'rgba(255, 255, 255, 0.10)',
      ringTrackColor: 'rgba(255, 255, 255, 0.14)',
      ringUsedColor: 'rgba(255, 255, 255, 0.95)',
      fontColor: '#FFFFFF',
      fontSize: 11,
    },
  },
};

function applyTheme(id) {
  const preset = THEME_PRESETS[id];
  if (!preset) return;
  applyPreview({ theme: id, appearance: { ...preset.appearance }, opacity: preset.opacity });
  renderSettings(); // 刷新下方颜色控件显示为当前皮肤色板
}

function sliderRow(labelText, min, max, value, onInput) {
  const valueEl = el('span', { class: 'slider-value' }, String(value));
  return el('div', { class: 'form-field' }, [
    el('span', { class: 'form-label' }, labelText),
    el('div', { class: 'slider-row' }, [
      el('input', {
        type: 'range', min, max, value, class: 'form-range',
        oninput: (e) => {
          valueEl.textContent = e.target.value;
          onInput(Number(e.target.value));
        },
      }),
      valueEl,
    ]),
  ]);
}

function colorRow(labelText, rgbaValue, onChange) {
  const { hex, alpha } = rgbaToHexAlpha(rgbaValue);
  const commit = (h, a) => onChange(hexAlphaToRgba(h, a));
  let curHex = hex;
  let curAlpha = alpha;
  const valueEl = el('span', { class: 'slider-value' }, `${alpha}%`);
  return el('div', { class: 'form-field' }, [
    el('span', { class: 'form-label' }, labelText),
    el('div', { class: 'color-row' }, [
      el('input', { type: 'color', value: hex, oninput: (e) => { curHex = e.target.value; commit(curHex, curAlpha); } }),
      el('input', {
        type: 'range', min: 0, max: 100, value: alpha, class: 'form-range alpha-range',
        oninput: (e) => { curAlpha = Number(e.target.value); valueEl.textContent = `${curAlpha}%`; commit(curHex, curAlpha); },
      }),
      valueEl,
    ]),
  ]);
}

function buildAppearanceSection() {
  const a = state.config.appearance;
  const currentTheme = state.config.theme || 'dark';
  return el('section', { class: 'settings-section' }, [
    el('h4', {}, t('settings.appearance')),
    el('div', { class: 'form-field' }, [
      el('span', { class: 'form-label' }, t('settings.theme')),
      el('div', { class: 'radio-row' }, [
        ...['dark', 'light', 'glass'].map((id) =>
          radioOption('theme', id, currentTheme === id, t(`theme.${id}`), () => applyTheme(id))
        ),
      ]),
    ]),
    sliderRow(t('appearance.borderWidth'), 0, 16, a.borderWidth, (v) => applyPreview({ appearance: { borderWidth: v } })),
    sliderRow(t('appearance.opacity'), 30, 100, Math.round(state.config.opacity * 100), (v) => applyPreview({ opacity: v / 100 })),
    colorRow(t('appearance.bgColor'), a.bgColor, (c) => applyPreview({ appearance: { bgColor: c } })),
    colorRow(t('appearance.cardBgColor'), a.cardBgColor, (c) => applyPreview({ appearance: { cardBgColor: c } })),
    colorRow(t('appearance.ringTrackColor'), a.ringTrackColor, (c) => applyPreview({ appearance: { ringTrackColor: c } })),
    colorRow(t('appearance.ringUsedColor'), a.ringUsedColor, (c) => applyPreview({ appearance: { ringUsedColor: c } })),
    colorRow(t('appearance.fontColor'), a.fontColor, (c) => applyPreview({ appearance: { fontColor: c } })),
    sliderRow(t('appearance.fontSize'), 9, 16, a.fontSize, (v) => applyPreview({ appearance: { fontSize: v } })),
  ]);
}

// ---------- 预警 ----------
// 控件组被两处复用：全局「预警」区（写 config.alert）和监控项表单的单独覆盖（写 monitor.alert）。
// getCfg() 取当前配置，onPatch(partial) 应用局部修改（colors/images 由调用方负责深合并）。

function thresholdInput(key, getCfg, onPatch) {
  return el('input', {
    class: 'form-input threshold-input',
    type: 'number', min: 1, max: 99, value: getCfg()[key],
    onchange: (e) => {
      const cur = getCfg();
      const next = { ...cur, [key]: Number(e.target.value) };
      if (!(next.threshold1 > 0 && next.threshold1 < next.threshold2 && next.threshold2 < 100)) {
        showToast(t('alert.thresholdError'), 'error');
        e.target.value = cur[key];
        return;
      }
      onPatch({ [key]: next[key] });
    },
  });
}

// 余额阈值：约束 balanceThreshold1 > balanceThreshold2 ≥ 0（余额越高越安全）
function balanceThresholdInput(key, getCfg, onPatch) {
  return el('input', {
    class: 'form-input threshold-input',
    type: 'number', min: 0, step: 'any', value: getCfg()[key],
    onchange: (e) => {
      const cur = getCfg();
      const next = { ...cur, [key]: Number(e.target.value) };
      if (!(next.balanceThreshold1 > next.balanceThreshold2 && next.balanceThreshold2 >= 0)) {
        showToast(t('alert.balanceThresholdError'), 'error');
        e.target.value = cur[key];
        return;
      }
      onPatch({ [key]: next[key] });
    },
  });
}

// kind: 'all'（全局区，全部控件）| 'usage'（模式+用量阈值+图/色）| 'balance'（余额阈值+颜色）
function alertControls(getCfg, onPatch, rerender, namePrefix = 'alert', kind = 'all') {
  const alertCfg = getCfg();
  const nodes = [];

  if (kind !== 'balance') {
    nodes.push(
      el('div', { class: 'threshold-row' }, [
        field(t('alert.threshold1'), thresholdInput('threshold1', getCfg, onPatch)),
        field(t('alert.threshold2'), thresholdInput('threshold2', getCfg, onPatch)),
      ])
    );
  }

  if (kind !== 'usage') {
    nodes.push(
      el('div', { class: 'threshold-row' }, [
        field(t('alert.balanceThreshold1'), balanceThresholdInput('balanceThreshold1', getCfg, onPatch)),
        field(t('alert.balanceThreshold2'), balanceThresholdInput('balanceThreshold2', getCfg, onPatch)),
      ])
    );
  }

  nodes.push(
    field(
      t('alert.mode'),
      el('div', { class: 'radio-row' }, [
        radioOption(`${namePrefix}-mode`, 'dot', alertCfg.mode === 'dot', t('alert.modeDot'), () => { onPatch({ mode: 'dot' }); rerender(); }),
        radioOption(`${namePrefix}-mode`, 'image', alertCfg.mode === 'image', t('alert.modeImage'), () => { onPatch({ mode: 'image' }); rerender(); }),
      ])
    )
  );

  const levels = [
    ['safe', t('alert.levelSafe')],
    ['warning', t('alert.levelWarning')],
    ['danger', t('alert.levelDanger')],
  ];

  if (alertCfg.mode === 'image') {
    for (const [level, label] of levels) {
      const pathInput = el('span', { class: 'image-path', title: alertCfg.images[level] || '' }, alertCfg.images[level] ? alertCfg.images[level].split(/[\\/]/).pop() : t('alert.noImage'));
      nodes.push(
        el('div', { class: 'form-field' }, [
          el('span', { class: 'form-label' }, label),
          el('div', { class: 'image-row' }, [
            el('button', {
              class: 'form-btn',
              onclick: async () => {
                const file = await window.api.pickImage();
                if (file) onPatch({ images: { [level]: file } });
                rerender();
              },
            }, t('alert.pickImage')),
            pathInput,
            el('button', { class: 'form-btn', onclick: () => { onPatch({ images: { [level]: '' } }); rerender(); } }, t('alert.clearImage')),
          ]),
        ])
      );
    }
  } else {
    for (const [level, label] of levels) {
      nodes.push(
        el('div', { class: 'form-field' }, [
          el('span', { class: 'form-label' }, label),
          el('input', { type: 'color', value: alertCfg.colors[level], oninput: (e) => onPatch({ colors: { [level]: e.target.value } }) }),
        ])
      );
    }
  }
  return nodes;
}

function buildAlertSection() {
  const section = el('section', { class: 'settings-section' }, [el('h4', {}, t('settings.alert'))]);
  for (const node of alertControls(
    () => state.config.alert,
    (patch) => applyPreview({ alert: patch }),
    renderSettings
  )) {
    section.appendChild(node);
  }
  return section;
}

// 监控项表单里的预警覆盖块：usage 型覆盖模式/用量阈值/图或色，balance 型覆盖余额阈值/颜色
function buildMonitorAlertBlock() {
  const wrap = el('div', { class: 'monitor-alert' });
  wrap.appendChild(
    el('div', { class: 'form-field form-check' }, [
      el('input', {
        type: 'checkbox',
        checked: draft.alertOverride,
        onchange: (e) => {
          draft.alertOverride = e.target.checked;
          if (draft.alertOverride && !draft.alert) draft.alert = JSON.parse(JSON.stringify(state.config.alert));
          renderSettings();
        },
      }),
      el('span', {}, t('monitor.alertOverride')),
    ])
  );
  if (draft.alertOverride && draft.alert) {
    const onPatch = (patch) => {
      draft.alert = {
        ...draft.alert,
        ...patch,
        colors: { ...(draft.alert.colors || {}), ...((patch && patch.colors) || {}) },
        images: { ...(draft.alert.images || {}), ...((patch && patch.images) || {}) },
      };
    };
    for (const node of alertControls(() => draft.alert, onPatch, renderSettings, 'monitor-alert', draft.kind)) wrap.appendChild(node);
  }
  return wrap;
}

// ---------- 语言 ----------

function buildLanguageSection() {
  const current = getLocale();
  return el('section', { class: 'settings-section' }, [
    el('h4', {}, t('settings.language')),
    el('div', { class: 'radio-row' }, [
      ...['zh', 'en'].map((l) =>
        el('button', {
          class: `form-btn lang-btn${current === l ? ' active' : ''}`,
          onclick: () => {
            if (l === getLocale()) return;
            setLocale(l); // 触发 app.js 的全量重渲染
            applyPreview({ locale: l });
          },
        }, t(`lang.${l}`))
      ),
    ]),
  ]);
}

// ---------- 开机自启 ----------

function buildAutoStartSection() {
  const toggle = el('input', {
    type: 'checkbox',
    onchange: async (e) => {
      const ok = await window.api.setAutoStart(e.target.checked);
      if (!ok) e.target.checked = false;
      showToast(ok ? t('toast.saved') : t('toast.loginFailed'), ok ? 'info' : 'error');
    },
  });
  // 异步读取当前状态
  window.api.getAutoStart().then((v) => { toggle.checked = !!v; });

  return el('section', { class: 'settings-section' }, [
    el('h4', {}, t('settings.autoStart')),
    el('label', { class: 'form-field form-check' }, [
      toggle,
      el('span', {}, t('settings.autoStart')),
    ]),
  ]);
}

// ---------- 面板骨架 ----------

export function openSettings(h) {
  hooks = h || {};
  editingId = null;
  draft = null;
  if (!overlay) {
    overlay = el('div', { class: 'settings-overlay' });
    document.getElementById('app').appendChild(overlay);
  }
  overlay.style.display = '';
  renderSettings();
}

function closeSettings() {
  if (overlay) overlay.style.display = 'none';
  editingId = null;
  draft = null;
}

export function isSettingsOpen() {
  return !!overlay && overlay.style.display !== 'none';
}

export function renderSettings() {
  if (!overlay) return;
  overlay.innerHTML = '';
  overlay.appendChild(
    el('div', { class: 'settings-panel no-drag' }, [
      el('div', { class: 'settings-header' }, [
        el('span', { class: 'settings-title' }, t('settings.title')),
        el('button', { class: 'title-btn title-btn-close', title: t('settings.close'), onclick: closeSettings }, '✕'),
      ]),
      el('div', { class: 'settings-body' }, [
        buildMonitorsSection(),
        buildAppearanceSection(),
        buildAlertSection(),
        buildAutoStartSection(),
        buildLanguageSection(),
      ]),
    ])
  );
}
