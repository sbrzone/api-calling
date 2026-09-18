const messagesEl = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const newChatBtn = document.getElementById('newChatBtn');
const clearBtn = document.getElementById('clearBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const systemPromptEl = document.getElementById('systemPrompt');
const temperatureEl = document.getElementById('temperature');
const tempValueEl = document.getElementById('tempValue');
const themeToggle = document.getElementById('themeToggle');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const appEl = document.querySelector('.app');
const apiKeyEl = document.getElementById('apiKey');
const modelSelectEl = document.getElementById('modelSelect');

const KIMI_BASE_URL = 'https://api.moonshot.ai/v1'; // use https://api.moonshot.cn/v1 for mainland-China keys

const STORAGE_KEY = 'kimi-chat-history';
const SETTINGS_KEY = 'kimi-chat-settings';
const KEY_STORAGE = 'kimi-api-key';

let history = []; // { role: 'user' | 'assistant', content: string }
let isStreaming = false;

marked.setOptions({ breaks: true });

// ---------- Persistence ----------
function loadState() {
  try {
    const savedHistory = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    history = Array.isArray(savedHistory) ? savedHistory : [];
    if (savedSettings.systemPrompt) systemPromptEl.value = savedSettings.systemPrompt;
    if (typeof savedSettings.temperature === 'number') {
      temperatureEl.value = savedSettings.temperature;
      tempValueEl.textContent = savedSettings.temperature.toFixed(1);
    }
    if (savedSettings.model) modelSelectEl.value = savedSettings.model;
    if (savedSettings.theme) setTheme(savedSettings.theme);
  } catch (e) { console.warn('Could not load saved state', e); }

  const savedKey = localStorage.getItem(KEY_STORAGE);
  if (savedKey) apiKeyEl.value = savedKey;
  updateStatus();
}

function saveHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    systemPrompt: systemPromptEl.value,
    temperature: parseFloat(temperatureEl.value),
    model: modelSelectEl.value,
    theme: appEl.dataset.theme,
  }));
}

apiKeyEl.addEventListener('change', () => {
  localStorage.setItem(KEY_STORAGE, apiKeyEl.value.trim());
  updateStatus();
});

function updateStatus() {
  if (apiKeyEl.value.trim()) {
    statusDot.className = 'status-dot online';
    statusText.textContent = `Ready · ${modelSelectEl.value}`;
  } else {
    statusDot.className = 'status-dot offline';
    statusText.textContent = 'Paste your Kimi API key above';
  }
}
modelSelectEl.addEventListener('change', () => { updateStatus(); saveSettings(); });

// ---------- Theme ----------
function setTheme(theme) {
  appEl.dataset.theme = theme;
  themeToggle.checked = theme === 'light';
}
themeToggle.addEventListener('change', () => {
  setTheme(themeToggle.checked ? 'light' : 'dark');
  saveSettings();
});

// ---------- Temperature ----------
temperatureEl.addEventListener('input', () => {
  tempValueEl.textContent = parseFloat(temperatureEl.value).toFixed(1);
  saveSettings();
});
systemPromptEl.addEventListener('change', saveSettings);

// ---------- Rendering ----------
function renderAll() {
  messagesEl.innerHTML = '';
  history.forEach((msg, idx) => renderMessage(msg, idx));
  scrollToBottom();
}

function renderMessage(msg, idx) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role}`;
  wrap.dataset.index = idx;

  const label = document.createElement('div');
  label.className = 'role-label';
  label.textContent = msg.role === 'user' ? 'You' : 'Kimi';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = marked.parse(msg.content || '');

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(msg.content);
    copyBtn.textContent = 'Copied';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
  };
  actions.appendChild(copyBtn);

  wrap.appendChild(label);
  wrap.appendChild(bubble);
  wrap.appendChild(actions);
  messagesEl.appendChild(wrap);
  return bubble;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function autoResize() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 160) + 'px';
}
userInput.addEventListener('input', autoResize);

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener('click', sendMessage);

// ---------- Chat flow ----------
async function sendMessage() {
  const text = userInput.value.trim();
  const key = apiKeyEl.value.trim();
  if (!text || isStreaming) return;
  if (!key) {
    alert('Paste your Kimi API key in the sidebar first.');
    return;
  }

  history.push({ role: 'user', content: text });
  saveHistory();
  renderAll();

  userInput.value = '';
  autoResize();

  await streamAssistantReply();
}

async function streamAssistantReply() {
  const key = apiKeyEl.value.trim();
  if (!key) return;

  isStreaming = true;
  sendBtn.disabled = true;

  history.push({ role: 'assistant', content: '' });
  saveHistory();
  const idx = history.length - 1;
  renderAll();

  const bubble = messagesEl.querySelector(`.msg[data-index="${idx}"] .bubble`);
  bubble.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';

  const payloadMessages = [];
  if (systemPromptEl.value.trim()) {
    payloadMessages.push({ role: 'system', content: systemPromptEl.value.trim() });
  }
  history.slice(0, -1).forEach(({ role, content }) => payloadMessages.push({ role, content }));

  try {
    const res = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelSelectEl.value,
        messages: payloadMessages,
        temperature: parseFloat(temperatureEl.value),
        stream: true,
      }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Kimi API error (${res.status}): ${errText.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let firstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        let json;
        try { json = JSON.parse(data); } catch { continue; }

        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          if (firstChunk) { bubble.innerHTML = ''; firstChunk = false; }
          fullText += delta;
          bubble.innerHTML = marked.parse(fullText);
          scrollToBottom();
        }
      }
    }

    history[idx].content = fullText || '_(no response)_';
    saveHistory();
    renderAll();
  } catch (err) {
    // Browsers block the request outright if Moonshot doesn't send CORS headers,
    // which surfaces here as a generic "Failed to fetch" TypeError.
    const isCorsLike = err instanceof TypeError;
    history[idx].content = isCorsLike
      ? `⚠️ Request blocked by the browser (likely CORS). Direct browser calls to the Kimi API may not be permitted — see the README for the fallback proxy option.`
      : `⚠️ ${err.message}`;
    saveHistory();
    renderAll();
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
  }
}

// ---------- Controls ----------
newChatBtn.addEventListener('click', () => {
  if (isStreaming) return;
  history = [];
  saveHistory();
  renderAll();
});

clearBtn.addEventListener('click', () => {
  if (isStreaming) return;
  history = [];
  saveHistory();
  renderAll();
});

regenerateBtn.addEventListener('click', async () => {
  if (isStreaming || history.length === 0) return;
  while (history.length && history[history.length - 1].role === 'assistant') {
    history.pop();
  }
  saveHistory();
  renderAll();
  if (history.length && history[history.length - 1].role === 'user') {
    await streamAssistantReply();
  }
});

// ---------- Init ----------
loadState();
renderAll();
autoResize();
