/**
 * X-Commentator AI - Content Script
 * 
 * FLOW: User clicks X's native reply/comment button (💬)
 *       → Extension reads tweet, generates AI comment via Groq
 *       → Copies comment to clipboard
 *       → Shows comment in bottom toast notification
 *       → Auto-pastes into reply box (or user presses Ctrl+V)
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

  // ─── Toast Notification (shows at bottom) ──────────────────
  function showToast(message, type, duration) {
    try {
      type = type || 'info';
      duration = duration || 4000;
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
      }, duration);
    } catch (e) {
      console.error('[X-Commentator] Toast error:', e);
    }
  }

  // ─── Comment Toast (shows the actual comment at bottom) ────
  function showCommentToast(comment) {
    try {
      document.querySelectorAll('.' + TOAST_CLASS).forEach(function (t) { t.remove(); });
      document.querySelectorAll('.xcai-comment-toast').forEach(function (t) { t.remove(); });

      var toast = document.createElement('div');
      toast.className = 'xcai-comment-toast';

      var header = document.createElement('div');
      header.className = 'xcai-ct-header';
      header.textContent = '✅ AI Comment Generated — Copied!';

      var body = document.createElement('div');
      body.className = 'xcai-ct-body';
      body.textContent = comment;

      var footer = document.createElement('div');
      footer.className = 'xcai-ct-footer';
      footer.textContent = 'Press Ctrl+V in reply box to paste';

      var closeBtn = document.createElement('button');
      closeBtn.className = 'xcai-ct-close';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', function () { toast.remove(); });

      toast.appendChild(closeBtn);
      toast.appendChild(header);
      toast.appendChild(body);
      toast.appendChild(footer);
      document.body.appendChild(toast);

      requestAnimationFrame(function () {
        toast.classList.add('xcai-comment-toast-visible');
      });

      // Auto-hide after 15 seconds
      setTimeout(function () {
        toast.classList.remove('xcai-comment-toast-visible');
        setTimeout(function () { toast.remove(); }, 300);
      }, 15000);
    } catch (e) {
      console.error('[X-Commentator] Comment toast error:', e);
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

  // ─── Find the reply textbox ────────────────────────────────
  function findReplyTextbox() {
    var allBoxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
    var visibleBoxes = [];

    for (var i = 0; i < allBoxes.length; i++) {
      var rect = allBoxes[i].getBoundingClientRect();
      if (rect.height > 0 && rect.width > 0) {
        visibleBoxes.push(allBoxes[i]);
      }
    }

    if (visibleBoxes.length === 0) return null;
    return visibleBoxes[visibleBoxes.length - 1];
  }

  // ─── Paste into reply box via keyboard simulation ──────────
  function pasteIntoReplyBox() {
    try {
      var replyBox = findReplyTextbox();
      if (!replyBox) return;

      // Focus the reply box
      replyBox.focus();

      // Try to simulate Ctrl+V paste
      var pasteEvent = new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      });
      replyBox.dispatchEvent(pasteEvent);
    } catch (e) {
      // Auto-paste may not work, user will Ctrl+V manually
      console.log('[X-Commentator] Auto-paste not available, user will paste manually.');
    }
  }

  // ─── Generate AI Comment ───────────────────────────────────
  function generateAndType(tweetText) {
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    currentGenerationId++;
    var myGenId = currentGenerationId;

    console.log('[X-Commentator] Generating comment (gen #' + myGenId + ')...');
    showToast('✨ Generating AI comment...', 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      }, function (response) {
        if (myGenId !== currentGenerationId) return;

        if (chrome.runtime.lastError) {
          console.error('[X-Commentator] Runtime error:', chrome.runtime.lastError);
          showToast('Extension error. Reload the page.', 'error');
          return;
        }

        if (response && response.success) {
          var comment = response.comment;
          console.log('[X-Commentator] Comment generated:', comment.substring(0, 60) + '...');

          // Step 1: Copy comment to clipboard
          navigator.clipboard.writeText(comment).then(function () {
            // Step 2: Show comment in bottom toast
            showCommentToast(comment);

            // Step 3: Try auto-paste (may not work due to browser security)
            setTimeout(function () {
              pasteIntoReplyBox();
            }, 300);

          }).catch(function () {
            // Clipboard failed, just show in toast
            showCommentToast(comment);
          });

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
          var tweetArticle = btn.closest('article[data-testid="tweet"]') || btn.closest('article');
          if (!tweetArticle) return;

          var tweetText = extractTweetText(tweetArticle);
          if (!tweetText) return;

          console.log('[X-Commentator] Reply clicked. Tweet:', tweetText.substring(0, 60) + '...');

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

      observer.observe(document.body, { childList: true, subtree: true });
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
