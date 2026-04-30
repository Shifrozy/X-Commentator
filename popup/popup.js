/**
 * X-Commentator AI — Popup Script
 * Handles settings management and UI interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM Elements ────────────────────────────────────────
  const apiKeyInput = document.getElementById('apiKey');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const modelSelect = document.getElementById('model');
  const toneGrid = document.getElementById('toneGrid');
  const languageSelect = document.getElementById('language');
  const customPromptInput = document.getElementById('customPrompt');
  const temperatureSlider = document.getElementById('temperature');
  const tempValueLabel = document.getElementById('tempValue');
  const maxTokensSlider = document.getElementById('maxTokens');
  const tokensValueLabel = document.getElementById('tokensValue');
  const saveBtn = document.getElementById('saveBtn');
  const statusBadge = document.getElementById('statusBadge');

  // ─── Load Saved Settings ─────────────────────────────────
  chrome.storage.sync.get({
    apiKey: '',
    model: 'llama-3.3-70b-versatile',
    tone: 'friendly',
    language: 'english',
    customPrompt: '',
    maxTokens: 280,
    temperature: 0.8
  }, (settings) => {
    apiKeyInput.value = settings.apiKey;
    modelSelect.value = settings.model;
    languageSelect.value = settings.language;
    customPromptInput.value = settings.customPrompt;
    temperatureSlider.value = settings.temperature;
    tempValueLabel.textContent = settings.temperature;
    maxTokensSlider.value = settings.maxTokens;
    tokensValueLabel.textContent = settings.maxTokens;

    // Set active tone
    setActiveTone(settings.tone);

    // Update status badge
    updateStatusBadge(settings.apiKey);
  });

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
  });

  // ─── Status Badge ─────────────────────────────────────────
  function updateStatusBadge(apiKey) {
    const dot = statusBadge.querySelector('.status-dot');
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

    // Save to Chrome storage
    chrome.storage.sync.set(settings, () => {
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

      setTimeout(() => {
        saveBtn.classList.remove('saved');
        saveBtn.innerHTML = originalText;
      }, 1500);
    });
  });

  // ─── API Key real-time status update ──────────────────────
  apiKeyInput.addEventListener('input', () => {
    updateStatusBadge(apiKeyInput.value);
  });
});
