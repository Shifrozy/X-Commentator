/**
 * X-Commentator AI - Content Script
 * Injects AI comment buttons into X.com tweets and handles comment generation.
 * 
 * Uses multiple strategies to ensure buttons are injected:
 * 1. Initial scan on load
 * 2. MutationObserver for infinite scroll
 * 3. setInterval fallback as safety net
 */

(function () {
  'use strict';

  console.log('[X-Commentator] Content script starting...');

  // ─── Constants ─────────────────────────────────────────────
  const BUTTON_CLASS = 'xcai-comment-btn';
  const WRAPPER_CLASS = 'xcai-btn-wrapper';
  const LOADING_CLASS = 'xcai-loading';
  const TOAST_CLASS = 'xcai-toast';
  const PROCESSED_ATTR = 'data-xcai-processed';
  const SCAN_INTERVAL_MS = 2000; // Fallback scan every 2s
  const OBSERVER_DEBOUNCE_MS = 800;

  // ─── SVG Icons ─────────────────────────────────────────────
  const SPARKLE_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>`;

  const LOADING_ICON = `<svg class="xcai-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>`;

  const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

  const REFRESH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;

  // ─── Toast Notification ────────────────────────────────────
  function showToast(message, type) {
    try {
      type = type || 'info';
      var existing = document.querySelectorAll('.' + TOAST_CLASS);
      existing.forEach(function (t) { t.remove(); });

      var toast = document.createElement('div');
      toast.className = TOAST_CLASS + ' xcai-toast-' + type;
      toast.textContent = message;
      document.body.appendChild(toast);

      requestAnimationFrame(function () {
        toast.classList.add('xcai-toast-visible');
      });

      setTimeout(function () {
        toast.classList.remove('xcai-toast-visible');
        setTimeout(function () { toast.remove(); }, 300);
      }, 3000);
    } catch (e) {
      console.error('[X-Commentator] Toast error:', e);
    }
  }

  // ─── Extract Tweet Text ────────────────────────────────────
  function extractTweetText(tweetElement) {
    try {
      // Try data-testid="tweetText" first
      var tweetTextEl = tweetElement.querySelector('[data-testid="tweetText"]');
      if (!tweetTextEl) {
        // Fallback: look for any div with lang attribute containing text
        tweetTextEl = tweetElement.querySelector('div[lang]');
      }
      if (!tweetTextEl) return null;

      var text = '';
      var walker = document.createTreeWalker(
        tweetTextEl,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null,
        false
      );

      var node;
      while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.tagName === 'IMG' && node.alt) {
          text += node.alt;
        }
      }

      return text.trim();
    } catch (e) {
      console.error('[X-Commentator] Error extracting tweet text:', e);
      return null;
    }
  }

  // ─── Create AI Comment Button ──────────────────────────────
  function createCommentButton() {
    var wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS;
    wrapper.style.cssText = 'display:inline-flex;align-items:center;margin-left:2px;';

    var btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.innerHTML = SPARKLE_ICON;
    btn.title = 'Generate AI Comment';
    btn.setAttribute('aria-label', 'Generate AI Comment');
    btn.type = 'button';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      handleCommentClick(btn);
    }, true);

    wrapper.appendChild(btn);
    return wrapper;
  }

  // ─── Create Comment Preview Card ───────────────────────────
  function createPreviewCard(comment, tweetArticle) {
    // Remove existing preview cards in this tweet
    var existingCards = tweetArticle.querySelectorAll('.xcai-preview-card');
    existingCards.forEach(function (c) { c.remove(); });

    var card = document.createElement('div');
    card.className = 'xcai-preview-card';

    // Header
    var header = document.createElement('div');
    header.className = 'xcai-preview-header';
    header.innerHTML = SPARKLE_ICON + ' <span>AI Generated Comment</span>';

    // Body
    var body = document.createElement('div');
    body.className = 'xcai-preview-body';
    body.textContent = comment;

    // Actions
    var actions = document.createElement('div');
    actions.className = 'xcai-preview-actions';

    // Copy button
    var copyBtn = document.createElement('button');
    copyBtn.className = 'xcai-action-btn xcai-copy-btn';
    copyBtn.innerHTML = COPY_ICON + ' Copy';
    copyBtn.type = 'button';
    copyBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard.writeText(comment).then(function () {
        copyBtn.innerHTML = '✓ Copied';
        showToast('Comment copied to clipboard!', 'success');
        setTimeout(function () { copyBtn.innerHTML = COPY_ICON + ' Copy'; }, 2000);
      });
    }, true);

    // Regenerate button
    var regenBtn = document.createElement('button');
    regenBtn.className = 'xcai-action-btn xcai-regen-btn';
    regenBtn.innerHTML = REFRESH_ICON + ' Regenerate';
    regenBtn.type = 'button';
    regenBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      card.remove();
      var sparkleBtn = tweetArticle.querySelector('.' + BUTTON_CLASS);
      if (sparkleBtn) handleCommentClick(sparkleBtn);
    }, true);

    // Post reply button
    var postBtn = document.createElement('button');
    postBtn.className = 'xcai-action-btn xcai-post-btn';
    postBtn.innerHTML = '↵ Reply';
    postBtn.type = 'button';
    postBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      insertReply(comment, tweetArticle);
      card.remove();
    }, true);

    // Close button
    var closeBtn = document.createElement('button');
    closeBtn.className = 'xcai-action-btn xcai-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      card.remove();
    }, true);

    actions.appendChild(copyBtn);
    actions.appendChild(regenBtn);
    actions.appendChild(postBtn);
    actions.appendChild(closeBtn);

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(actions);

    return card;
  }

  // ─── Insert Reply into Twitter ─────────────────────────────
  function insertReply(comment, tweetArticle) {
    try {
      // Click the reply button on the tweet
      var replyBtn = tweetArticle.querySelector('[data-testid="reply"]');
      if (replyBtn) {
        replyBtn.click();

        // Wait for the reply modal/box to open
        setTimeout(function () {
          // Try multiple selectors for the reply textbox
          var replyBox = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                         document.querySelector('[data-testid="tweetTextarea_0RichTextInputContent"]') ||
                         document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                         document.querySelector('.DraftEditor-root [role="textbox"]');

          if (replyBox) {
            replyBox.focus();
            // Use execCommand for contenteditable
            document.execCommand('insertText', false, comment);
            showToast('Comment inserted! Click Reply to post.', 'success');
          } else {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(comment).then(function () {
              showToast('Comment copied! Paste into reply box.', 'info');
            });
          }
        }, 1000);
      } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(comment).then(function () {
          showToast('Comment copied to clipboard!', 'info');
        });
      }
    } catch (e) {
      console.error('[X-Commentator] Insert reply error:', e);
      navigator.clipboard.writeText(comment).then(function () {
        showToast('Comment copied to clipboard!', 'info');
      });
    }
  }

  // ─── Handle Comment Button Click ───────────────────────────
  function handleCommentClick(btn) {
    var tweetArticle = btn.closest('article[data-testid="tweet"]') || btn.closest('article');
    if (!tweetArticle) {
      showToast('Could not find tweet.', 'error');
      return;
    }

    var tweetText = extractTweetText(tweetArticle);
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    console.log('[X-Commentator] Generating comment for:', tweetText.substring(0, 80) + '...');

    // Set loading state
    btn.classList.add(LOADING_CLASS);
    btn.innerHTML = LOADING_ICON;
    btn.disabled = true;

    // Send message to background script
    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      }, function (response) {
        // Reset button
        btn.classList.remove(LOADING_CLASS);
        btn.innerHTML = SPARKLE_ICON;
        btn.disabled = false;

        if (chrome.runtime.lastError) {
          console.error('[X-Commentator] Runtime error:', chrome.runtime.lastError);
          showToast('Extension error. Try reloading the page.', 'error');
          return;
        }

        if (response && response.success) {
          var card = createPreviewCard(response.comment, tweetArticle);
          // Insert the card after the action bar
          var actionGroups = tweetArticle.querySelectorAll('[role="group"]');
          var lastGroup = actionGroups[actionGroups.length - 1];
          if (lastGroup && lastGroup.parentNode) {
            lastGroup.parentNode.insertBefore(card, lastGroup.nextSibling);
          } else {
            tweetArticle.appendChild(card);
          }
          showToast('AI comment generated!', 'success');
        } else {
          var errMsg = (response && response.error) ? response.error : 'Failed to generate comment.';
          showToast(errMsg, 'error');
        }
      });
    } catch (e) {
      console.error('[X-Commentator] Send message error:', e);
      btn.classList.remove(LOADING_CLASS);
      btn.innerHTML = SPARKLE_ICON;
      btn.disabled = false;
      showToast('Extension error: ' + e.message, 'error');
    }
  }

  // ─── Inject Buttons into Tweets ────────────────────────────
  function injectButtons() {
    try {
      var tweets = document.querySelectorAll('article[data-testid="tweet"]');

      if (tweets.length === 0) {
        // Fallback: try just article elements
        tweets = document.querySelectorAll('article');
      }

      var injectedCount = 0;

      tweets.forEach(function (tweet) {
        // Skip if already processed
        if (tweet.hasAttribute(PROCESSED_ATTR)) return;

        // Find all role="group" elements (action bars)
        var groups = tweet.querySelectorAll('[role="group"]');
        if (groups.length === 0) return;

        // Use the LAST group — that's the one with reply/retweet/like buttons
        var actionGroup = groups[groups.length - 1];

        // Double check: this group should contain the reply/like/retweet buttons
        // Skip if we already injected into this group
        if (actionGroup.querySelector('.' + WRAPPER_CLASS)) {
          tweet.setAttribute(PROCESSED_ATTR, 'true');
          return;
        }

        // Create and inject our button
        var btnWrapper = createCommentButton();
        actionGroup.appendChild(btnWrapper);

        tweet.setAttribute(PROCESSED_ATTR, 'true');
        injectedCount++;
      });

      if (injectedCount > 0) {
        console.log('[X-Commentator] Injected ' + injectedCount + ' button(s). Total tweets: ' + tweets.length);
      }
    } catch (e) {
      console.error('[X-Commentator] Error injecting buttons:', e);
    }
  }

  // ─── Mutation Observer (for infinite scroll & SPA nav) ─────
  function setupObserver() {
    try {
      var debounceTimer = null;

      var observer = new MutationObserver(function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(injectButtons, OBSERVER_DEBOUNCE_MS);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log('[X-Commentator] MutationObserver active.');
    } catch (e) {
      console.error('[X-Commentator] Observer error:', e);
    }
  }

  // ─── Fallback: Periodic Scan ───────────────────────────────
  function setupFallbackScan() {
    setInterval(function () {
      try {
        injectButtons();
      } catch (e) {
        // Silent fail for fallback
      }
    }, SCAN_INTERVAL_MS);
    console.log('[X-Commentator] Fallback scanner active (every ' + SCAN_INTERVAL_MS + 'ms).');
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    console.log('[X-Commentator] Initializing on: ' + window.location.href);

    // Check API key (non-blocking)
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (response) {
        if (chrome.runtime.lastError) {
          console.warn('[X-Commentator] Could not check settings:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.success && !response.settings.apiKey) {
          showToast('X-Commentator: Set your Groq API key in extension settings.', 'info');
        }
      });
    } catch (e) {
      console.warn('[X-Commentator] Settings check skipped:', e.message);
    }

    // Strategy 1: Immediate scan
    injectButtons();

    // Strategy 2: Delayed scan (wait for SPA to render)
    setTimeout(injectButtons, 1500);
    setTimeout(injectButtons, 3000);
    setTimeout(injectButtons, 5000);

    // Strategy 3: MutationObserver for dynamic content
    setupObserver();

    // Strategy 4: Periodic fallback scan
    setupFallbackScan();

    console.log('[X-Commentator] ✨ All systems active!');
  }

  // ─── Start ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
