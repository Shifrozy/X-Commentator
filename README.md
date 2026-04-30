# X-Commentator AI 🤖✨

AI-powered Chrome extension that automatically reads X (Twitter) posts and generates contextual, human-like comments using Groq's LLaMA AI.

## Features

- 🎯 **Smart Comment Generation** — Reads tweet content and generates relevant, contextual comments
- ⚡ **Powered by Groq** — Ultra-fast inference using LLaMA 3.3 70B and other models
- 🎭 **6 Tone Options** — Friendly, Professional, Funny, Supportive, Savage, Intellectual
- 🌍 **Multi-Language** — English, Urdu (Roman), Hindi (Roman), Arabic
- 📋 **Preview & Edit** — See the generated comment before posting, with Copy/Regenerate/Reply options
- 🎨 **Premium Dark UI** — Beautiful glassmorphism popup with smooth animations
- ⚙️ **Customizable** — Custom prompts, creativity slider, max length control

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **"Developer mode"** (toggle in top-right corner)
4. Click **"Load unpacked"**
5. Select the `X-Commentator` folder
6. The extension icon will appear in your toolbar!

### Setup API Key

1. Go to [console.groq.com/keys](https://console.groq.com/keys)
2. Create a free account and generate an API key
3. Click the extension icon → Paste your API key → Save

## Usage

1. Go to [x.com](https://x.com) (Twitter)
2. You'll see a **✨ sparkle button** on every tweet (next to like/retweet buttons)
3. Click it → AI reads the tweet → Generates a comment
4. Choose from the preview card:
   - **Copy** — Copy comment to clipboard
   - **Regenerate** — Get a new comment
   - **Reply** — Auto-opens reply box and inserts the comment
   - **✕** — Dismiss

## Settings

| Setting | Description |
|---------|-------------|
| **API Key** | Your Groq API key (required) |
| **Model** | LLaMA 3.3 70B (best), LLaMA 3.1 8B (fastest), Mixtral, Gemma |
| **Tone** | Comment personality style |
| **Language** | Response language |
| **Custom Instructions** | Additional prompt guidance |
| **Creativity** | Temperature (0.1 = precise, 1.5 = creative) |
| **Max Length** | Maximum comment length in tokens |

## Tech Stack

- **Platform**: Chrome Extension (Manifest V3)
- **Language**: JavaScript (Vanilla)
- **AI**: Groq API (LLaMA 3.3 70B)
- **Styling**: Pure CSS with glassmorphism

## Project Structure

```
X-Commentator/
├── manifest.json              # Extension manifest (V3)
├── background/
│   └── service-worker.js      # Groq API calls & prompt building
├── content/
│   ├── content.js             # Tweet detection & UI injection
│   └── content.css            # Injected styles
├── popup/
│   ├── popup.html             # Settings page
│   ├── popup.css              # Premium dark theme
│   └── popup.js               # Settings management
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## License

MIT License