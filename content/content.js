/**
 * X-Commentator AI - Content Script
 * Injects AI comment buttons into X.com tweets and handles comment generation.
 */

(function () {
  'use strict';

  // ─── Constants ─────────────────────────────────────────────
  const BUTTON_CLASS = 'xcai-comment-btn';
  const LOADING_CLASS = 'xcai-loading';
  const TOAST_CLASS = 'xcai-toast';
  const PROCESSED_ATTR = 'data-xcai-processed';
  const OBSERVER_DEBOUNCE = 500;

  // ─── SVG Icons ─────────────────────────────────────────────
  const SPARKLE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
  </svg>`;

  const LOADING_ICON = `<svg class="xcai-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
    <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
  </svg>`;

  const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>`;

  const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>`;

  // ─── Toast Notification ────────────────────────────────────
  function showToast(message, type = 'info') {
    // Remove existing toasts
    document.querySelectorAll(`.${TOAST_CLASS}`).forEach(t => t.remove());

    const toast = document.createElement('div');
    toast.className = `${TOAST_CLASS} xcai-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('xcai-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('xcai-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ─── Extract Tweet Text ────────────────────────────────────
  function extractTweetText(tweetElement) {
    // Find the tweet text container
    const tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
    if (!tweetTextEl) return null;

    // Get all text content, including emoji alt text
    let text = '';
    tweetTextEl.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.tagName === 'IMG') {
        text += node.alt || '';
      } else if (node.tagName === 'SPAN' || node.tagName === 'A') {
        text += node.textContent;
      } else {
        text += node.textContent || '';
      }
    });

    return text.trim();
  }

  // ─── Find Tweet Article ────────────────────────────────────
  function findTweetArticle(element) {
    return element.closest('article[data-testid="tweet"]');
  }

  // ─── Create AI Comment Button ──────────────────────────────
  function createCommentButton() {
    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.innerHTML = SPARKLE_ICON;
    btn.title = 'Generate AI Comment';
    btn.setAttribute('aria-label', 'Generate AI Comment with X-Commentator');

    btn.addEventListener('click', handleCommentClick);
    return btn;
  }

  // ─── Create Comment Preview Card ───────────────────────────
  function createPreviewCard(comment, tweetArticle) {
    // Remove existing preview cards in this tweet
    tweetArticle.querySelectorAll('.xcai-preview-card').forEach(c => c.remove());

    const card = document.createElement('div');
    card.className = 'xcai-preview-card';

    const header = document.createElement('div');
    header.className = 'xcai-preview-header';
    header.innerHTML = `${SPARKLE_ICON} <span>AI Generated Comment</span>`;

    const body = document.createElement('div');
    body.className = 'xcai-preview-body';
    body.textContent = comment;

    const actions = document.createElement('div');
    actions.className = 'xcai-preview-actions';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'xcai-action-btn xcai-copy-btn';
    copyBtn.innerHTML = `${COPY_ICON} Copy`;
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(comment).then(() => {
        copyBtn.innerHTML = `✓ Copied`;
        showToast('Comment copied to clipboard!', 'success');
        setTimeout(() => { copyBtn.innerHTML = `${COPY_ICON} Copy`; }, 2000);
      });
    });

    // Regenerate button
    const regenBtn = document.createElement('button');
    regenBtn.className = 'xcai-action-btn xcai-regen-btn';
    regenBtn.innerHTML = `${REFRESH_ICON} Regenerate`;
    regenBtn.addEventListener('click', () => {
      card.remove();
      const btn = tweetArticle.querySelector(`.${BUTTON_CLASS}`);
      if (btn) btn.click();
    });

    // Post reply button
    const postBtn = document.createElement('button');
    postBtn.className = 'xcai-action-btn xcai-post-btn';
    postBtn.innerHTML = `↵ Reply`;
    postBtn.addEventListener('click', () => {
      insertReply(comment, tweetArticle);
      card.remove();
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'xcai-action-btn xcai-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', () => card.remove());

    actions.append(copyBtn, regenBtn, postBtn, closeBtn);
    card.append(header, body, actions);

    return card;
  }

  // ─── Insert Reply into Twitter ─────────────────────────────
  function insertReply(comment, tweetArticle) {
    // First try to click the reply button on the tweet
    const replyBtn = tweetArticle.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      replyBtn.click();

      // Wait for the reply modal/box to open
      setTimeout(() => {
        // Try to find the reply text box
        const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                         document.querySelector('[role="textbox"][data-testid="tweetTextarea_0"]') ||
                         document.querySelector('.DraftEditor-root [role="textbox"]') ||
                         document.querySelector('[contenteditable="true"][role="textbox"]');

        if (replyBox) {
          // Focus the element
          replyBox.focus();

          // Use execCommand for contenteditable elements
          document.execCommand('insertText', false, comment);

          showToast('Comment inserted! Click the Reply button to post.', 'success');
        } else {
          // Fallback: copy to clipboard
          navigator.clipboard.writeText(comment).then(() => {
            showToast('Reply box not found. Comment copied to clipboard — paste it!', 'info');
          });
        }
      }, 800);
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(comment).then(() => {
        showToast('Comment copied to clipboard. Paste into reply!', 'info');
      });
    }
  }

  // ─── Handle Comment Button Click ───────────────────────────
  async function handleCommentClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const btn = event.currentTarget;
    const tweetArticle = findTweetArticle(btn);
    if (!tweetArticle) return;

    const tweetText = extractTweetText(tweetArticle);
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    // Set loading state
    btn.classList.add(LOADING_CLASS);
    btn.innerHTML = LOADING_ICON;
    btn.disabled = true;

    try {
      // Send message to background script
      const response = await chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      });

      if (response.success) {
        const card = createPreviewCard(response.comment, tweetArticle);
        // Insert the card after the tweet actions bar
        const actionsBar = tweetArticle.querySelector('[role="group"]');
        if (actionsBar) {
          actionsBar.parentNode.insertBefore(card, actionsBar.nextSibling);
        } else {
          tweetArticle.appendChild(card);
        }
        showToast('AI comment generated!', 'success');
      } else {
        showToast(response.error || 'Failed to generate comment.', 'error');
      }
    } catch (error) {
      showToast('Error: ' + error.message, 'error');
    } finally {
      // Reset button
      btn.classList.remove(LOADING_CLASS);
      btn.innerHTML = SPARKLE_ICON;
      btn.disabled = false;
    }
  }

  // ─── Inject Buttons into Tweets ────────────────────────────
  function injectButtons() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');

    tweets.forEach(tweet => {
      if (tweet.hasAttribute(PROCESSED_ATTR)) return;
      tweet.setAttribute(PROCESSED_ATTR, 'true');

      // Find the action bar (reply, retweet, like, share buttons)
      const actionGroup = tweet.querySelector('[role="group"]');
      if (!actionGroup) return;

      // Create and inject our button
      const btn = createCommentButton();
      
      // Create a wrapper similar to Twitter's action buttons
      const wrapper = document.createElement('div');
      wrapper.className = 'xcai-btn-wrapper';
      wrapper.appendChild(btn);

      actionGroup.appendChild(wrapper);
    });
  }

  // ─── Mutation Observer (for infinite scroll) ───────────────
  let debounceTimer = null;

  function setupObserver() {
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(injectButtons, OBSERVER_DEBOUNCE);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    // Check if API key is set
    chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
      if (response?.success && !response.settings.apiKey) {
        showToast('X-Commentator: Please set your Groq API key in extension settings.', 'info');
      }
    });

    // Initial injection
    injectButtons();

    // Watch for new tweets (infinite scroll, navigation)
    setupObserver();

    console.log('✨ X-Commentator AI loaded successfully!');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
