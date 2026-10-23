/**
 * X-Commentator AI — Popup Script
 * Handles settings management, live model synchronization, and UI interactions.
 */

// Known decommissioned / retired models on Groq
const DECOMMISSIONED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'gemma-7b-it',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-text-preview',
  'llama-3.2-90b-text-preview'
];

// Best, fastest, free-tier workhorse model for comments
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

// Dual-storage helper: saves to both local and sync, and notifies service worker
function saveSettingsToStorage(settings, callback) {
  chrome.storage.local.set(settings, () => {
    chrome.storage.sync.set(settings, () => {
      // Notify active service worker immediately
      try {
        chrome.runtime.sendMessage({ action: 'updateSettings', settings }, () => {
          if (chrome.runtime.lastError) {} // Ignore if worker is sleeping
        });
      } catch (e) {}
      if (callback) callback();
    });
  });
}

function loadSettingsFromStorage(defaults, callback) {
  chrome.storage.local.get(defaults, (localData) => {
    chrome.storage.sync.get(defaults, (syncData) => {
      const merged = { ...defaults, ...syncData, ...localData };
      callback(merged);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM Elements ────────────────────────────────────────
  const apiKeyInput = document.getElementById('apiKey');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const modelSelect = document.getElementById('model');
  const refreshModelsBtn = document.getElementById('refreshModelsBtn');
  const refreshModelsText = document.getElementById('refreshModelsText');
  const modelStatusMsg = document.getElementById('modelStatusMsg');
  const reloadExtBtn = document.getElementById('reloadExtBtn');
  const toneGrid = document.getElementById('toneGrid');
  const languageSelect = document.getElementById('language');
  const customPromptInput = document.getElementById('customPrompt');
  const temperatureSlider = document.getElementById('temperature');
  const tempValueLabel = document.getElementById('tempValue');
  const maxTokensSlider = document.getElementById('maxTokens');
  const tokensValueLabel = document.getElementById('tokensValue');
  const tokensCharsLabel = document.getElementById('tokensChars');
  const saveBtn = document.getElementById('saveBtn');
  const statusBadge = document.getElementById('statusBadge');

  function showModelStatus(msg, type = '') {
    if (!modelStatusMsg) return;
    modelStatusMsg.textContent = msg;
    modelStatusMsg.className = 'model-status-msg' + (type ? ` ${type}` : '');
  }

  function clearModelStatus() {
    if (!modelStatusMsg) return;
    modelStatusMsg.textContent = '';
    modelStatusMsg.className = 'model-status-msg';
  }

  // ─── Reload Extension Button ──────────────────────────────
  if (reloadExtBtn) {
    reloadExtBtn.addEventListener('click', () => {
      showModelStatus('Reloading extension...', 'warning');
      setTimeout(() => {
        chrome.runtime.reload();
      }, 250);
    });
  }

  // ─── Load Saved Settings ─────────────────────────────────
  loadSettingsFromStorage({
    apiKey: '',
    model: FALLBACK_MODEL,
    tone: 'friendly',
    language: 'english',
    customPrompt: '',
    maxTokens: 60,
    temperature: 0.8
  }, (settings) => {
    apiKeyInput.value = settings.apiKey || '';

    // Check for decommissioned model
    let selectedModel = settings.model || FALLBACK_MODEL;
    if (DECOMMISSIONED_MODELS.includes(selectedModel.toLowerCase())) {
      console.warn(`[X-Commentator] Migrating decommissioned model "${selectedModel}" to "${FALLBACK_MODEL}".`);
      selectedModel = FALLBACK_MODEL;
      saveSettingsToStorage({ model: FALLBACK_MODEL });
      showModelStatus('Migrated to LLaMA 3.1 8B (fastest)', 'warning');
      setTimeout(clearModelStatus, 3500);
    }

    // Ensure model is present in select options
    let modelFound = Array.from(modelSelect.options).some(opt => opt.value === selectedModel);
    if (!modelFound) {
      const customOpt = document.createElement('option');
      customOpt.value = selectedModel;
      customOpt.textContent = `${selectedModel} (Active)`;
      modelSelect.appendChild(customOpt);
    }
    modelSelect.value = selectedModel;

    languageSelect.value = settings.language;
    customPromptInput.value = settings.customPrompt;
    temperatureSlider.value = settings.temperature;
    tempValueLabel.textContent = settings.temperature;

    // Migrate old 280 default to 60 for Twitter character limits
    let tokens = settings.maxTokens || 60;
    if (tokens > 90) {
      tokens = 60;
      saveSettingsToStorage({ maxTokens: 60 });
    }
    maxTokensSlider.value = tokens;
    tokensValueLabel.textContent = tokens;
    if (tokensCharsLabel) {
      tokensCharsLabel.textContent = `~${Math.round(tokens * 3)} chars`;
    }

    // Set active tone
    setActiveTone(settings.tone);

    // Update status badge
    updateStatusBadge(settings.apiKey);
  });

  // ─── Auto-save model selection immediately when changed ───
  modelSelect.addEventListener('change', () => {
    const newModel = modelSelect.value;
    saveSettingsToStorage({ model: newModel }, () => {
      const selectedText = modelSelect.options[modelSelect.selectedIndex]?.text || newModel;
      showModelStatus(`✓ Saved: ${selectedText}`, 'success');
      setTimeout(clearModelStatus, 2500);
    });
  });

  // ─── Sync Live Models from Groq API ───────────────────────
  async function syncGroqModels() {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showModelStatus('Enter your Groq API key first to sync models.', 'warning');
      apiKeyInput.focus();
      return;
    }

    refreshModelsBtn.classList.add('loading');
    if (refreshModelsText) refreshModelsText.textContent = 'Syncing...';
    showModelStatus('Connecting to Groq API...', '');

    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Invalid API Key. Please verify your Groq key.');
        }
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Unexpected response format from Groq.');
      }

      // Filter for chat completion / text generation models (exclude whisper, guard, audio, embedding, tts)
      const activeChatModels = data.data
        .map(m => m.id)
        .filter(id => {
          const lower = id.toLowerCase();
          return !DECOMMISSIONED_MODELS.includes(lower) &&
                 !lower.includes('whisper') &&
                 !lower.includes('guard') &&
                 !lower.includes('audio') &&
                 !lower.includes('embedding') &&
                 !lower.includes('tts') &&
                 !lower.includes('orpheus');
        })
        .sort((a, b) => {
          if (a.includes('llama-3.1-8b')) return -1;
          if (b.includes('llama-3.1-8b')) return 1;
          if (a.includes('openai')) return -1;
          if (b.includes('openai')) return 1;
          return a.localeCompare(b);
        });

      if (activeChatModels.length === 0) {
        throw new Error('No active chat models found for your account.');
      }

      const previousSelected = modelSelect.value;
      modelSelect.innerHTML = '';

      const group = document.createElement('optgroup');
      group.label = `Live Groq Models (${activeChatModels.length} active)`;

      activeChatModels.forEach(modelId => {
        const option = document.createElement('option');
        option.value = modelId;

        // Friendly label
        let label = modelId;
        if (modelId === 'llama-3.1-8b-instant') label = 'LLaMA 3.1 8B (Fastest & Best for Comments)';
        else if (modelId === 'openai/gpt-oss-120b') label = 'OpenAI GPT-OSS 120B (Flagship Quality)';
        else if (modelId === 'openai/gpt-oss-20b') label = 'OpenAI GPT-OSS 20B (Fast & Balanced)';
        else if (modelId === 'qwen/qwen3.6-27b') label = 'Qwen 3.6 27B (Multilingual)';
        else if (modelId === 'deepseek-r1-distill-llama-70b') label = 'DeepSeek R1 Distill 70B (Reasoning)';
        else if (modelId.startsWith('llama-3.2-3b')) label = 'LLaMA 3.2 3B (Fast & Compact)';
        else if (modelId.startsWith('llama-3.2-1b')) label = 'LLaMA 3.2 1B (Ultra-Lightweight)';

        option.textContent = label;
        group.appendChild(option);
      });

      modelSelect.appendChild(group);

      // Restore selection if model is still available, otherwise fallback to recommended
      if (activeChatModels.includes(previousSelected)) {
        modelSelect.value = previousSelected;
      } else if (activeChatModels.includes(FALLBACK_MODEL)) {
        modelSelect.value = FALLBACK_MODEL;
        saveSettingsToStorage({ model: FALLBACK_MODEL });
      } else {
        modelSelect.value = activeChatModels[0];
        saveSettingsToStorage({ model: activeChatModels[0] });
      }

      showModelStatus(`✓ Synced ${activeChatModels.length} live models!`, 'success');
      setTimeout(clearModelStatus, 3500);
    } catch (err) {
      showModelStatus(`Sync error: ${err.message}`, 'error');
      setTimeout(clearModelStatus, 4500);
    } finally {
      refreshModelsBtn.classList.remove('loading');
      if (refreshModelsText) refreshModelsText.textContent = 'Sync Models';
    }
  }

  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', syncGroqModels);
  }

  // ─── Toggle API Key Visibility ────────────────────────────
  toggleKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyBtn.title = isPassword ? 'Hide' : 'Show';
  });

  // ─── Tone Selection ──────────────────────────────────────
  toneGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.tone-btn');
    if (!btn) return;

    setActiveTone(btn.dataset.tone);
  });

  function setActiveTone(tone) {
    toneGrid.querySelectorAll('.tone-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tone === tone);
    });
  }

  function getActiveTone() {
    const activeBtn = toneGrid.querySelector('.tone-btn.active');
    return activeBtn ? activeBtn.dataset.tone : 'friendly';
  }

  // ─── Slider Updates ───────────────────────────────────────
  temperatureSlider.addEventListener('input', () => {
    tempValueLabel.textContent = temperatureSlider.value;
  });

  maxTokensSlider.addEventListener('input', () => {
    tokensValueLabel.textContent = maxTokensSlider.value;
    if (tokensCharsLabel) {
      tokensCharsLabel.textContent = `~${Math.round(maxTokensSlider.value * 3)} chars`;
    }
  });

  // ─── Status Badge ─────────────────────────────────────────
  function updateStatusBadge(apiKey) {
    const text = statusBadge.querySelector('.status-text');

    if (apiKey && apiKey.trim()) {
      statusBadge.classList.add('active');
      text.textContent = 'Active';
    } else {
      statusBadge.classList.remove('active');
      text.textContent = 'Inactive';
    }
  }

  // ─── Save Settings ────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      tone: getActiveTone(),
      language: languageSelect.value,
      customPrompt: customPromptInput.value.trim(),
      temperature: parseFloat(temperatureSlider.value),
      maxTokens: parseInt(maxTokensSlider.value)
    };

    // Validate API key
    if (!settings.apiKey) {
      apiKeyInput.style.borderColor = 'rgba(239, 68, 68, 0.6)';
      apiKeyInput.focus();
      setTimeout(() => {
        apiKeyInput.style.borderColor = '';
      }, 2000);
      return;
    }

    // Save to Chrome storage (local + sync)
    saveSettingsToStorage(settings, () => {
      // Visual feedback
      const originalText = saveBtn.innerHTML;
      saveBtn.classList.add('saved');
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        Saved!
      `;

      updateStatusBadge(settings.apiKey);
      showModelStatus(`Active: ${modelSelect.value}`, 'success');

      setTimeout(() => {
        saveBtn.classList.remove('saved');
        saveBtn.innerHTML = originalText;
        clearModelStatus();
      }, 2000);
    });
  });

  // ─── API Key real-time status update ──────────────────────
  apiKeyInput.addEventListener('input', () => {
    updateStatusBadge(apiKeyInput.value);
  });
});
