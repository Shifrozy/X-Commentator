/**
 * X-Commentator AI - Background Service Worker
 * Handles Groq API calls for generating AI comments.
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

// llama-3.1-8b-instant is the fastest, reliable, free-tier workhorse for comments (~560 tokens/sec)
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  model: FALLBACK_MODEL,
  tone: 'friendly',
  language: 'english',
  customPrompt: '',
  maxTokens: 60, // ~180-220 characters, perfectly fits X limit
  temperature: 0.8
};

// In-memory cache to ensure instant updates without storage sync delays
let cachedSettings = null;

// Listen for storage changes in real-time
chrome.storage.onChanged.addListener((changes) => {
  if (!cachedSettings) cachedSettings = { ...DEFAULT_SETTINGS };
  for (const key in changes) {
    cachedSettings[key] = changes[key].newValue;
  }
  console.log('[X-Commentator SW] Settings updated via storage listener:', cachedSettings);
});

/**
 * Get stored settings from Chrome storage (checks local first, then sync)
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (localData) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (syncData) => {
        let result = { ...DEFAULT_SETTINGS, ...syncData, ...localData, ...(cachedSettings || {}) };

        // Auto-migrate if stored model is decommissioned
        if (result.model && DECOMMISSIONED_MODELS.includes(result.model.toLowerCase())) {
          console.warn(`[X-Commentator SW] Migrating stored decommissioned model "${result.model}" to "${FALLBACK_MODEL}".`);
          result.model = FALLBACK_MODEL;
          chrome.storage.local.set({ model: FALLBACK_MODEL });
          chrome.storage.sync.set({ model: FALLBACK_MODEL });
        }

        cachedSettings = result;
        resolve(result);
      });
    });
  });
}

/**
 * Build the system prompt based on user settings
 */
function buildSystemPrompt(settings, posterName) {
  const toneDescriptions = {
    friendly: 'warm, friendly, and approachable. Casual and genuinely interested.',
    professional: 'polished, sharp, and insightful. Value-adding perspective.',
    funny: 'witty, hilarious, and punchy. Clever humor and playful banter.',
    supportive: 'encouraging, hyped, and empathetic. High energy positivity.',
    savage: 'bold, edgy, playful roast with sharp wit. Never truly hateful.',
    intellectual: 'smart, analytical, and thoughtful perspective in few words.'
  };

  const toneGuide = toneDescriptions[settings.tone] || toneDescriptions.friendly;
  const lang = settings.language === 'urdu' ? 'Urdu (Roman/transliterated words like "bhai, kya baat hai")' :
               settings.language === 'hindi' ? 'Hindi (Roman/transliterated words like "kya baat hai yaar")' :
               settings.language === 'arabic' ? 'Arabic' :
               'English';

  const authorName = posterName ? posterName.trim() : '';
  const nameRule = authorName 
    ? `\n9. MANDATORY AUTHOR MENTION: You MUST mention and speak directly to "${authorName}" in your reply (e.g. "${authorName}, ...", "Hey ${authorName}, ...", or "...right ${authorName}?"). Mentioning their name is strictly required.`
    : '';

  let prompt = `You are a top-tier Twitter/X commenter. Your task is to generate ONE single, highly relevant, human-like reply for the post.

CRITICAL RULES:
1. Tone: ${toneGuide}
2. Language: Respond in ${lang}.
3. STRICT CHARACTER LIMIT (TWITTER 280 MAX):
   - Your reply MUST be short and punchy: between 80 to 180 characters (15 to 30 words max, 1-2 short sentences).
   - NEVER write long paragraphs or essays.
   - ABSOLUTELY NEVER exceed 250 characters!
4. Media Awareness: If the post includes attached photos, video clips, link previews, or image alt text, react contextually to what the media and post are about.
5. Sound Human: Sound like an active real person on X. NO robotic clichés, NO "Great post!", NO "Thanks for sharing!".
6. NO hashtags unless the post explicitly demands one.
7. Output ONLY the raw reply text — no quotes, no labels, no preamble.${nameRule}`;

  if (settings.customPrompt) {
    prompt += `\n10. Additional instructions: ${settings.customPrompt}`;
  }

  return prompt;
}

/**
 * Call Groq API to generate a comment
 */
async function generateComment(tweetText, settings, posterName) {
  if (!settings.apiKey) {
    throw new Error('API key not set. Please add your Groq API key in the extension settings.');
  }

  // Ensure model is valid and not decommissioned
  let model = settings.model || FALLBACK_MODEL;
  if (DECOMMISSIONED_MODELS.includes(model.toLowerCase())) {
    console.warn(`[X-Commentator SW] Model "${model}" is decommissioned. Migrating to ${FALLBACK_MODEL}.`);
    model = FALLBACK_MODEL;
    settings.model = FALLBACK_MODEL;
    chrome.storage.local.set({ model: FALLBACK_MODEL });
    chrome.storage.sync.set({ model: FALLBACK_MODEL });
  }

  const authorName = posterName ? posterName.trim() : '';
  const systemPrompt = buildSystemPrompt(settings, authorName);

  // Enforce a strict token ceiling (max ~75 tokens = ~240 chars)
  const maxTokensToUse = Math.min(settings.maxTokens || 60, 75);

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate a short reply (under 180 characters)${authorName ? ` addressing ${authorName}` : ''} for this post:\n\n${tweetText}` }
    ],
    max_completion_tokens: maxTokensToUse,
    temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.8,
    top_p: 0.9,
    stream: false
  };

  let response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || '';
    const errorCode = errorData.error?.code || '';

    // Check if error is due to decommissioned or non-existent model
    const isModelError = errorCode === 'model_decommissioned' ||
                         response.status === 404 ||
                         /model.*(not found|does not exist|decommissioned|unavailable)/i.test(errorMsg);

    // Auto-retry with FALLBACK_MODEL (llama-3.1-8b-instant) if original model failed
    if (isModelError && model !== FALLBACK_MODEL) {
      console.warn(`[X-Commentator SW] Model "${model}" not available (${errorMsg}). Retrying with ${FALLBACK_MODEL}...`);
      payload.model = FALLBACK_MODEL;
      settings.model = FALLBACK_MODEL;
      chrome.storage.local.set({ model: FALLBACK_MODEL });
      chrome.storage.sync.set({ model: FALLBACK_MODEL });

      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(payload)
      });
    }

    // Fallback: If max_completion_tokens is unsupported by an older endpoint, try max_tokens
    if (!response.ok && /max_completion_tokens/i.test(errorMsg)) {
      delete payload.max_completion_tokens;
      payload.max_tokens = maxTokensToUse;
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) {
      const finalErrData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your Groq API key in settings.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit reached. Please wait a moment and try again.');
      }
      throw new Error(finalErrData.error?.message || errorMsg || `Groq API error: ${response.status}`);
    }
  }

  const data = await response.json();
  let comment = data.choices?.[0]?.message?.content?.trim();

  if (!comment) {
    throw new Error('No comment generated. Please try again.');
  }

  // Strip reasoning thinking tags if present (e.g., DeepSeek R1 models)
  comment = comment.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Clean up: remove surrounding quotes if present
  comment = comment.replace(/^["']|["']$/g, '').trim();

  // Guarantee: If author name was provided and missing from response, prepend it naturally
  if (authorName && !comment.toLowerCase().includes(authorName.toLowerCase())) {
    comment = `${authorName}, ${comment.charAt(0).toLowerCase() + comment.slice(1)}`;
  }

  // Strict Hard Cutoff: Ensure comment NEVER exceeds Twitter limit (max 270 chars)
  if (comment.length > 270) {
    let trimmed = comment.substring(0, 265);
    const lastPunct = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf('!'), trimmed.lastIndexOf('?'));
    if (lastPunct > 80) {
      comment = trimmed.substring(0, lastPunct + 1);
    } else {
      const lastSpace = trimmed.lastIndexOf(' ');
      if (lastSpace > 80) {
        comment = trimmed.substring(0, lastSpace);
      } else {
        comment = trimmed;
      }
    }
  }

  return comment;
}

/**
 * Listen for messages from content script or popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateSettings') {
    cachedSettings = { ...DEFAULT_SETTINGS, ...request.settings };
    if (request.settings && request.settings.model) {
      chrome.storage.local.set({ model: request.settings.model });
      chrome.storage.sync.set({ model: request.settings.model });
    }
    console.log('[X-Commentator SW] Received updateSettings message:', cachedSettings);
    sendResponse({ success: true, settings: cachedSettings });
    return true;
  }

  if (request.action === 'generateComment') {
    (async () => {
      try {
        const settings = await getSettings();
        // If content script passed a requested model, prioritize it if not decommissioned
        if (request.model && !DECOMMISSIONED_MODELS.includes(request.model.toLowerCase())) {
          settings.model = request.model;
        }
        const comment = await generateComment(request.tweetText, settings, request.posterName || '');
        sendResponse({ success: true, comment, modelUsed: settings.model });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    // Return true to indicate async response
    return true;
  }

  if (request.action === 'getSettings') {
    getSettings().then((settings) => {
      sendResponse({ success: true, settings });
    });
    return true;
  }
});
