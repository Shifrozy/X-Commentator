/**
 * X-Commentator AI - Content Script
 * 
 * FLOW: User clicks X's native reply/comment button (💬) on any tweet
 *       → X opens its reply box
 *       → Extension detects it, reads the tweet, generates AI comment
 *       → Auto-types the comment into X's reply textbox
 *       → User just clicks "Reply" to post
 */

(function () {
  'use strict';

  console.log('[X-Commentator] Content script starting...');

  // ─── Constants ─────────────────────────────────────────────
  const TOAST_CLASS = 'xcai-toast';
  const SCAN_INTERVAL_MS = 1500;
  const PROCESSED_REPLY_ATTR = 'data-xcai-reply-hooked';

  // ─── Toast Notification ────────────────────────────────────
  function showToast(message, type) {
    try {
      type = type || 'info';
      document.querySelectorAll('.' + TOAST_CLASS).forEach(function (t) { t.remove(); });

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
      }, 3500);
    } catch (e) {
      console.error('[X-Commentator] Toast error:', e);
    }
  }

  // ─── Extract Tweet Text from article ───────────────────────
  function extractTweetText(tweetArticle) {
    try {
      var tweetTextEl = tweetArticle.querySelector('[data-testid="tweetText"]');
      if (!tweetTextEl) {
        tweetTextEl = tweetArticle.querySelector('div[lang]');
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

  // ─── Extract tweet text from reply dialog ──────────────────
  function extractTweetTextFromReplyDialog() {
    try {
      // In X's reply dialog, the original tweet is shown above the reply box
      // Look for tweet text inside the dialog/modal
      var dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        var tweetTextEl = dialog.querySelector('[data-testid="tweetText"]');
        if (tweetTextEl) {
          return tweetTextEl.textContent.trim();
        }
      }

      // Fallback: if we're on a tweet detail page, find the main tweet
      var mainTweet = document.querySelector('article[data-testid="tweet"]');
      if (mainTweet) {
        return extractTweetText(mainTweet);
      }

      return null;
    } catch (e) {
      console.error('[X-Commentator] Error extracting from dialog:', e);
      return null;
    }
  }

  // ─── Type text into reply box ──────────────────────────────
  function typeIntoReplyBox(text) {
    try {
      // Find the reply textbox — try multiple selectors
      var replyBox = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                     document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                     document.querySelector('[contenteditable="true"][data-testid]') ||
                     document.querySelector('.public-DraftEditor-content[contenteditable="true"]');

      if (!replyBox) {
        console.log('[X-Commentator] Reply box not found yet, retrying...');
        return false;
      }

      // Focus the reply box
      replyBox.focus();

      // Clear any existing content first
      // Use Selection API to select all, then replace
      var selection = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(replyBox);
      selection.removeAllRanges();
      selection.addRange(range);

      // Use insertText to type naturally (triggers React's change detection)
      document.execCommand('insertText', false, text);

      console.log('[X-Commentator] Comment typed into reply box!');
      return true;
    } catch (e) {
      console.error('[X-Commentator] Error typing into reply box:', e);
      return false;
    }
  }

  // ─── Generate AI Comment and Type It ───────────────────────
  function generateAndType(tweetText) {
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    console.log('[X-Commentator] Generating comment for:', tweetText.substring(0, 80) + '...');
    showToast('✨ Generating AI comment...', 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      }, function (response) {
        if (chrome.runtime.lastError) {
          console.error('[X-Commentator] Runtime error:', chrome.runtime.lastError);
          showToast('Extension error. Reload the page.', 'error');
          return;
        }

        if (response && response.success) {
          var comment = response.comment;
          console.log('[X-Commentator] Comment generated:', comment);

          // Try to type into reply box with retries (reply box may take time to appear)
          var attempts = 0;
          var maxAttempts = 10;
          var retryInterval = setInterval(function () {
            attempts++;
            var success = typeIntoReplyBox(comment);
            if (success) {
              clearInterval(retryInterval);
              showToast('✅ AI comment ready! Click Reply to post.', 'success');
            } else if (attempts >= maxAttempts) {
              clearInterval(retryInterval);
              // Fallback: copy to clipboard
              navigator.clipboard.writeText(comment).then(function () {
                showToast('📋 Comment copied! Paste into reply box.', 'info');
              });
            }
          }, 300);
        } else {
          var errMsg = (response && response.error) ? response.error : 'Failed to generate.';
          showToast('❌ ' + errMsg, 'error');
        }
      });
    } catch (e) {
      console.error('[X-Commentator] Error:', e);
      showToast('Extension error: ' + e.message, 'error');
    }
  }

  // ─── Store the tweet text when reply button is clicked ─────
  var lastClickedTweetText = null;

  // ─── Hook into X's reply buttons ──────────────────────────
  function hookReplyButtons() {
    try {
      var replyButtons = document.querySelectorAll('[data-testid="reply"]');

      replyButtons.forEach(function (btn) {
        if (btn.hasAttribute(PROCESSED_REPLY_ATTR)) return;
        btn.setAttribute(PROCESSED_REPLY_ATTR, 'true');

        btn.addEventListener('click', function (e) {
          // Find the parent tweet article
          var tweetArticle = btn.closest('article[data-testid="tweet"]') || btn.closest('article');
          if (!tweetArticle) return;

          // Extract the tweet text NOW (before the dialog opens and DOM changes)
          var tweetText = extractTweetText(tweetArticle);
          if (!tweetText) return;

          lastClickedTweetText = tweetText;
          console.log('[X-Commentator] Reply button clicked. Tweet:', tweetText.substring(0, 60) + '...');

          // Wait for reply box to appear, then generate and type
          setTimeout(function () {
            generateAndType(lastClickedTweetText);
          }, 800);

        }, false); // Use bubble phase so X's handler runs first (opens the reply box)
      });
    } catch (e) {
      console.error('[X-Commentator] Error hooking reply buttons:', e);
    }
  }

  // ─── Mutation Observer ─────────────────────────────────────
  function setupObserver() {
    try {
      var debounceTimer = null;
      var observer = new MutationObserver(function () {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(hookReplyButtons, 600);
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

  // ─── Fallback Scanner ─────────────────────────────────────
  function setupFallbackScan() {
    setInterval(function () {
      try { hookReplyButtons(); } catch (e) { /* silent */ }
    }, SCAN_INTERVAL_MS);
  }

  // ─── Initialize ────────────────────────────────────────────
  function init() {
    console.log('[X-Commentator] Initializing on:', window.location.href);

    // Check API key
    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (response) {
        if (chrome.runtime.lastError) return;
        if (response && response.success && !response.settings.apiKey) {
          showToast('⚙️ X-Commentator: Set your Groq API key in extension settings.', 'info');
        }
      });
    } catch (e) { /* skip */ }

    // Hook reply buttons
    hookReplyButtons();
    setTimeout(hookReplyButtons, 2000);
    setTimeout(hookReplyButtons, 4000);

    // Watch for new tweets / SPA navigation
    setupObserver();
    setupFallbackScan();

    console.log('[X-Commentator] ✨ Ready! Click any reply button to auto-generate AI comments.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
