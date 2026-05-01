/**
 * X-Commentator AI - Content Script
 * 
 * FLOW: User clicks X's native reply/comment button (💬) on any tweet
 *       → X opens its reply box
 *       → Extension reads the tweet, generates AI comment via Groq
 *       → Auto-types the comment into X's reply textbox ONLY
 *       → User just clicks "Reply" to post
 */

(function () {
  'use strict';

  console.log('[X-Commentator] Content script starting...');

  // ─── Constants ─────────────────────────────────────────────
  const TOAST_CLASS = 'xcai-toast';
  const SCAN_INTERVAL_MS = 1500;
  const PROCESSED_REPLY_ATTR = 'data-xcai-reply-hooked';

  // ─── Guard against double execution ────────────────────────
  var currentGenerationId = 0;

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
      }, 4000);
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

  // ─── Find the REPLY textbox (NOT the compose box) ──────────
  function findReplyTextbox() {
    // Get ALL visible contenteditable textboxes on the page
    var allBoxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
    var visibleBoxes = [];

    for (var i = 0; i < allBoxes.length; i++) {
      var rect = allBoxes[i].getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
        visibleBoxes.push(allBoxes[i]);
      }
    }

    if (visibleBoxes.length === 0) return null;

    // The LAST visible textbox is the reply box
    // (compose box is at the top = first, reply box is below = last)
    var replyBox = visibleBoxes[visibleBoxes.length - 1];

    console.log('[X-Commentator] Found ' + visibleBoxes.length + ' textbox(es), using the last one (reply box).');
    return replyBox;
  }

  // ─── Type text into reply box (SINGLE execution) ───────────
  function typeIntoReplyBox(text, genId) {
    // Abort if a newer generation started
    if (genId !== currentGenerationId) {
      console.log('[X-Commentator] Stale generation, aborting type.');
      return 'abort';
    }

    try {
      var replyBox = findReplyTextbox();
      if (!replyBox) return 'retry';

      // Focus and click the reply box
      replyBox.focus();
      replyBox.click();

      // Place cursor at end (don't select all, just move to end)
      var sel = window.getSelection();
      sel.removeAllRanges();
      var range = document.createRange();
      range.selectNodeContents(replyBox);
      range.collapse(false); // collapse to end
      sel.addRange(range);

      // Insert text
      document.execCommand('insertText', false, text);

      console.log('[X-Commentator] ✅ Comment typed into reply box!');
      return 'success';
    } catch (e) {
      console.error('[X-Commentator] Error typing:', e);
      return 'retry';
    }
  }

  // ─── Generate AI Comment and Type It ───────────────────────
  function generateAndType(tweetText) {
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    // Increment generation ID to invalidate any previous pending generations
    currentGenerationId++;
    var myGenId = currentGenerationId;

    console.log('[X-Commentator] Generating comment (gen #' + myGenId + ')...');
    showToast('✨ Generating AI comment...', 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      }, function (response) {
        // Check if this generation is still the current one
        if (myGenId !== currentGenerationId) {
          console.log('[X-Commentator] Generation #' + myGenId + ' superseded, ignoring.');
          return;
        }

        if (chrome.runtime.lastError) {
          console.error('[X-Commentator] Runtime error:', chrome.runtime.lastError);
          showToast('Extension error. Reload the page.', 'error');
          return;
        }

        if (response && response.success) {
          var comment = response.comment;
          console.log('[X-Commentator] Comment generated:', comment.substring(0, 60) + '...');

          // Try to type with retries
          var attempt = 0;
          var maxAttempts = 8;

          function tryType() {
            if (myGenId !== currentGenerationId) return; // superseded
            if (attempt >= maxAttempts) {
              // Fallback: copy to clipboard
              navigator.clipboard.writeText(comment).then(function () {
                showToast('📋 Comment copied! Press Ctrl+V to paste.', 'info');
              });
              return;
            }

            attempt++;
            var result = typeIntoReplyBox(comment, myGenId);

            if (result === 'success') {
              showToast('✅ AI comment ready! Click Reply to post.', 'success');
            } else if (result === 'abort') {
              // Do nothing, superseded
            } else {
              // retry after delay
              setTimeout(tryType, 500);
            }
          }

          // Start typing after a brief delay for the reply box to fully render
          setTimeout(tryType, 300);

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

  // ─── Hook into X's reply buttons ──────────────────────────
  function hookReplyButtons() {
    try {
      var replyButtons = document.querySelectorAll('[data-testid="reply"]');

      replyButtons.forEach(function (btn) {
        if (btn.hasAttribute(PROCESSED_REPLY_ATTR)) return;
        btn.setAttribute(PROCESSED_REPLY_ATTR, 'true');

        btn.addEventListener('click', function () {
          // Find the parent tweet article
          var tweetArticle = btn.closest('article[data-testid="tweet"]') || btn.closest('article');
          if (!tweetArticle) return;

          // Extract the tweet text NOW (before dialog opens)
          var tweetText = extractTweetText(tweetArticle);
          if (!tweetText) return;

          console.log('[X-Commentator] Reply clicked. Tweet:', tweetText.substring(0, 60) + '...');

          // Wait for X's reply UI to appear, then generate
          setTimeout(function () {
            generateAndType(tweetText);
          }, 1200);

        }, false);
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

    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (response) {
        if (chrome.runtime.lastError) return;
        if (response && response.success && !response.settings.apiKey) {
          showToast('⚙️ Set your Groq API key in X-Commentator settings.', 'info');
        }
      });
    } catch (e) { /* skip */ }

    hookReplyButtons();
    setTimeout(hookReplyButtons, 2000);
    setTimeout(hookReplyButtons, 4000);

    setupObserver();
    setupFallbackScan();

    console.log('[X-Commentator] ✨ Ready!');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
