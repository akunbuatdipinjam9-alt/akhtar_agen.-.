'use strict';
                                                                                         

const el = (id) => document.getElementById(id);
const messagesEl = el('messages');
const emptyState = el('emptyState');
const convList = el('convList');
const todoList = el('todoList');
const activityLog = el('activityLog');
const timelineEl = el('timeline');
const input = el('input');
const sendBtn = el('sendBtn');
const stopBtn = el('stopBtn');
const takeoverBtn = el('takeoverBtn');
const continueBtn = el('continueBtn');
const topbarStatus = el('topbarStatus');

const state = {
  settings: null,
  workspace: null,
  conversationId: null,
  mode: 'assist',
  running: false,
  takenOver: false,
  streamBubble: null,
  streamText: '',
  toolCards: new Map(),
  permQueue: [],
  permBusy: false,
  visionUsed: 0,
  visionMax: 3,
  currentTaskId: null,
  ghost: null,
  workspaces: [],
  resumableTasks: [],
};

                                                                                   
function escapeHtml(s) {
                                                                          
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function mdToHtml(text) {
  const parts = String(text || '').split(/```([\s\S]*?)```/g);
  return parts.map((chunk, i) => {
    if (i % 2 === 1) {
      const nl = chunk.indexOf('\n');
      const code = nl === -1 ? chunk : chunk.slice(nl + 1);
      return `<pre><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
    }
    let h = escapeHtml(chunk);
    h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return h;
  }).join('');
}

                                          
function clearEmptyState() { emptyState.classList.add('hidden'); }

function addUserBubble(text) {
  clearEmptyState();
  const div = document.createElement('div');
  div.className = 'msg user';
  div.innerHTML = `<div class="bubble">${mdToHtml(text)}</div>`;
  messagesEl.appendChild(div);
  scrollDown();
}

function startAssistantBubble() {
  clearEmptyState();
  const div = document.createElement('div');
  div.className = 'msg assistant';
  div.innerHTML = `<div class="bubble"></div>`;
  messagesEl.appendChild(div);
  state.streamBubble = div.querySelector('.bubble');
  state.streamText = '';
  scrollDown();
  return div;
}

function appendStreamDelta(delta) {
  if (!state.streamBubble) startAssistantBubble();
  state.streamText += delta;
                                                                                      
                                                      
  if (state.streamFrame) return;
  state.streamFrame = requestAnimationFrame(() => {
    state.streamFrame = null;
    if (state.streamBubble) { state.streamBubble.innerHTML = mdToHtml(state.streamText); scrollDown(); }
  });
}

function finalizeStreamBubble() {
  if (state.streamFrame) { cancelAnimationFrame(state.streamFrame); state.streamFrame = null; }
  if (state.streamBubble) state.streamBubble.innerHTML = mdToHtml(state.streamText);
  state.streamBubble = null;
  state.streamText = '';
}

const TOOL_SECRET_KEY_RE = /(authorization|api[_-]?key|secret|password|passwd|token|cookie|session|credential|private[_-]?key|service[_-]?role|client[_-]?secret|refresh[_-]?token|access[_-]?token|jwt)/i;
const TOOL_SECRET_VALUE_RE = /^(?:Bearer\s+|sk-[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,})/;
const TOOL_MAX_STRING = 2400;
const TOOL_MAX_ARRAY = 40;

function sanitizeToolTelemetry(value, key = '', seen = new WeakSet(), depth = 0) {
  if (TOOL_SECRET_KEY_RE.test(String(key || ''))) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (TOOL_SECRET_VALUE_RE.test(value)) return '[REDACTED]';
    if (/^data:[^;]+;base64,/i.test(value)) return `[BINARY_DATA ${value.length} chars]`;
    return value.length > TOOL_MAX_STRING ? `${value.slice(0, TOOL_MAX_STRING)}… [truncated ${value.length - TOOL_MAX_STRING} chars]` : value;
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[CIRCULAR]';
  if (depth >= 8) return '[MAX_DEPTH]';
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.slice(0, TOOL_MAX_ARRAY).map((v) => sanitizeToolTelemetry(v, '', seen, depth + 1));
    if (value.length > TOOL_MAX_ARRAY) out.push(`[+${value.length - TOOL_MAX_ARRAY} more items]`);
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeToolTelemetry(v, k, seen, depth + 1);
  return out;
}

function toolCategory(name = '') {
  const prefix = String(name).split('.')[0];
  const map = {
    browser: ['🌐', 'Browser'], computer: ['🖱️', 'Computer'], filesystem: ['📁', 'Files'],
    file: ['📁', 'Files'], terminal: ['⌨️', 'Terminal'], git: ['⑂', 'Git'], github: ['⑂', 'GitHub'],
    preview: ['👁️', 'Preview'], ai: ['🧠', 'AI'], travel: ['🧭', 'Travel'], lab: ['🧪', 'Akhtar Lab'],
    weather: ['☁️', 'Weather'], image: ['🖼️', 'Image'], documents: ['📄', 'Documents'],
    presentations: ['📊', 'Presentations'], network: ['📡', 'Network'], system: ['⚙️', 'System'],
    memory: ['🧠', 'Memory'], schedule: ['🕒', 'Schedule'], todo: ['☑️', 'Todo'],
  };
  return map[prefix] || ['🔧', prefix ? prefix[0].toUpperCase() + prefix.slice(1) : 'Tool'];
}

function compactTarget(args = {}) {
  const raw = args.url || args.path || args.file || args.filename || args.query || args.location || args.command || args.text || '';
  if (!raw) return '';
  const s = String(raw);
  if (/^https?:\/\//i.test(s)) {
    try { return new URL(s).hostname; } catch {}
  }
  if (s.length > 88) return `${s.slice(0, 85)}…`;
  return s;
}

function describeToolCall(call = {}) {
  const name = String(call.name || 'tool');
  const args = call.arguments || {};
  const target = compactTarget(args);
  const exact = {
    'browser.navigate': 'Membuka halaman web',
    'browser.click': 'Menekan elemen di halaman',
    'browser.type': 'Mengetik di halaman',
    'browser.vision_rescue': 'Membaca layar dengan vision',
    'terminal.run': 'Menjalankan perintah terminal',
    'preview.open': 'Membuka Universal Preview',
    'preview.inspect': 'Memeriksa isi preview',
    'ai.parallel_workers': 'Menjalankan Parallel Worker Lite',
    'travel.guide': 'Menyusun panduan perjalanan',
    'lab.simulate': 'Menjalankan simulasi Akhtar Lab',
    'lab.modify': 'Mengubah simulasi Akhtar Lab',
  };
  const base = exact[name] || `Menjalankan ${name}`;
  return target && name !== 'terminal.run' ? `${base} · ${target}` : base;
}

function buildToolDeveloperJson(record) {
  const payload = {
    execution_id: record.call?.id || null,
    pov: 'developer',
    agent: 'main',
    tool: record.call?.name || null,
    status: record.status,
    started_at: record.startedAt ? new Date(record.startedAt).toISOString() : null,
    finished_at: record.finishedAt ? new Date(record.finishedAt).toISOString() : null,
    duration_ms: record.finishedAt && record.startedAt ? Math.max(0, record.finishedAt - record.startedAt) : null,
    input: sanitizeToolTelemetry(record.call?.arguments || {}),
  };
  if (record.status === 'success') payload.output = sanitizeToolTelemetry(record.result);
  if (record.status === 'error') payload.error = sanitizeToolTelemetry(record.error || 'Unknown error');
  if (record.verification) payload.verification = sanitizeToolTelemetry(record.verification);
  return payload;
}

function renderToolCardRecord(record) {
  const div = record.el;
  if (!div) return;
  const [icon, category] = toolCategory(record.call?.name);
  const statusLabel = record.status === 'running' ? 'berjalan' : record.status === 'success' ? 'selesai' : 'gagal';
  const duration = record.finishedAt && record.startedAt ? `${((record.finishedAt - record.startedAt) / 1000).toFixed(2)}s` : '';
  const verification = record.verification;
  const verificationText = verification ? (verification.confirmed ? 'Terverifikasi' : 'Sudah dicek, belum terkonfirmasi') : '';
  div.innerHTML = `
    <div class="tool-card-head">
      <span class="tool-status ${record.status}">${escapeHtml(statusLabel)}</span>
      <span class="tool-name">${escapeHtml(record.call?.name || 'tool')}</span>
      <span class="tool-duration">${escapeHtml(duration)}</span>
      <div class="tool-pov-switch" role="tablist" aria-label="Tool point of view">
        <button class="tool-pov-btn ${record.pov === 'user' ? 'active' : ''}" data-pov="user" type="button">User POV</button>
        <button class="tool-pov-btn ${record.pov === 'developer' ? 'active' : ''}" data-pov="developer" type="button">Developer POV</button>
      </div>
    </div>
    <div class="tool-pov-user ${record.pov === 'user' ? '' : 'hidden'}">
      <div class="tool-human-line"><span class="tool-human-icon">${escapeHtml(icon)}</span><strong>${escapeHtml(category)}</strong><span>${escapeHtml(describeToolCall(record.call))}</span></div>
      ${verificationText ? `<div class="tool-verification ${verification?.confirmed ? 'confirmed' : 'unconfirmed'}">👁 ${escapeHtml(verificationText)}</div>` : ''}
      ${record.status === 'error' ? `<div class="tool-human-error">${escapeHtml(record.error || 'Tool gagal dijalankan.')}</div>` : ''}
    </div>
    <pre class="tool-pov-dev ${record.pov === 'developer' ? '' : 'hidden'}"><code>${escapeHtml(JSON.stringify(buildToolDeveloperJson(record), null, 2))}</code></pre>
  `;
  div.querySelectorAll('.tool-pov-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      record.pov = btn.dataset.pov === 'developer' ? 'developer' : 'user';
      renderToolCardRecord(record);
    });
  });
}

function toolCard(call) {
  clearEmptyState();
  if (/^browser\.(new_tab|navigate|click|type|scroll|observe|wait_for|back|forward|reload|vision_rescue|screenshot)$/.test(String(call?.name || ''))) showInlineToolDock('browser');
  const div = document.createElement('div');
  div.className = 'tool-card';
  const record = {
    el: div,
    call,
    pov: 'user',
    status: 'running',
    result: undefined,
    error: null,
    verification: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  messagesEl.appendChild(div);
  state.toolCards.set(call.id, record);
  renderToolCardRecord(record);
  scrollDown();
  return div;
}

function toolCardDone(call, ok, resultOrError) {
  const record = state.toolCards.get(call.id);
  if (!record) return;
  record.status = ok ? 'success' : 'error';
  record.finishedAt = Date.now();
  if (ok) {
    record.result = resultOrError;
    if (resultOrError?._beforeAfter) record.verification = {
      confirmed: resultOrError._beforeAfter.confirmed === true,
      signals: resultOrError._beforeAfter.signals || [],
      reason: resultOrError._beforeAfter.reason || '',
    };
  } else {
    record.error = resultOrError;
  }
  renderToolCardRecord(record);
  scrollDown();
}

function toolCardVerification(callId, toolName, verification) {
  let record = callId ? state.toolCards.get(callId) : null;
  if (!record && toolName) {
    const values = [...state.toolCards.values()].reverse();
    record = values.find((r) => r.call?.name === toolName) || null;
  }
  if (!record) return;
  record.verification = verification;
  renderToolCardRecord(record);
}

function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function logActivity(text) {
  const row = document.createElement('div');
  row.textContent = text;
  activityLog.prepend(row);
  while (activityLog.children.length > 60) activityLog.removeChild(activityLog.lastChild);
}

function renderResumeBanner() {
  const banner = el('resumeBanner');
  const task = state.resumableTasks?.[0];
  if (!banner) return;
  if (!task) { banner.classList.add('hidden'); return; }
  const p = task.progress || {};
  el('resumeTitle').textContent = state.resumableTasks.length > 1 ? `Tugas terputus ditemukan (+${state.resumableTasks.length - 1})` : 'Tugas terputus ditemukan';
  const progress = p.total ? `${p.completed}/${p.total} tool selesai` : 'belum ada tool selesai';
  const uncertain = p.uncertain ? ` · ${p.uncertain} aksi perlu dicek ulang` : '';
  el('resumeDetail').textContent = `${task.title || 'Tugas sebelumnya'} · ${progress}${uncertain}`;
  banner.classList.remove('hidden');
}

async function refreshResumableTasks() {
  const res = await window.akhtar.listResumableTasks({ limit: 8 });
  state.resumableTasks = res.ok ? (res.data || []) : [];
  renderResumeBanner();
}

async function resumeInterruptedTask() {
  const task = state.resumableTasks?.[0];
  if (!task || state.running) return;
  const ws = task.workspace_id ? state.workspaces.find((w) => w.id === task.workspace_id) : null;
  state.workspace = ws || null;
  el('workspaceName').textContent = ws?.name || 'Pilih folder project';
  await loadConversations();
  state.conversationId = task.conversation_id;
  await selectConversation(task.conversation_id);
  state.currentTaskId = task.id;
  setRunning(true);
  logActivity(`↻ Crash Resume: ${task.title || task.id}`);
  const res = await window.akhtar.resumeAgentTask({ taskId: task.id });
  if (!res.ok) { setRunning(false); logActivity(`Resume gagal: ${res.error}`); }
  await refreshResumableTasks();
}

el('resumeTaskBtn')?.addEventListener('click', resumeInterruptedTask);
el('dismissResumeBtn')?.addEventListener('click', async () => {
  const task = state.resumableTasks?.[0]; if (!task) return;
  await window.akhtar.dismissResumableTask({ taskId: task.id });
  await refreshResumableTasks();
});


function renderVisionBudget() {
  const max = Number(state.visionMax || state.settings?.browserVision?.maxCallsPerTask || 3);
  const used = Math.min(max, Number(state.visionUsed || 0));
  const remaining = Math.max(0, max - used);
  if (el('visionRemaining')) el('visionRemaining').textContent = String(remaining);
  const meter = el('visionDots');
  if (meter) {
    meter.innerHTML = '';
    for (let i=0;i<max;i++) { const d=document.createElement('i'); if (i < used) d.classList.add('used'); meter.appendChild(d); }
  }
  if (el('visionModeBadge')) el('visionModeBadge').textContent = used ? 'VISION' : 'DOM';
}


async function refreshTimeline(taskId = state.currentTaskId) {
  if (!timelineEl) return;
  if (!taskId) { timelineEl.innerHTML = '<div class="muted">Jejak muncul saat tugas berjalan.</div>'; return; }
  const res = await window.akhtar.getTaskTimeline({ taskId });
  if (!res.ok) return;
  timelineEl.innerHTML = '';
  const rows = res.data || [];
  if (!rows.length) { timelineEl.innerHTML = '<div class="muted">Belum ada event.</div>'; return; }
  for (const item of rows.slice(-80)) {
    const row = document.createElement('div'); row.className = 'timeline-row';
    const time = item.created_at ? new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '';
    const label = item.kind === 'tool' ? `${item.status === 'success' ? '✓' : item.status === 'error' ? '✗' : '→'} ${item.name}` : (item.message || item.type || 'event');
    row.innerHTML = `<span class="timeline-dot"></span><div class="timeline-copy"><div>${escapeHtml(label)}</div><span>${escapeHtml(time)}</span></div>${item.kind === 'event' ? '<button class="mini-action timeline-fork" title="Fork from this point">Fork</button>' : ''}`;
    const fork = row.querySelector('.timeline-fork'); if (fork) fork.onclick = () => forkCurrentTask(item.id);
    timelineEl.appendChild(row);
  }
  timelineEl.scrollTop = timelineEl.scrollHeight;
}
if (el('refreshTimeline')) el('refreshTimeline').addEventListener('click', () => refreshTimeline());
async function forkCurrentTask(eventId = null) {
  if (!state.currentTaskId) return;
  const r = await window.akhtar.forkTask({ taskId: state.currentTaskId, eventId });
  if (!r.ok) return logActivity(`Fork gagal: ${r.error}`);
  state.conversationId = r.data.id; await loadConversations(); await selectConversation(r.data.id); logActivity('Replay fork created — original run preserved.');
}
el('forkTaskBtn')?.addEventListener('click', () => forkCurrentTask());
el('diagnoseTaskBtn')?.addEventListener('click', async () => {
  if (!state.currentTaskId) return;
  const r = await window.akhtar.diagnoseTask({ taskId: state.currentTaskId }); if (!r.ok) return logActivity(`Diagnose gagal: ${r.error}`);
  const d=r.data, div=document.createElement('div'); div.className='diagnostic-card';
  div.innerHTML=`<h4>Agent Black Box</h4><p><strong>${escapeHtml(d.task.status.toUpperCase())}</strong> · ${d.counts.events} timeline entries · ${d.counts.errors} error(s)</p><div>${escapeHtml(d.summary)}</div><p>${escapeHtml((d.suggestions||[]).join(' · '))}</p>`;
  messagesEl.appendChild(div); scrollDown();
});

                              
function renderTodos(todos) {
  todoList.innerHTML = '';
  if (!todos || !todos.length) { todoList.innerHTML = '<li class="muted">Belum ada tugas yang berjalan.</li>'; return; }
  for (const t of todos) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="todo-status ${t.status}"></span><span>${escapeHtml(t.title)}</span>`;
    todoList.appendChild(li);
  }
}
async function refreshTodos(taskId) {
  if (!taskId) return;
  const res = await window.akhtar.listTodos({ taskId });
  if (res.ok) renderTodos(res.data);
}

                                                
async function refreshArtifacts() {
  const list = el('artifactList');
  const res = await window.akhtar.listArtifacts({ workspaceId: state.workspace?.id || null });
  if (!res.ok) return;
  list.innerHTML = '';
  if (!res.data.length) { list.innerHTML = '<li class="muted">Belum ada artifact.</li>'; return; }
  for (const a of res.data.slice(0, 30)) {
    const li = document.createElement('li');
    const isChart = a.type === 'chart';
    li.innerHTML = `<span class="name" title="${escapeHtml(a.path)}">${escapeHtml(a.name)}</span><button data-open>${isChart ? 'Lihat' : 'Preview'}</button>`;
    li.querySelector('button').onclick = async () => {
      if (isChart) return openChartArtifact(a.id);
      if (state.workspace?.id && window.akhtar.openPreview) {
        const r = await window.akhtar.openPreview({ workspaceId: state.workspace.id, path: a.path });
        if (r.ok) return;
      }
      return window.akhtar.openArtifact({ path: a.path });
    };
    list.appendChild(li);
  }
}
async function refreshCheckpoints() {
  const list = el('checkpointList');
  if (!state.workspace) { list.innerHTML = '<li class="muted">Buka workspace dulu.</li>'; return; }
  const res = await window.akhtar.listCheckpoints({ workspaceId: state.workspace.id });
  if (!res.ok) return;
  list.innerHTML = '';
  if (!res.data.length) { list.innerHTML = '<li class="muted">Belum ada checkpoint.</li>'; return; }
  for (const c of res.data.slice(0, 20)) {
    const li = document.createElement('li');
    const when = new Date(c.created_at).toLocaleString('id-ID');
    const restored = c.restored_at ? ' (sudah di-restore)' : '';
    li.innerHTML = `<span class="name" title="${when}">${when}${restored}</span><button data-restore title="Kembalikan file seperti sebelum tugas ini">Batalkan</button>`;
    li.querySelector('button').onclick = async () => {
      if (!confirm('Kembalikan file ke kondisi sebelum checkpoint ini?')) return;
      const r = await window.akhtar.restoreCheckpoint({ id: c.id });
      if (r.ok) { logActivity('Checkpoint direstore.'); refreshCheckpoints(); }
      else alert('Gagal restore: ' + r.error);
    };
    list.appendChild(li);
  }
}


let activeArtifactChart = null;
async function openChartArtifact(artifactId) {
  const res = await window.akhtar.getChartArtifact({ artifactId });
  if (!res.ok) return logActivity(`Chart gagal dibuka: ${res.error}`);
  const spec = res.data.spec;
  el('chartModalTitle').textContent = spec.title || 'Visualization';
  el('chartModal').classList.remove('hidden');
  if (activeArtifactChart) activeArtifactChart.destroy();
  const ctx = el('artifactChart').getContext('2d');
  activeArtifactChart = new Chart(ctx, {
    type: spec.type,
    data: { labels: spec.labels || [], datasets: spec.datasets || [] },
    options: { responsive: true, maintainAspectRatio: false, ...(spec.options || {}) }
  });
}
el('closeChartModal').onclick = () => { el('chartModal').classList.add('hidden'); if (activeArtifactChart) { activeArtifactChart.destroy(); activeArtifactChart = null; } };
el('chartModal').addEventListener('click', (e) => { if (e.target === el('chartModal')) el('closeChartModal').click(); });

                                               
const browserBody = el('browserBody');
const browserSurface = el('browserSurface');
const browserTabstrip = el('browserTabstrip');
const browserAddress = el('browserAddress');
let browserTabs = [];
let currentInlineTool = null;
const inlineToolDock = el('inlineToolDock');

function activeBrowserTab() { return browserTabs.find((t) => t.active) || null; }

function renderBrowserTabs(tabs) {
  browserTabs = tabs || [];
  browserTabstrip.innerHTML = '';
  el('browserEmpty').classList.toggle('hidden', browserTabs.length > 0);
  for (const t of browserTabs) {
    const chip = document.createElement('div');
    chip.className = 'browser-tab' + (t.active ? ' active' : '');
    chip.innerHTML = `<span class="t-title">${escapeHtml(t.loading ? 'Memuat…' : (t.title || t.url || 'Tab baru'))}</span><span class="t-close">✕</span>`;
    chip.addEventListener('click', () => window.akhtar.switchBrowserTab({ tabId: t.id }));
    chip.querySelector('.t-close').addEventListener('click', (e) => { e.stopPropagation(); window.akhtar.closeBrowserTab({ tabId: t.id }); });
    browserTabstrip.appendChild(chip);
  }
  const active = activeBrowserTab();
  if (active && document.activeElement !== browserAddress) browserAddress.value = active.url === 'about:blank' ? '' : active.url;
}
window.akhtar.onBrowserTabsChanged((tabs) => {
  const previousCount = browserTabs.length;
  renderBrowserTabs(tabs);
                                                                                                         
  if (tabs?.length && (!previousCount || (tabs.length > previousCount))) showInlineToolDock('browser');
  if (!tabs?.length && currentInlineTool === 'browser') closeInlineToolDock();
});

function reportBrowserBounds() {
  if (currentInlineTool !== 'browser' || inlineToolDock.classList.contains('hidden')) return;
  const r = browserSurface.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return;
  window.akhtar.setBrowserBounds({ bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } });
}
new ResizeObserver(reportBrowserBounds).observe(browserSurface);
window.addEventListener('resize', reportBrowserBounds);

function closeInlineToolDock() {
  currentInlineTool = null;
  window.akhtar.setBrowserVisible({ visible: false });
  inlineToolDock.classList.add('hidden');
  browserBody.style.display = 'none';
  if (mapBody) mapBody.style.display = 'none';
  stopLocationWatch();
}
function showInlineToolDock(kind) {
  if (kind !== 'browser' && kind !== 'map') return;
  currentInlineTool = kind;
  inlineToolDock.classList.remove('hidden');
  el('inlineToolDockTitle').textContent = kind === 'browser' ? '🌐 Browser · preview di obrolan' : '🗺️ Peta · preview di obrolan';
  browserBody.style.display = kind === 'browser' ? 'flex' : 'none';
  if (mapBody) mapBody.style.display = kind === 'map' ? 'flex' : 'none';
  window.akhtar.setBrowserVisible({ visible: kind === 'browser' });
  if (kind === 'browser') requestAnimationFrame(reportBrowserBounds);
  else requestAnimationFrame(() => ensureMap()?.invalidateSize());
}
el('inlineToolDockClose').addEventListener('click', closeInlineToolDock);

async function browserGo() {
  const url = browserAddress.value.trim();
  if (!url) return;
  const active = activeBrowserTab();
  if (active) await window.akhtar.navigateBrowserTab({ tabId: active.id, url });
  else await window.akhtar.newBrowserTab({ url });
}
el('browserGo').addEventListener('click', browserGo);
browserAddress.addEventListener('keydown', (e) => { if (e.key === 'Enter') browserGo(); });
el('browserNewTab').addEventListener('click', () => window.akhtar.newBrowserTab({}));
el('browserBack').addEventListener('click', () => { const t = activeBrowserTab(); if (t) window.akhtar.browserBack({ tabId: t.id }); });
el('browserForward').addEventListener('click', () => { const t = activeBrowserTab(); if (t) window.akhtar.browserForward({ tabId: t.id }); });
el('browserReload').addEventListener('click', () => { const t = activeBrowserTab(); if (t) window.akhtar.browserReload({ tabId: t.id }); });


                                  
const downloadRows = new Map();
function renderDownloadRow(d) {
  const list = el('downloadList');
  let row = downloadRows.get(d.id);
  if (!row) {
    if (list.querySelector('.muted')) list.innerHTML = '';
    row = document.createElement('li');
    row.innerHTML = `<span class="name"></span><span class="dl-actions"></span>`;
    list.appendChild(row);
    downloadRows.set(d.id, row);
  }
  const pct = d.totalBytes ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
  row.querySelector('.name').textContent = `${d.filename} — ${d.state}${d.state === 'progressing' ? ` ${pct}%` : ''}`;
  const actions = row.querySelector('.dl-actions');
  actions.innerHTML = '';
  const addBtn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; actions.appendChild(b); };
  if (d.state === 'progressing') { addBtn('Pause', () => window.akhtar.pauseDownload({ id: d.id })); addBtn('Cancel', () => window.akhtar.cancelDownload({ id: d.id })); }
  else if (d.state === 'paused') addBtn('Resume', () => window.akhtar.resumeDownload({ id: d.id }));
}
window.akhtar.onDownloadEvent(renderDownloadRow);

                                  
async function refreshSchedules() {
  const list = el('scheduleList');
  const res = await window.akhtar.listSchedules({ workspaceId: state.workspace?.id || null });
  if (!res.ok) return;
  list.innerHTML = '';
  if (!res.data.length) { list.innerHTML = '<li class="muted">Belum ada jadwal.</li>'; return; }
  for (const s of res.data) {
    const li = document.createElement('li');
    const when = s.recurrence === 'once' ? new Date(s.run_at).toLocaleString('id-ID') : `${s.recurrence} ${s.time || ''} ${s.day_of_week || (s.day_of_month ? 'tgl ' + s.day_of_month : '')}`.trim();
    li.title = s.instruction;
    li.innerHTML = `<span class="name">${escapeHtml(s.title)} — ${escapeHtml(when)}${s.enabled ? '' : ' (pause)'}</span><span class="dl-actions"></span>`;
    const actions = li.querySelector('.dl-actions');
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = s.enabled ? 'Pause' : 'Resume';
    toggleBtn.onclick = async () => { await window.akhtar.setScheduleEnabled({ id: s.id, enabled: !s.enabled }); refreshSchedules(); };
    const delBtn = document.createElement('button');
    delBtn.textContent = 'Hapus';
    delBtn.onclick = async () => { if (confirm(`Hapus jadwal "${s.title}"?`)) { await window.akhtar.removeSchedule({ id: s.id }); refreshSchedules(); } };
    actions.appendChild(toggleBtn); actions.appendChild(delBtn);
    list.appendChild(li);
  }
}
window.akhtar.onScheduleEvent((ev) => {
  if (ev.type === 'task_end') { refreshSchedules(); logActivity(`⏰ ${ev.status === 'completed' ? 'Jadwal selesai' : 'Jadwal ' + ev.status}`); }
});

                                     
function setRunning(running) {
  state.running = running;
  if (!running) state.takenOver = false;
  sendBtn.classList.toggle('hidden', running);
  stopBtn.classList.toggle('hidden', !running);
  takeoverBtn.classList.toggle('hidden', !running || state.takenOver);
  continueBtn.classList.toggle('hidden', !running || !state.takenOver);
  topbarStatus.textContent = running ? (state.takenOver ? 'Kamu yang memegang kendali' : 'Agen sedang bekerja…') : '';
  document.body.classList.toggle('is-running', running && !state.takenOver);
}
function setTakenOver(value) {
  state.takenOver = value;
  setRunning(state.running);
}

window.akhtar.onAgentEvent((ev) => {
                                                                                               
                                                                                               
                                                                
  if (ev.type === 'task_start') state.runningConversationId = ev.conversationId;
  if ((ev.type === 'task_end' || ev.type === 'fatal_error') && ev.conversationId === state.runningConversationId) {
    state.runningConversationId = null;
    if (ev.conversationId !== state.conversationId) { setRunning(false); logActivity(ev.type === 'task_end' && ev.status === 'completed' ? 'Tugas di percakapan lain selesai.' : 'Tugas di percakapan lain berhenti.'); }
  }
  if (ev.conversationId !== state.conversationId) return;
  switch (ev.type) {
    case 'task_start':
      state.currentTaskId = ev.task?.id || null;
      state.visionUsed = 0; state.visionMax = state.settings?.browserVision?.maxCallsPerTask || 3; renderVisionBudget();
      setRunning(true);
      renderTodos([]);
      refreshTimeline();
      break;
    case 'text_delta':
      appendStreamDelta(ev.delta);
      break;
    case 'assistant_message':
      finalizeStreamBubble();
      break;
    case 'stream_reset':
                                                                                            
      if (state.streamFrame) { cancelAnimationFrame(state.streamFrame); state.streamFrame = null; }
      state.streamText = '';
      if (state.streamBubble) state.streamBubble.innerHTML = '';
      break;
    case 'model_retry':
      logActivity(`Model sibuk/error — mencoba lagi (${ev.attempt}) dalam ${Math.round(ev.waitMs / 1000)} detik`);
      break;
    case 'knowledge':
      logActivity(`Knowledge: ${ev.count} relevant chunk(s)`);
      refreshTimeline();
      break;
    case 'takeover_requested':
      topbarStatus.textContent = 'Take over requested…';
      logActivity('Take over requested — waiting for a safe point');
      break;
    case 'takeover_started':
      setTakenOver(true);
      logActivity(`Take over — agent paused ${ev.label ? 'at ' + ev.label : ''}`);
      refreshTimeline();
      break;
    case 'takeover_ended':
      setTakenOver(false);
      logActivity('Control returned to agent');
      break;
    case 'context_compressed':
      logActivity(`Context compressed: ~${ev.savedChars} chars saved`);
      refreshTimeline();
      break;
    case 'tool_call_start':
      logActivity(`→ ${ev.call.name}`);
      toolCard(ev.call);
      refreshTimeline();
      break;
    case 'tool_call_end':
      toolCardDone(ev.call, ev.ok, ev.ok ? ev.result : ev.error);
      if (ev.call?.name === 'browser.vision_rescue' && ev.ok && ev.result?.quota) { state.visionUsed = ev.result.quota.used; state.visionMax = ev.result.quota.max; renderVisionBudget(); }
      logActivity(`${ev.ok ? '✓' : '✗'} ${ev.call.name}`);
      refreshTodos(state.currentTaskId);
      refreshTimeline();
      break;
    case 'before_after_verification':
      toolCardVerification(ev.callId, ev.tool, { confirmed: ev.confirmed === true, signals: ev.signals || [], reason: ev.reason || '' });
      logActivity(`👁 ${ev.tool}: ${ev.confirmed ? 'before/after terkonfirmasi' : 'sudah dicek, belum terkonfirmasi'}`);
      refreshTimeline();
      break;
    case 'resume_recovery':
      logActivity(`↻ Resume aman: ${ev.uncertain?.length || 0} aksi statusnya belum pasti; agent akan cek ulang state.`);
      refreshTimeline();
      break;
    case 'task_end':
      finalizeStreamBubble();                                                                                   
      state.currentTaskId = ev.task?.id || null;
      refreshTodos(state.currentTaskId);
      refreshArtifacts();
      refreshCheckpoints();
      refreshTimeline();
      setRunning(false);
      refreshResumableTasks();
      if (ev.status === 'failed' && ev.error) {
        const div = document.createElement('div');
        div.className = 'tool-card';
        div.style.borderColor = 'var(--danger)';
        div.textContent = `Tugas gagal: ${ev.error}`;
        messagesEl.appendChild(div);
        scrollDown();
      }
      break;
    case 'fatal_error':
      finalizeStreamBubble();
      setRunning(false);
      break;
    default:
      break;
  }
});

                                          
const permOverlay = el('permissionOverlay');
window.akhtar.onPermissionRequest((payload) => {
  state.permQueue.push(payload);
  drainPermQueue();
});
window.akhtar.onPermissionCancel?.(({ id }) => {
  state.permQueue = state.permQueue.filter((r) => r.id !== id);
  if (state.permCurrentId === id) {
    permOverlay.classList.add('hidden');
    state.permBusy = false; state.permCurrentId = null;
    drainPermQueue();
  }
});
function drainPermQueue() {
  if (state.permBusy || !state.permQueue.length) return;
  state.permBusy = true;
  const req = state.permQueue.shift();
  state.permCurrentId = req.id;
  el('permTitle').textContent = req.title || req.name;
  el('permSummary').textContent = [req.command, req.path, req.summary].filter(Boolean).join('\n') || '(tidak ada detail tambahan)';
  const diffEl = el('permDiff');
  if (req.diff) { diffEl.textContent = req.diff; diffEl.classList.remove('hidden'); } else diffEl.classList.add('hidden');
  const warnEl = el('permWarning');
  if (req.warning) { warnEl.textContent = req.warning; warnEl.classList.remove('hidden'); } else warnEl.classList.add('hidden');
  el('permAllowAlways').classList.toggle('hidden', !req.allowAlways);
  el('permAllowProject').classList.toggle('hidden', !req.allowProject || req.allowAlways);
  permOverlay.classList.remove('hidden');
  const respond = (decision) => {
    if (state.permCurrentId !== req.id) return;                                           
    state.permCurrentId = null;
    permOverlay.classList.add('hidden');
    window.akhtar.respondPermission(req.id, decision);
    state.permBusy = false;
    drainPermQueue();
  };
  el('permAllowOnce').onclick = () => respond('allow_once');
  el('permAllowAlways').onclick = () => respond('allow_always');
  el('permAllowProject').onclick = () => respond('allow_project');
  el('permDeny').onclick = () => respond('deny');
}

                                
async function ensureConversation() {
  if (state.conversationId) return state.conversationId;
  const res = await window.akhtar.createConversation({ workspaceId: state.workspace?.id || null, mode: state.mode });
  if (!res.ok) throw new Error(res.error);
  state.conversationId = res.data.id;
  await loadConversations();
  selectConversation(state.conversationId, { skipLoad: true });
  return state.conversationId;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || state.running) return;
  const showError = (msg) => {
    const div = document.createElement('div');
    div.className = 'tool-card';
    div.style.borderColor = 'var(--danger)';
    div.textContent = `Error: ${msg}`;
    messagesEl.appendChild(div);
    scrollDown();
  };
  setRunning(true);                                                                          
  try {
    await ensureConversation();
  } catch (e) {
    setRunning(false);
    showError(e.message);                                                    
    return;
  }
  input.value = '';
  autoResize();
  addUserBubble(text);
  let res;
  try {
    res = await window.akhtar.sendMessage({ conversationId: state.conversationId, workspaceId: state.workspace?.id || null, mode: state.mode, text });
  } catch (e) { res = { ok: false, error: e.message }; }
  if (!res.ok) {
    setRunning(false);
    showError(res.error);
  }
}
sendBtn.addEventListener('click', sendMessage);
takeoverBtn.addEventListener('click', async () => {
  if (!state.conversationId || !state.running) return;
  takeoverBtn.disabled = true;
  const res = await window.akhtar.takeOverAgent({ conversationId: state.conversationId });
  takeoverBtn.disabled = false;
  if (!res.ok) logActivity(`Take over gagal: ${res.error}`);
});
continueBtn.addEventListener('click', async () => {
  if (!state.conversationId || !state.running) return;
  const res = await window.akhtar.continueAgent({ conversationId: state.conversationId });
  if (!res.ok) logActivity(`Continue gagal: ${res.error}`);
});
stopBtn.addEventListener('click', () => window.akhtar.stopAgent({ conversationId: state.conversationId }));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
function autoResize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; }
input.addEventListener('input', autoResize);

                                      
async function loadConversations() {
  const res = await window.akhtar.listConversations({ workspaceId: state.workspace?.id || null });
  convList.innerHTML = '';
  if (!res.ok) return;
  state.convModes = new Map(res.data.map((c) => [c.id, c.mode]));
  for (const c of res.data) {
    const div = document.createElement('div');
    div.className = 'conv-item' + (c.id === state.conversationId ? ' active' : '');
    div.textContent = c.title || 'Percakapan baru';
    div.title = c.title || '';
    div.onclick = () => selectConversation(c.id);
    convList.appendChild(div);
  }
}

async function selectConversation(id, { skipLoad } = {}) {
                                                                                                  
                                                                            
  if (!skipLoad) { if (state.streamFrame) cancelAnimationFrame(state.streamFrame); state.streamFrame = null; state.streamBubble = null; state.streamText = ''; state.toolCards.clear(); }
  state.conversationId = id;
                                                                                          
  const convMode = state.convModes?.get(id);
  if (convMode && convMode !== state.mode) applyMode(convMode, { persist: false });
  [...convList.children].forEach((c) => c.classList.remove('active'));
  const res = skipLoad ? { ok: true, data: [] } : await window.akhtar.listMessages({ conversationId: id });
  messagesEl.innerHTML = '';
  if (res.ok && res.data.length) {
    clearEmptyState();
    for (const m of res.data) {
      if (m.role === 'user') addUserBubble(m.content);
      else if (m.role === 'assistant' && m.content) {
        const div = document.createElement('div');
        div.className = 'msg assistant';
        div.innerHTML = `<div class="bubble">${mdToHtml(m.content)}</div>`;
        messagesEl.appendChild(div);
      }
    }
  } else if (!res.data || !res.data.length) {
    emptyState.classList.remove('hidden');
  }
  loadConversations();
  scrollDown();
}

el('newChatBtn').addEventListener('click', async () => {
  const res = await window.akhtar.createConversation({ workspaceId: state.workspace?.id || null, mode: state.mode });
  if (res.ok) { state.conversationId = res.data.id; messagesEl.innerHTML = ''; emptyState.classList.remove('hidden'); renderTodos([]); await loadConversations(); }
});

                                  
el('workspaceBtn').addEventListener('click', async () => {
  const res = await window.akhtar.openWorkspace();
  if (res.ok && res.data) {
    const changed = state.workspace?.id !== res.data.id;
    state.workspace = res.data;
    el('workspaceName').textContent = res.data.name;
    if (changed && !state.running) {
                                                                                      
      state.conversationId = null; messagesEl.innerHTML = ''; emptyState.classList.remove('hidden'); renderTodos([]);
    }
    await loadConversations();
    await refreshArtifacts();
    await refreshCheckpoints();
  }
});

                                        
function renderGhost() { const b=el('ghostBanner'); b?.classList.toggle('hidden', !state.ghost); if(state.ghost) el('workspaceName').textContent = `${state.workspace?.name || 'Project'} (salinan)`; }
el('ghostCreateBtn')?.addEventListener('click', async () => {
  if (!state.workspace) return logActivity('Pilih folder project dulu, baru buat salinan aman.');
  if (state.ghost) return;
  const source=state.workspace; const r=await window.akhtar.createGhostWorkspace({workspaceId:source.id});
  if(!r.ok) return logActivity(`Salinan gagal dibuat: ${r.error}`);
  state.ghost={...r.data,source}; state.workspace=r.data.workspace; state.conversationId=null; renderGhost(); await loadConversations(); logActivity('Salinan aman siap. Perubahan belum menyentuh project asli.');
});
el('ghostApplyBtn')?.addEventListener('click', async () => {
  if(!state.ghost || !confirm('Terapkan semua perubahan dari salinan ke project asli?')) return;
  let r=await window.akhtar.applyGhostWorkspace({ghostId:state.ghost.id});
  if(!r.ok && /Ghost apply blocked/.test(r.error||'')){
                                                                                                             
    if(!confirm(`${r.error}\n\nTimpa file-file itu dengan versi dari salinan?`)) return logActivity('Apply dibatalkan: ada konflik dengan project asli.');
    r=await window.akhtar.applyGhostWorkspace({ghostId:state.ghost.id, force:true});
  }
  if(!r.ok) return logActivity(`Apply gagal: ${r.error}`);
  const source=state.ghost.source; await window.akhtar.discardGhostWorkspace({ghostId:state.ghost.id}); state.ghost=null; state.workspace=source; el('workspaceName').textContent=source.name; renderGhost(); await loadConversations(); logActivity(`Diterapkan: ${r.data.applied} perubahan.`);
});
el('ghostDiscardBtn')?.addEventListener('click', async () => {
  if(!state.ghost || !confirm('Buang salinan ini beserta semua perubahannya?')) return;
  const source=state.ghost.source; await window.akhtar.discardGhostWorkspace({ghostId:state.ghost.id}); state.ghost=null; state.workspace=source; el('workspaceName').textContent=source.name; renderGhost(); await loadConversations(); logActivity('Salinan dibuang.');
});

                                    
const MODE_HINTS = {
  chat: 'Hanya menjawab. Agen tidak membuka atau mengubah file.',
  assist: 'Agen minta izin setiap kali mau mengubah sesuatu.',
  agent: 'Agen bekerja sendiri. Izin yang kamu beri untuk project ini akan diingat.',
};
function applyMode(mode, { persist = true } = {}) {
  if (!MODE_HINTS[mode]) mode = 'assist';
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
  if (el('modeHint')) el('modeHint').textContent = MODE_HINTS[mode];
  if (persist && state.conversationId) window.akhtar.setConversationMode({ id: state.conversationId, mode });
  if (state.convModes && state.conversationId) state.convModes.set(state.conversationId, mode);
}
document.querySelectorAll('.mode-btn').forEach((btn) => btn.addEventListener('click', () => applyMode(btn.dataset.mode)));

                                                 
document.querySelectorAll('.panel-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.panel-tab').forEach((t) => { t.classList.toggle('active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
  document.querySelectorAll('.panel-page').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== tab.dataset.panel));
  if (tab.dataset.panel === 'history') refreshTimeline();
}));
(function initPanelToggle() {
  const btn = el('panelToggle'); const body = document.querySelector('.body');
  if (!btn || !body) return;
  let collapsed = false;
  try { collapsed = localStorage.getItem('akhtar.panelCollapsed') === '1'; } catch { /* storage unavailable */ }
  const narrow = () => window.matchMedia('(max-width: 980px)').matches;
  const apply = () => {
    body.classList.toggle('panel-collapsed', collapsed && !narrow());
    body.classList.toggle('panel-open', !collapsed && narrow());
    btn.setAttribute('aria-pressed', String(!collapsed));
  };
  if (narrow()) collapsed = true;
  btn.addEventListener('click', () => { collapsed = !collapsed; try { localStorage.setItem('akhtar.panelCollapsed', collapsed ? '1' : '0'); } catch { /* ignore */ } apply(); });
  window.addEventListener('resize', apply);
  apply();
})();

                                        
document.querySelectorAll('.starter').forEach((b) => b.addEventListener('click', () => {
  input.value = b.dataset.prompt || b.textContent; autoResize(); input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}));

                                                     
el('askScreenBtn')?.addEventListener('click', async () => {
  const tab=activeBrowserTab(); if(!tab) return logActivity('Buka tab browser dulu.');
  topbarStatus.textContent='Klik bagian halaman yang ingin ditanyakan…';
  const r=await window.akhtar.askBrowserScreen({tabId:tab.id}); topbarStatus.textContent='';
  if(!r.ok) return logActivity(`Ask Screen gagal: ${r.error}`);
  const x=r.data; closeInlineToolDock(); input.value=`About this screen element on ${x.url}:
- tag: ${x.tag}
- role: ${x.role || 'none'}
- label/text: ${x.aria || x.text || '(none)'}
- link: ${x.href || 'none'}

Explain what this is and help me with it.`; autoResize(); input.focus();
});

                                                 
const providerSelect = el('providerSelect');
const modelSelect = el('modelSelect');

function renderProviderOptions() {
  providerSelect.innerHTML = '';
  for (const p of state.settings.providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label + (!p.requiresKey || p.hasKey ? '' : ' (no key)');
    providerSelect.appendChild(opt);
  }
  providerSelect.value = state.settings.activeModel.providerId;
  renderModelOptions();
}
function renderModelOptions() {
  const p = state.settings.providers.find((x) => x.id === providerSelect.value);
  modelSelect.innerHTML = '';
  const models = (p?.models || []).slice();
  if (state.settings.activeModel.model && !models.includes(state.settings.activeModel.model)) models.unshift(state.settings.activeModel.model);
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    modelSelect.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = '__custom__'; custom.textContent = 'Model lain…';
  modelSelect.appendChild(custom);
  if (p?.id === providerSelect.value && state.settings.activeModel.providerId === p?.id) modelSelect.value = state.settings.activeModel.model || '__custom__';
}
el('refreshPrimaryModels').addEventListener('click', async () => {
  const providerId = providerSelect.value;
  const btn = el('refreshPrimaryModels');
  btn.disabled = true;
  const before = btn.textContent;
  btn.textContent = '…';
  try {
    const result = await window.akhtar.listModels({ providerId });
    if (!result.ok) throw new Error(result.error || 'Gagal mengambil katalog model');
    const provider = state.settings.providers.find((p) => p.id === providerId);
    if (provider) provider.models = result.data.models || [];
    renderModelOptions();
    btn.title = `${result.data.models.length} model tersedia (xKiro hanya free)`;
  } catch (e) {
    alert('Tidak dapat memuat daftar model: ' + (e.message || e));
  } finally { btn.disabled = false; btn.textContent = before; }
});
providerSelect.addEventListener('change', async () => {
  renderModelOptions();
  const model = modelSelect.value === '__custom__' ? '' : modelSelect.value;
  await saveActiveModel(providerSelect.value, model);
});
modelSelect.addEventListener('change', async () => {
  let model = modelSelect.value;
  if (model === '__custom__') {
    model = prompt('Nama model:', '') || '';
    if (!model) { renderModelOptions(); return; }
  }
  await saveActiveModel(providerSelect.value, model);
});
async function saveActiveModel(providerId, model) {
  const res = await window.akhtar.updateSettings({ activeModel: { providerId, model } });
  if (res.ok) {
    state.settings = res.data;
    if (el('setSecondaryProvider')) renderSecondaryProviderOptions();
  }
}

                                                  
function availableSecondaryProviders() {
  const activeId = state.settings?.activeModel?.providerId;
  return (state.settings?.providers || []).filter((p) => p.id !== activeId && (!p.requiresKey || p.hasKey));
}

function renderSecondaryProviderOptions() {
  const select = el('setSecondaryProvider');
  if (!select || !state.settings) return;
  const collab = state.settings.collaboration || {};
  const providers = availableSecondaryProviders();
  select.innerHTML = '';

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Otomatis — pilih AI lain yang sudah diatur';
  select.appendChild(auto);

  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    select.appendChild(opt);
  }
  select.value = providers.some((p) => p.id === collab.secondaryProviderId) ? collab.secondaryProviderId : '';
  renderSecondaryModelOptions();
}

function renderSecondaryModelOptions() {
  const providerSel = el('setSecondaryProvider');
  const modelSel = el('setSecondaryModel');
  if (!providerSel || !modelSel || !state.settings) return;
  const providerId = providerSel.value;
  const collab = state.settings.collaboration || {};
  modelSel.innerHTML = '';

  const automatic = document.createElement('option');
  automatic.value = '';
  automatic.textContent = providerId ? 'Auto — provider default / first model' : 'Auto';
  modelSel.appendChild(automatic);

  const p = state.settings.providers.find((x) => x.id === providerId);
  const models = (p?.models || []).slice();
  if (providerId === collab.secondaryProviderId && collab.secondaryModel && !models.includes(collab.secondaryModel)) {
    models.unshift(collab.secondaryModel);
  }
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSel.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = '__custom__';
  custom.textContent = 'Custom model…';
  modelSel.appendChild(custom);
  modelSel.value = providerId === collab.secondaryProviderId ? (collab.secondaryModel || '') : '';
}

function updateCollabDisabledState() {
  const off = el('setCollabMode')?.value === 'off';
  if (el('setSecondaryProvider')) el('setSecondaryProvider').disabled = off;
  if (el('setSecondaryModel')) el('setSecondaryModel').disabled = off;
  if (el('refreshSecondaryModels')) el('refreshSecondaryModels').disabled = off;
}

async function saveCollaboration(patch) {
  const res = await window.akhtar.updateSettings({ collaboration: patch });
  if (res.ok) {
    state.settings = res.data;
    renderSecondaryProviderOptions();
    updateCollabDisabledState();
  }
}

el('setCollabMode').addEventListener('change', async (e) => {
  await saveCollaboration({ mode: e.target.value });
});
el('setSecondaryProvider').addEventListener('change', async (e) => {
  await saveCollaboration({ secondaryProviderId: e.target.value, secondaryModel: '' });
});
el('setSecondaryModel').addEventListener('change', async (e) => {
  let model = e.target.value;
  if (model === '__custom__') {
    model = prompt('Nama model second AI:', '') || '';
    if (!model) { renderSecondaryModelOptions(); return; }
  }
  await saveCollaboration({ secondaryModel: model });
});
el('refreshSecondaryModels').addEventListener('click', async () => {
  const providerId = el('setSecondaryProvider').value;
  if (!providerId) return;
  const btn = el('refreshSecondaryModels');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  try {
    const res = await window.akhtar.listModels({ providerId });
    if (!res.ok) throw new Error(res.error);
    const p = state.settings.providers.find((x) => x.id === providerId);
    if (p && Array.isArray(res.data.models)) p.models = res.data.models;
    renderSecondaryModelOptions();
  } catch (e) {
    alert('Gagal memuat model: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
    updateCollabDisabledState();
  }
});

                                                
function renderVisionProviderOptions() {
  const select = el('setVisionProvider'); if (!select || !state.settings) return;
  const eligible = (state.settings.providers || []).filter(p => ['openai','openrouter','openai-compatible','local','supabase-xkiro'].includes(p.type));
  select.innerHTML = '<option value="">Same as primary model</option>';
  for (const p of eligible) { const o=document.createElement('option'); o.value=p.id; o.textContent=p.label; select.appendChild(o); }
  select.value = state.settings.browserVision?.providerId || '';
}
async function saveVisionSettings(patch) {
  const res = await window.akhtar.updateSettings({ browserVision: patch });
  if (res.ok) { state.settings=res.data; state.visionMax=res.data.browserVision.maxCallsPerTask; renderVisionBudget(); }
}
el('setVisionMode').addEventListener('change', e => saveVisionSettings({mode:e.target.value}));
el('setVisionMax').addEventListener('change', e => saveVisionSettings({maxCallsPerTask:Number(e.target.value)}));
el('setVisionProvider').addEventListener('change', e => saveVisionSettings({providerId:e.target.value}));
el('setVisionModel').addEventListener('change', e => saveVisionSettings({model:e.target.value.trim()}));

                                        
const settingsOverlay = el('settingsOverlay');
el('settingsBtn').addEventListener('click', openSettings);
el('settingsClose').addEventListener('click', () => settingsOverlay.classList.add('hidden'));
function showSettingsSection(name) {
  document.querySelectorAll('.settings-nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
  document.querySelectorAll('.settings-page').forEach((p) => p.classList.toggle('hidden', p.dataset.section !== name));
}
document.querySelectorAll('.settings-nav-btn').forEach((b) => b.addEventListener('click', () => showSettingsSection(b.dataset.section)));
settingsOverlay.addEventListener('mousedown', (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden'); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!settingsOverlay.classList.contains('hidden')) settingsOverlay.classList.add('hidden');
  else if (!el('previewModal')?.classList.contains('hidden')) closeUniversalPreview();
  else if (!el('labModal')?.classList.contains('hidden')) el('labModal').classList.add('hidden');
  else if (!el('chartModal')?.classList.contains('hidden')) el('chartModal').classList.add('hidden');
});

async function openSettings() {
  const rows = el('providerRows');
  rows.innerHTML = '';
  for (const p of state.settings.providers) {
    const row = document.createElement('div');
    row.className = 'provider-row';
    if (!p.requiresKey) {
      row.classList.add('no-key');
      row.innerHTML = `
      <span class="p-label">${escapeHtml(p.label)}</span>
      <span class="field-hint" style="flex:1;margin:0;">${['supabase-openai','supabase-xkiro'].includes(p.type) ? 'Tidak perlu kunci API. Cukup masuk di bagian Akun &amp; kredit.' : 'Tidak perlu kunci API.'}</span>`;
    } else {
      row.innerHTML = `
      <span class="p-label">${escapeHtml(p.label)}</span>
      <input type="password" class="text-input" placeholder="Tempel kunci API" data-provider="${p.id}" />
      <span class="p-status ${p.hasKey ? 'on' : ''}">${p.hasKey ? 'Tersimpan' : 'Belum diisi'}</span>
      <button class="btn" data-save="${p.id}">Simpan</button>`;
    }
    rows.appendChild(row);
  }
  rows.querySelectorAll('button[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.save;
      const input2 = rows.querySelector(`input[data-provider="${id}"]`);
      if (!input2.value) return;
      const res = await window.akhtar.setApiKey({ providerId: id, apiKey: input2.value });
      if (res.ok) { input2.value = ''; const status = input2.parentElement.querySelector('.p-status'); status.textContent = 'Tersimpan'; status.classList.add('on'); const p = state.settings.providers.find((x) => x.id === id); if (p) p.hasKey = true; renderProviderOptions(); }
    });
  });
  el('setMaxIter').value = state.settings.agent.maxIterations;
  el('setRunTimeout').value = state.settings.agent.runTimeoutMin;
  el('setCollabMode').value = state.settings.collaboration?.mode || 'auto';
  renderSecondaryProviderOptions();
  updateCollabDisabledState();
  renderVisionProviderOptions();
  el('setVisionMode').value = state.settings.browserVision?.mode || 'smart';
  el('setVisionMax').value = state.settings.browserVision?.maxCallsPerTask || 3;
  el('setVisionModel').value = state.settings.browserVision?.model || '';
  el('setOsUrl').value = state.settings.computerControl?.osUrl || '';
  el('setMcpServers').value = JSON.stringify(state.settings.mcp?.servers || [], null, 2);
  const ghStatus = el('githubTokenStatus');
  const ghHas = await window.akhtar.hasSecret({ name: 'github:token' });
  ghStatus.textContent = ghHas.ok && ghHas.data.has ? 'Tersimpan' : 'Belum diisi';
  ghStatus.classList.toggle('on', ghHas.ok && ghHas.data.has);
  renderLoadedPlugins();
  await loadBilling();
    settingsOverlay.classList.remove('hidden');
}
el('setMaxIter').addEventListener('change', async (e) => {
  const res = await window.akhtar.updateSettings({ agent: { maxIterations: +e.target.value } });
  if (res.ok) state.settings = res.data;
});
el('setRunTimeout').addEventListener('change', async (e) => {
  const res = await window.akhtar.updateSettings({ agent: { runTimeoutMin: +e.target.value } });
  if (res.ok) state.settings = res.data;
});
el('setOsUrl').addEventListener('change', async (e) => {
  const res = await window.akhtar.updateSettings({ computerControl: { osUrl: e.target.value.trim() } });
  if (res.ok) state.settings = res.data;
});
el('saveMcpServers').addEventListener('click', async () => {
  const status = el('mcpStatus');
  try {
    const servers = JSON.parse(el('setMcpServers').value || '[]');
    if (!Array.isArray(servers)) throw new Error('Harus JSON array.');
    for (const s of servers) {
      if (!s || typeof s.id !== 'string' || !s.id.trim()) throw new Error('Setiap server perlu id.');
      if ((s.transport || 'stdio') !== 'stdio') throw new Error('MCP v1 Akhtar Agent baru mendukung transport stdio.');
      if (typeof s.command !== 'string' || !s.command.trim()) throw new Error(`Server ${s.id} perlu command.`);
    }
    const res = await window.akhtar.updateSettings({ mcp: { servers } });
    if (!res.ok) throw new Error(res.error);
    state.settings = res.data;
    await window.akhtar.resetMcp();
    status.textContent = `Tersimpan: ${servers.length} server.`;
  } catch (e) { status.textContent = `Error: ${e.message}`; }
});
el('saveGithubToken').addEventListener('click', async () => {
  const input = el('setGithubToken');
  if (!input.value) return;
  const res = await window.akhtar.setSecret({ name: 'github:token', value: input.value });
  if (res.ok) {
    input.value = '';
    const status = el('githubTokenStatus');
    status.textContent = 'Tersimpan';
    status.classList.add('on');
  }
});
el('savePluginSecret').addEventListener('click', async () => {
  const nameInput = el('pluginSecretName');
  const valueInput = el('pluginSecretValue');
  if (!nameInput.value.trim() || !valueInput.value) return;
  const res = await window.akhtar.setSecret({ name: nameInput.value.trim(), value: valueInput.value });
  const status = el('pluginSecretStatus');
  if (res.ok) { status.textContent = `Tersimpan: ${nameInput.value.trim()}`; nameInput.value = ''; valueInput.value = ''; }
  else { status.textContent = `Gagal: ${res.error}`; }
});
function renderLoadedPlugins() {
  const el2 = el('loadedPluginsList');
  if (!el2) return;
  const list = state.plugins?.loaded || [];
  el2.textContent = list.length ? `Plugin aktif: ${list.map((p) => `${p.name} (${p.toolCount} tool)`).join(', ')}` : 'Belum ada plugin di folder plugins/.';
}

                             
(async function boot() {
  const res = await window.akhtar.bootstrap();
  if (!res.ok) { topbarStatus.textContent = 'Gagal memuat aplikasi: ' + res.error; return; }
  state.settings = res.data.settings;
  state.plugins = res.data.plugins;
  state.workspaces = res.data.workspaces || [];
  state.resumableTasks = res.data.resumableTasks || [];
  renderProviderOptions();
  renderResumeBanner();
  state.visionMax = state.settings.browserVision?.maxCallsPerTask || 3; renderVisionBudget();
  if (res.data.workspaces?.length) {
    state.workspace = res.data.workspaces[0];
    el('workspaceName').textContent = state.workspace.name;
  }
  await loadConversations();
  await refreshArtifacts();
  await refreshCheckpoints();
  const dls = await window.akhtar.listDownloads();
  if (dls.ok) dls.data.forEach(renderDownloadRow);
  const tabs = await window.akhtar.listBrowserTabs();
  if (tabs.ok) renderBrowserTabs(tabs.data);
  await refreshSchedules();
})();

                                       
const billingUi = { overview:null, planId:null, method:null, session:null };
function moneyIDR(n){ return Number(n||0)===0 ? 'Rp0' : new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n); }
function renderBilling(){
  const grid=el('billingPlanGrid'), methods=el('billingMethods'), btn=el('billingCheckoutBtn');
  if(!grid||!methods||!billingUi.overview) return;
  grid.innerHTML='';
  for(const p of billingUi.overview.plans){
    const card=document.createElement('button'); card.type='button'; card.className='billing-plan-card'+(billingUi.planId===p.id?' selected':'');
    card.innerHTML=`<div class="plan-name">${escapeHtml(p.name)}</div><div class="plan-price">${escapeHtml(moneyIDR(p.price))}<span class="field-hint"> / bulan</span></div><div class="plan-copy">${escapeHtml(p.description)}</div>`;
    card.addEventListener('click',()=>{ billingUi.planId=p.id; renderBilling(); }); grid.appendChild(card);
  }
  methods.innerHTML='';
  for(const m of billingUi.overview.paymentMethods){
    const row=document.createElement('label'); row.className='billing-method'+(billingUi.method===m.id?' selected':'');
    row.innerHTML=`<input type="radio" name="billingMethod" value="${escapeHtml(m.id)}" ${billingUi.method===m.id?'checked':''}><span>${escapeHtml(m.label)}</span>`;
    row.addEventListener('click',()=>{ billingUi.method=m.id; renderBilling(); }); methods.appendChild(row);
  }
  const plan=billingUi.overview.plans.find(p=>p.id===billingUi.planId);
  btn.disabled=!plan || plan.id==='free' || !billingUi.method;
  const auth=el('billingAuthStatus'), form=el('billingAuthForm'), out=el('billingSignOut'); if(auth){auth.textContent=billingUi.session?.signedIn ? `Masuk sebagai ${billingUi.session.user.email}` : 'Masuk untuk memakai kredit dan upgrade paket.'; form?.classList.toggle('hidden',!!billingUi.session?.signedIn); out?.classList.toggle('hidden',!billingUi.session?.signedIn);} btn.disabled=btn.disabled || !billingUi.session?.signedIn;
                                                                                         
  const st=el('billingCheckoutStatus'); if(st && !billingUi.checkoutStarted){ st.textContent = !billingUi.session?.signedIn ? 'Masuk dulu untuk upgrade paket.' : (plan?.id==='free' ? 'Paket Gratis tidak perlu pembayaran.' : 'Pembayaran diproses aman lewat Stripe di browser.'); }
}
async function loadBilling(){
  const sess=await window.akhtar.authSession(); billingUi.session=sess.ok?sess.data:{signedIn:false,user:null};
  const creditEl=el('creditBalance'), rewardEl=el('creditRewardStatus');
  if(billingUi.session?.signedIn){
    const cr=await window.akhtar.creditsClaimLogin();
    if(cr.ok && cr.data?.wallet){ if(creditEl) creditEl.textContent=Number(cr.data.wallet.balance).toLocaleString(); if(rewardEl) rewardEl.textContent='Bonus: +21 per hari, +42 per bulan, dan +423 saat pertama kali masuk.'; }
    else if(rewardEl) rewardEl.textContent=cr.error||'Kredit belum bisa dimuat. Coba lagi sebentar.';
  } else { if(creditEl) creditEl.textContent='—'; if(rewardEl) rewardEl.textContent='Masuk untuk melihat kredit.'; }
  const res=await window.akhtar.billingOverview(); if(!res.ok){ el('billingCheckoutStatus').textContent=res.error; return; }
  billingUi.overview=res.data; billingUi.planId=billingUi.planId||'plus'; billingUi.method='stripe'; renderBilling();
}
el('billingCheckoutBtn')?.addEventListener('click',async()=>{
  const status=el('billingCheckoutStatus'); billingUi.checkoutStarted=true; status.textContent='Menyiapkan pembayaran…';
  const res=await window.akhtar.createCheckout({planId:billingUi.planId,method:billingUi.method});
  if(!res.ok){ status.textContent=res.error; return; }
  const d=res.data; status.textContent=d.status==='setup_required' ? `${moneyIDR(d.amount)} · ${d.message}` : `Payment ${d.status}`;
});


async function billingAuth(mode){const email=el('billingEmail')?.value.trim(),password=el('billingPassword')?.value||'',status=el('billingAuthStatus');if(!email||password.length<6){status.textContent='Isi email dan kata sandi (minimal 6 karakter).';return;}status.textContent=mode==='signin'?'Sedang masuk…':'Membuat akun…';const res=mode==='signin'?await window.akhtar.authSignIn({email,password}):await window.akhtar.authSignUp({email,password,displayName:email.split('@')[0]});if(!res.ok){status.textContent=res.error;return;}if(res.data.confirmationRequired){status.textContent='Akun dibuat. Buka email konfirmasi, lalu masuk.';return;}await loadBilling();}
el('billingSignIn')?.addEventListener('click',()=>billingAuth('signin'));
el('billingSignUp')?.addEventListener('click',()=>billingAuth('signup'));
el('billingSignOut')?.addEventListener('click',async()=>{await window.akhtar.authSignOut();await loadBilling();});

                                                          
const mapBody = el('mapBody');
let mapUi=null, mapUserMarker=null, mapRouteLayers=[], mapMarkers=new Map(), mapWatchId=null, mapDestination=null;
function ensureMap(){
  if(mapUi||!window.L)return mapUi;
  mapUi=L.map('mapCanvas',{zoomControl:true}).setView([-6.2,106.8],10);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(mapUi);
  return mapUi;
}
function mapSetStatus(t){el('mapStatus').textContent=t;}
function mapShowRoutes(routes){const m=ensureMap();if(!m)return;mapRouteLayers.forEach(x=>m.removeLayer(x));mapRouteLayers=[];(routes||[]).forEach((r,i)=>{const layer=L.polyline(r.geometry.map(p=>[p.latitude,p.longitude]),{weight:i?4:7,opacity:i?.45:.9}).addTo(m);mapRouteLayers.push(layer);if(i===0&&r.geometry.length)m.fitBounds(layer.getBounds(),{padding:[35,35]});});if(routes?.[0])mapSetStatus(`Fastest estimated route: ${routes[0].distance_km} km · ${routes[0].duration_min} min · no live traffic data`);}
function startLocationWatch(){if(mapWatchId!=null)return;if(!navigator.geolocation){mapSetStatus('Location is not supported on this system.');return;}mapWatchId=navigator.geolocation.watchPosition(async pos=>{const c=pos.coords,loc={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,heading:c.heading,speed:c.speed};await window.akhtar.mapLocation(loc);const m=ensureMap();if(m){if(!mapUserMarker)mapUserMarker=L.circleMarker([c.latitude,c.longitude],{radius:8,weight:3}).addTo(m).bindPopup('Your location');else mapUserMarker.setLatLng([c.latitude,c.longitude]);}},err=>mapSetStatus(`Location unavailable: ${err.message}`),{enableHighAccuracy:true,maximumAge:3000,timeout:12000});}
el('mapLocateBtn')?.addEventListener('click',()=>{startLocationWatch();setTimeout(()=>{if(mapUserMarker){ensureMap().setView(mapUserMarker.getLatLng(),16);mapUserMarker.openPopup();}},800)});
el('mapSearchBtn')?.addEventListener('click',()=>{const q=el('mapSearch').value.trim();if(!q){el('mapSearch').focus();return;}input.value=`Tunjukkan ${q} di peta`;autoResize();closeInlineToolDock();input.focus();});
el('mapSearch')?.addEventListener('keydown',(e)=>{if(e.key==='Enter')el('mapSearchBtn').click();});
function stopLocationWatch(){if(mapWatchId!=null&&navigator.geolocation){navigator.geolocation.clearWatch(mapWatchId);}mapWatchId=null;}
                                                                                           
el('mapStopNavBtn')?.addEventListener('click',async()=>{await window.akhtar.mapNavigationStop({});stopLocationWatch();el('mapNavCard').classList.add('hidden');el('mapStopNavBtn').classList.add('hidden')});
window.akhtar.onMapEvent((e)=>{if (['open', 'view_set', 'marker_add', 'routes', 'navigation_start'].includes(e.type)) showInlineToolDock('map'); const m=ensureMap();if(!m)return;if(e.type==='open'){showInlineToolDock('map');if(e.point)m.setView([e.point.latitude,e.point.longitude],e.zoom||14)}else if(e.type==='view_set')m.setView([e.latitude,e.longitude],e.zoom||m.getZoom());else if(e.type==='marker_add'){const mk=L.marker([e.marker.latitude,e.marker.longitude]).addTo(m);if(e.marker.label)mk.bindPopup(e.marker.label).openPopup();mapMarkers.set(e.marker.id,mk)}else if(e.type==='marker_clear'){mapMarkers.forEach(x=>m.removeLayer(x));mapMarkers.clear()}else if(e.type==='routes')mapShowRoutes(e.routes);else if(e.type==='navigation_start'){showInlineToolDock('map');startLocationWatch();mapDestination=e.session.to;mapShowRoutes([e.session.route]);el('mapNavCard').classList.remove('hidden');el('mapStopNavBtn').classList.remove('hidden');el('mapNavTitle').textContent='Navigation active';el('mapNavEta').textContent=`${e.session.route.distance_km} km · ${e.session.route.duration_min} min`;const step=e.session.route.steps?.[0];el('mapNavNext').textContent=step?`${step.instruction} ${step.name}`:''}else if(e.type==='navigation_progress'){el('mapNavEta').textContent=`~${e.session.remaining_km} km · ~${e.session.eta_min} min`;if(e.offRouteM>120)mapSetStatus('Off route — recalculating…')}else if(e.type==='navigation_stop'){stopLocationWatch();el('mapNavCard').classList.add('hidden');el('mapStopNavBtn').classList.add('hidden')}});

                                          
const previewUi = { current:null, slide:0, sheet:0 };
const previewModal = el('previewModal');
const previewBody = el('previewBody');

function previewSize(n) {
  const x=Number(n)||0; if(x<1024)return `${x} B`; if(x<1024*1024)return `${(x/1024).toFixed(1)} KB`; return `${(x/1024/1024).toFixed(1)} MB`;
}
function previewCsv(text, maxRows=160, maxCols=30) {
  const rows=[]; let row=[],cell='',q=false;
  const src=String(text||'');
  for(let i=0;i<src.length && rows.length<maxRows;i++){
    const c=src[i];
    if(q){ if(c==='"'&&src[i+1]==='"'){cell+='"';i++;} else if(c==='"')q=false; else cell+=c; }
    else if(c==='"')q=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'){row.push(cell);rows.push(row.slice(0,maxCols));row=[];cell='';}
    else if(c!=='\r')cell+=c;
  }
  if(row.length||cell) { row.push(cell); rows.push(row.slice(0,maxCols)); }
  return rows;
}
function renderPreviewTable(rows) {
  const wrap=document.createElement('div'); wrap.className='preview-sheet-wrap';
  const table=document.createElement('table'); table.className='preview-table';
  const width=Math.min(30,Math.max(1,...(rows||[]).map(r=>r.length)));
  const head=document.createElement('thead'),hr=document.createElement('tr');
  for(let c=0;c<width;c++){const th=document.createElement('th');th.textContent=String.fromCharCode(65+(c%26));hr.appendChild(th);} head.appendChild(hr);table.appendChild(head);
  const tb=document.createElement('tbody');
  for(const r of (rows||[]).slice(0,300)){const tr=document.createElement('tr');for(let c=0;c<width;c++){const td=document.createElement('td');td.textContent=r[c]??'';td.title=r[c]??'';tr.appendChild(td);}tb.appendChild(tr);} table.appendChild(tb);wrap.appendChild(table);return wrap;
}
function previewMarkdownHtml(text) {
  const lines=String(text||'').replace(/\r\n/g,'\n').split('\n');
  return lines.map(line=>{
    const m=line.match(/^(#{1,4})\s+(.*)$/); if(m)return `<h${m[1].length}>${mdToHtml(m[2])}</h${m[1].length}>`;
    if(/^[-*]\s+/.test(line))return `<div>• ${mdToHtml(line.replace(/^[-*]\s+/,''))}</div>`;
    return line.trim()?`<p>${mdToHtml(line)}</p>`:'<br>';
  }).join('');
}
function renderPreviewSlide(p) {
  const shell=document.createElement('div');shell.className='preview-slide-shell';
  const nav=document.createElement('div');nav.className='preview-slide-nav';
  const prev=document.createElement('button');prev.className='btn btn-small';prev.textContent='←';prev.disabled=previewUi.slide<=0;
  const next=document.createElement('button');next.className='btn btn-small';next.textContent='→';next.disabled=previewUi.slide>=p.slides.length-1;
  const label=document.createElement('span');label.textContent=`Slide ${previewUi.slide+1} / ${Math.max(1,p.slides.length)}`;
  prev.onclick=()=>{previewUi.slide=Math.max(0,previewUi.slide-1);renderUniversalPreview(p,{preserve:true});}; next.onclick=()=>{previewUi.slide=Math.min(p.slides.length-1,previewUi.slide+1);renderUniversalPreview(p,{preserve:true});};
  nav.append(prev,label,next);
  const slide=document.createElement('section');slide.className='preview-slide';const s=p.slides[previewUi.slide]||{title:'Slide kosong',texts:[]};
  const h=document.createElement('h3');h.textContent=s.title||`Slide ${previewUi.slide+1}`;slide.appendChild(h);
  if(s.texts?.length){const ul=document.createElement('ul');for(const t of s.texts){const li=document.createElement('li');li.textContent=t;ul.appendChild(li);}slide.appendChild(ul);}
  shell.append(nav,slide);previewBody.appendChild(shell);
}
function renderPreviewSheet(p) {
  const tools=document.createElement('div');tools.className='preview-sheet-toolbar';const sel=document.createElement('select');sel.className='text-input';sel.style.maxWidth='240px';
  (p.sheets||[]).forEach((sh,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=sh.name||`Sheet ${i+1}`;sel.appendChild(o);});
  previewUi.sheet=Math.min(previewUi.sheet,Math.max(0,(p.sheets?.length||1)-1));sel.value=String(previewUi.sheet);sel.onchange=()=>{previewUi.sheet=Number(sel.value)||0;renderUniversalPreview(p,{preserve:true});};tools.append('Sheet: ',sel);previewBody.appendChild(tools);previewBody.appendChild(renderPreviewTable(p.sheets?.[previewUi.sheet]?.rows||[]));
}
function renderUniversalPreview(p,{preserve=false}={}) {
  if(!p||!previewBody)return; previewUi.current=p; if(!preserve){previewUi.slide=0;previewUi.sheet=0;}
  el('previewTitle').textContent=p.name||'Preview';el('previewMeta').textContent=`${p.kind||'file'} · ${previewSize(p.size)} · ${p.path||''}${p.truncated?' · dipotong':''}`;el('previewStatus').textContent=p.summary||'Sandboxed preview · read only';
  previewBody.innerHTML='';
  if(p.kind==='image'){const w=document.createElement('div');w.className='preview-image-wrap';const img=document.createElement('img');img.className='preview-image';img.alt=p.name||'Image preview';img.src=p.dataUrl;w.appendChild(img);previewBody.appendChild(w);}
  else if(p.kind==='pdf'){const f=document.createElement('iframe');f.className='preview-frame';f.title=`PDF ${p.name||''}`;f.src=p.dataUrl;previewBody.appendChild(f);}
  else if(p.kind==='html'){const f=document.createElement('iframe');f.className='preview-frame';f.title=`HTML ${p.name||''}`;f.setAttribute('sandbox','');const clean=String(p.text||'').replace(/<script\b[\s\S]*?<\/script\s*>/gi,'').replace(/<base\b[^>]*>/gi,'');f.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"><style>html,body{font-family:system-ui,sans-serif;margin:0;padding:12px;box-sizing:border-box}</style>${clean}`;previewBody.appendChild(f);}
  else if(p.kind==='audio'||p.kind==='video'){const w=document.createElement('div');w.className='preview-media-wrap';const media=document.createElement(p.kind);media.controls=true;media.src=p.dataUrl;w.appendChild(media);previewBody.appendChild(w);}
  else if(p.kind==='markdown'){const d=document.createElement('article');d.className='preview-markdown';d.innerHTML=previewMarkdownHtml(p.text||'');previewBody.appendChild(d);}
  else if(p.kind==='text'){const pre=document.createElement('pre');pre.className='preview-code';pre.textContent=p.text||'';previewBody.appendChild(pre);}
  else if(p.kind==='csv'){previewBody.appendChild(renderPreviewTable(previewCsv(p.text||'')));}
  else if(p.kind==='document'){const d=document.createElement('article');d.className='preview-doc';for(const b of p.blocks||[]){const q=document.createElement('p');q.textContent=b.text||'';d.appendChild(q);}previewBody.appendChild(d);}
  else if(p.kind==='slides')renderPreviewSlide(p);
  else if(p.kind==='spreadsheet')renderPreviewSheet(p);
  else if(p.kind==='model3d'){const c=document.createElement('div');c.className='preview-model-card';const h=document.createElement('h3');h.textContent='Model 3D';const info=document.createElement('p');info.textContent=p.summary||'Metadata model';const g=document.createElement('div');g.className='preview-model-grid';for(const [k,v] of Object.entries(p.model||{})){if(typeof v==='object')continue;const d=document.createElement('div');d.className='preview-model-stat';const st=document.createElement('strong');st.textContent=String(v);const sp=document.createElement('span');sp.textContent=k;d.append(st,sp);g.appendChild(d);}c.append(h,info,g);previewBody.appendChild(c);}
  else {const e=document.createElement('div');e.className='preview-empty';e.textContent=p.summary||'Format ini belum punya renderer visual, tapi file terdeteksi.';previewBody.appendChild(e);}
  previewModal?.classList.remove('hidden');
}
async function closeUniversalPreview(){previewModal?.classList.add('hidden');previewUi.current=null;await window.akhtar.closePreview?.({});}
window.akhtar.onPreviewEvent?.((event)=>{if(event?.type==='close'){previewModal?.classList.add('hidden');previewUi.current=null;return;}if(event?.preview)renderUniversalPreview(event.preview);});
el('previewCloseBtn')?.addEventListener('click',closeUniversalPreview);
previewModal?.addEventListener('mousedown',(e)=>{if(e.target===previewModal)closeUniversalPreview();});
el('previewRefreshBtn')?.addEventListener('click',async()=>{if(!state.workspace?.id)return;const b=el('previewRefreshBtn');b.disabled=true;const r=await window.akhtar.refreshPreview({workspaceId:state.workspace.id});b.disabled=false;if(!r.ok)el('previewStatus').textContent=`Refresh gagal: ${r.error}`;});
el('previewAskBtn')?.addEventListener('click',()=>{const p=previewUi.current;if(!p||state.running)return;input.value=`Jelaskan file yang sedang terbuka di Universal Preview: ${p.path}. Fokus pada bagian yang paling penting dan jawab berdasarkan file itu.`;autoResize();previewModal.classList.add('hidden');sendMessage();});

                                                                        
const labUiState = { session:null, paused:false, speed:1, earnedIds:new Set(), xp:0 };
const labModal = el('labModal');
const labStage = el('labStage');

function labNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function labAnimationDuration() {
  const speed = Math.max(.25, Number(labUiState.speed) || 1);
  return `${(2.2 / speed).toFixed(2)}s`;
}

function labParticle(parent, className, left, delay, text='') {
  const p = labNode('span', className, text);
  p.style.left = `${left}%`;
  p.style.animationDelay = `${delay}s`;
  parent.appendChild(p);
  return p;
}

function renderChemistryStage(scene) {
  labStage.innerHTML = '';
  labStage.style.setProperty('--lab-duration', labAnimationDuration());
  const label = labNode('div', 'lab-effect-label', scene.title || 'Eksperimen Kimia');
  labStage.appendChild(label);

  if (scene.effect === 'concept_only') {
    const orb = labNode('div', 'lab-warning-orb', '🛡️ Concept Only\nSimulasi aman');
    orb.style.whiteSpace = 'pre-line';
    labStage.appendChild(orb);
    return;
  }

  labStage.appendChild(labNode('div', 'lab-bench'));
  const beaker = labNode('div', 'lab-beaker');
  const liquid = labNode('div', 'lab-liquid');
  beaker.appendChild(liquid);
  labStage.appendChild(beaker);

  const materials = scene.materials || [];
  const mainColor = materials.find(m => m.kind === 'liquid' && m.id !== 'water')?.color;
  if (mainColor && scene.effect !== 'layers') liquid.style.background = `linear-gradient(180deg, ${mainColor}bb, ${mainColor}ee)`;

  if (scene.effect === 'layers') {
    liquid.innerHTML = '';
    liquid.appendChild(labNode('div','lab-layer-top'));
    liquid.appendChild(labNode('div','lab-layer-bottom'));
  } else if (scene.effect === 'fizz') {
    for (let i=0;i<18;i++) {
      const b=labParticle(liquid,'lab-bubble',8+(i*17)%84,-(i%7)*.19);
      b.style.width=`${8+(i%4)*3}px`; b.style.height=b.style.width;
    }
  } else if (scene.effect === 'diffusion') {
    for (let i=0;i<7;i++) {
      const d=labParticle(beaker,'lab-drop',26+(i*11)%50,-i*.28);
      d.style.background = materials.find(m=>m.id==='food_coloring')?.color || '#8b5cf6';
    }
    for (let i=0;i<12;i++) labParticle(liquid,'lab-particle',10+(i*19)%80,-(i%6)*.25);
  } else if (scene.effect === 'indicator_acid') {
    liquid.style.background='linear-gradient(180deg, rgba(244,114,182,.82), rgba(190,24,93,.88))';
    for (let i=0;i<12;i++) labParticle(liquid,'lab-particle',8+(i*23)%84,-(i%5)*.3);
  } else if (scene.effect === 'cold') {
    liquid.style.background='linear-gradient(180deg, rgba(186,230,253,.72), rgba(125,211,252,.86))';
    for (let i=0;i<10;i++) {
      const f=labParticle(beaker,'lab-coldflake',12+(i*29)%76,-i*.2,'❄');
      f.style.top = `${5+(i%3)*8}px`;
    }
  } else {
    const particleColor = materials.find(m=>m.kind==='solid')?.color || '#ffffff';
    for (let i=0;i<16;i++) {
      const p=labParticle(liquid,'lab-particle',8+(i*17)%84,-(i%8)*.18);
      p.style.background=particleColor;
      if (scene.effect === 'dissolve') p.style.opacity=String(.35 + (i%4)*.12);
    }
  }
}

function renderPhysicsStage(scene) {
  labStage.innerHTML='';
  labStage.style.setProperty('--lab-duration', labAnimationDuration());
  const world=labNode('div','lab-physics-world');
  world.appendChild(labNode('div','lab-physics-label',scene.title || 'Eksperimen Fisika'));
  labStage.appendChild(world);

  if (scene.effect === 'projectile') {
    world.appendChild(labNode('div','lab-ground'));
    world.appendChild(labNode('div','lab-projectile-trail'));
    world.appendChild(labNode('div','lab-projectile'));
  } else if (scene.effect === 'pendulum') {
    world.appendChild(labNode('div','lab-pendulum-anchor'));
    world.appendChild(labNode('div','lab-pendulum'));
  } else if (scene.effect === 'spring') {
    world.appendChild(labNode('div','lab-spring'));
  } else if (scene.effect === 'float' || scene.effect === 'sink') {
    const tank=labNode('div','lab-tank');
    tank.appendChild(labNode('div','lab-tank-water'));
    tank.appendChild(labNode('div',`lab-float-object ${scene.effect === 'float' ? 'floats' : 'sinks'}`));
    world.appendChild(tank);
  }
}

function metricLabel(key) {
  const labels={flight_time_s:'Waktu terbang',range_m:'Jangkauan',max_height_m:'Tinggi maks.',period_s:'Periode',floats:'Hasil'};
  return labels[key] || String(key).replace(/_/g,' ');
}
function metricValue(key,value) {
  if (typeof value === 'boolean') return value ? 'Mengapung' : 'Tenggelam';
  const unit=key.endsWith('_s')?' s':key.endsWith('_m')?' m':'';
  return `${value}${unit}`;
}

function renderLabInfo(scene) {
  el('labTitle').textContent = scene.title || 'Akhtar Lab';
  el('labSummary').textContent = scene.summary || '—';
  el('labConcept').textContent = scene.concept || '—';
  const eq=el('labEquation');
  if (scene.equation) { eq.textContent=scene.equation; eq.classList.remove('hidden'); } else { eq.textContent=''; eq.classList.add('hidden'); }
  el('labChallenge').textContent = `💡 ${scene.challenge || 'Coba ubah satu hal dan prediksi hasilnya.'}`;

  const safety=el('labSafety');
  const restricted=scene.safetyLevel === 'concept-only';
  safety.classList.toggle('restricted', restricted);
  safety.textContent = restricted
    ? '🛡️ Concept Only — kombinasi ini hanya disimulasikan secara umum. Tidak ada takaran atau langkah praktik.'
    : '✨ Virtual Lab — aman dimainkan karena tidak melakukan eksperimen nyata.';

  const materials=el('labMaterials'); materials.innerHTML='';
  (scene.materials || []).forEach((m)=>{
    const chip=labNode('span','lab-material-chip');
    const dot=labNode('i','lab-material-dot'); dot.style.background=m.color || '#94a3b8';
    chip.append(dot, document.createTextNode(m.label || m.input || 'Zat'));
    materials.appendChild(chip);
  });

  const metrics=el('labMetrics'); metrics.innerHTML='';
  const entries=Object.entries(scene.metrics || {});
  metrics.classList.toggle('hidden', !entries.length);
  entries.forEach(([k,v])=>{
    const card=labNode('div','lab-metric');
    card.append(labNode('strong','',metricValue(k,v)),labNode('span','',metricLabel(k)));
    metrics.appendChild(card);
  });
}

function renderLabSession(session, {restart=false}={}) {
  if (!session?.scene || !labStage) return;
  labUiState.session=session;
  labUiState.paused=!!session.paused;
  labUiState.speed=Number(session.speed)||labUiState.speed||1;
  el('labSpeed').value = ['0.5','1','1.5','2'].includes(String(labUiState.speed)) ? String(labUiState.speed) : '1';
  renderLabInfo(session.scene);
  if (session.scene.domain === 'physics') renderPhysicsStage(session.scene); else renderChemistryStage(session.scene);
  labStage.classList.toggle('lab-paused',labUiState.paused);
  el('labPauseBtn').textContent=labUiState.paused?'▶ Lanjut':'⏸ Jeda';
  if (!labUiState.earnedIds.has(session.id)) {
    labUiState.earnedIds.add(session.id);
    labUiState.xp += Number(session.scene.xp)||5;
  }
  el('labXp').textContent=`${labUiState.xp} XP`;
  if (!restart) labModal?.classList.remove('hidden');
}

window.akhtar.onLabEvent?.((event)=>{
  if (!event?.session) return;
  renderLabSession(event.session);
  if (event.type === 'focus_fact') el('labConcept')?.scrollIntoView({block:'nearest',behavior:'smooth'});
});

el('closeLabModal')?.addEventListener('click',()=>labModal.classList.add('hidden'));
labModal?.addEventListener('click',(e)=>{ if(e.target===labModal) labModal.classList.add('hidden'); });
el('labRestartBtn')?.addEventListener('click',()=>{ if(labUiState.session) renderLabSession(labUiState.session,{restart:true}); });
el('labPauseBtn')?.addEventListener('click',()=>{
  labUiState.paused=!labUiState.paused;
  labStage?.classList.toggle('lab-paused',labUiState.paused);
  el('labPauseBtn').textContent=labUiState.paused?'▶ Lanjut':'⏸ Jeda';
});
el('labSpeed')?.addEventListener('change',(e)=>{
  labUiState.speed=Math.max(.5,Math.min(2,Number(e.target.value)||1));
  labStage?.style.setProperty('--lab-duration',labAnimationDuration());
});
el('labAskAiBtn')?.addEventListener('click',()=>{
  const scene=labUiState.session?.scene;
  if (!scene || state.running) return;
  input.value=`Jelaskan eksperimen Akhtar Lab “${scene.title}” yang sedang terbuka. Kenapa hasilnya begitu? Jelaskan singkat dan gampang dipahami.`;
  autoResize();
  labModal.classList.add('hidden');
  sendMessage();
});
