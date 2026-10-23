/**
 * X-Commentator AI - Background Service Worker
 * Handles Groq API calls for generating AI comments.
 */

// Known decommissioned / retired models on Groq
const DECOMMISSIONED_MODELS = [
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'gemma-7b-it',
  'llama3-70b-8192',
  'llama3-8b-8192',
  'llama-3.1-70b-versatile',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-90b-vision-preview',
  'llama-3.2-11b-text-preview',
  'llama-3.2-90b-text-preview'
];

const FALLBACK_MODEL = 'llama-3.3-70b-versatile';

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  model: FALLBACK_MODEL,
  tone: 'friendly',
  language: 'english',
  customPrompt: '',
  maxTokens: 280,
  temperature: 0.8
};

/**
 * Get stored settings from Chrome storage
 */
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (result) => {
      // Auto-migrate if stored model is decommissioned
      if (result.model && DECOMMISSIONED_MODELS.includes(result.model.toLowerCase())) {
        console.warn(`[X-Commentator] Migrating stored decommissioned model "${result.model}" to "${FALLBACK_MODEL}".`);
        result.model = FALLBACK_MODEL;
        chrome.storage.sync.set({ model: FALLBACK_MODEL });
      }
      resolve(result);
    });
  });
}

/**
 * Build the system prompt based on user settings
 */
function buildSystemPrompt(settings, posterName) {
  const toneDescriptions = {
    friendly: 'warm, friendly, and approachable. Use casual language and show genuine interest.',
    professional: 'polished, professional, and insightful. Use proper grammar and add value to the conversation.',
    funny: 'witty, humorous, and entertaining. Use clever wordplay and light humor without being offensive.',
    supportive: 'encouraging, supportive, and empathetic. Validate the poster\'s efforts and offer positive reinforcement.',
    savage: 'bold, edgy, and sarcastic with sharp wit. Be playfully roasting but never cross into genuinely hurtful territory.',
    intellectual: 'thoughtful, analytical, and well-informed. Add depth to the discussion with references and nuanced perspectives.'
  };

  const toneGuide = toneDescriptions[settings.tone] || toneDescriptions.friendly;
  const lang = settings.language === 'urdu' ? 'Urdu (Roman/transliterated)' :
               settings.language === 'hindi' ? 'Hindi (Roman/transliterated)' :
               settings.language === 'arabic' ? 'Arabic' :
               'English';

  const nameRule = posterName 
    ? `\n10. IMPORTANT: Naturally mention the poster's first name "${posterName}" in your comment — like you're talking directly to them. Use it casually (e.g., "${posterName}, this is..." or "...right ${posterName}?" or "yo ${posterName}..."). Do NOT force it if it feels unnatural.`
    : '';

  let prompt = `You are an expert social media commenter for X (Twitter). Your job is to generate a single, highly relevant comment/reply for a given tweet/post.

RULES:
1. Your tone should be: ${toneGuide}
2. Respond in: ${lang}
3. Keep the comment concise — ideally under 280 characters (1-2 sentences max).
4. Make the comment feel NATURAL and HUMAN — never robotic or generic.
5. DO NOT use hashtags unless the original post has them.
6. DO NOT start with "Great post!" or similar generic openings.
7. Reference specific details from the tweet to show genuine engagement.
8. Match the energy of the original post.
9. Output ONLY the comment text — no quotes, no labels, no explanation.${nameRule}`;

  if (settings.customPrompt) {
    prompt += `\n11. Additional instructions: ${settings.customPrompt}`;
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
    console.warn(`[X-Commentator] Model "${model}" is decommissioned. Migrating to ${FALLBACK_MODEL}.`);
    model = FALLBACK_MODEL;
    chrome.storage.sync.set({ model: FALLBACK_MODEL });
  }

  const systemPrompt = buildSystemPrompt(settings, posterName);

  const payload = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate a comment for this tweet${posterName ? ` by ${posterName}` : ''}:\n\n"${tweetText}"` }
    ],
    max_completion_tokens: settings.maxTokens || 280,
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
                         /model.*(not found|does not exist|decommissioned|unavailable)/i.test(errorMsg);

    // Auto-retry with FALLBACK_MODEL if original model failed
    if (isModelError && model !== FALLBACK_MODEL) {
      console.warn(`[X-Commentator] Model "${model}" not available (${errorMsg}). Retrying with ${FALLBACK_MODEL}...`);
      payload.model = FALLBACK_MODEL;
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
      payload.max_tokens = settings.maxTokens || 280;
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
  return comment.replace(/^["']|["']$/g, '');
}

/**
 * Listen for messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateComment') {
    (async () => {
      try {
        const settings = await getSettings();
        const comment = await generateComment(request.tweetText, settings, request.posterName || '');
        sendResponse({ success: true, comment });
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
