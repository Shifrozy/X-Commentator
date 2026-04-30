/**
 * X-Commentator AI - Background Service Worker
 * Handles Groq API calls for generating AI comments.
 */

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'llama-3.3-70b-versatile',
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
      resolve(result);
    });
  });
}

/**
 * Build the system prompt based on user settings
 */
function buildSystemPrompt(settings) {
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
9. Output ONLY the comment text — no quotes, no labels, no explanation.`;

  if (settings.customPrompt) {
    prompt += `\n10. Additional instructions: ${settings.customPrompt}`;
  }

  return prompt;
}

/**
 * Call Groq API to generate a comment
 */
async function generateComment(tweetText, settings) {
  if (!settings.apiKey) {
    throw new Error('API key not set. Please add your Groq API key in the extension settings.');
  }

  const systemPrompt = buildSystemPrompt(settings);

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate a comment for this tweet:\n\n"${tweetText}"` }
      ],
      max_tokens: settings.maxTokens,
      temperature: settings.temperature,
      top_p: 0.9,
      stream: false
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your Groq API key in settings.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit reached. Please wait a moment and try again.');
    }
    throw new Error(errorData.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  const comment = data.choices?.[0]?.message?.content?.trim();

  if (!comment) {
    throw new Error('No comment generated. Please try again.');
  }

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
        const comment = await generateComment(request.tweetText, settings);
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
