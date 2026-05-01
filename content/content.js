/**
 * X-Commentator AI - Content Script
 * 
 * FLOW: User clicks X's native reply/comment button (💬) on any tweet
 *       → X opens its reply box
 *       → Extension detects it, reads the tweet, generates AI comment
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

  // ─── Prevent double generation ─────────────────────────────
  var isGenerating = false;

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

  // ─── Find the reply textbox inside X's reply dialog ────────
  function findReplyTextbox() {
    // Strategy 1: Find textbox inside the reply dialog/modal
    var dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      var box = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
      if (box) return box;
      // Try the draft editor
      box = dialog.querySelector('[data-testid="tweetTextarea_0"] div[contenteditable="true"]');
      if (box) return box;
      box = dialog.querySelector('[contenteditable="true"]');
      if (box) return box;
    }

    // Strategy 2: Find the inline reply textbox (when replying inline, no dialog)
    var replySection = document.querySelector('[data-testid="inline_reply_offscreen"]');
    if (replySection) {
      var box = replySection.querySelector('div[role="textbox"][contenteditable="true"]');
      if (box) return box;
    }

    // Strategy 3: Find any visible reply textbox on the page
    var allBoxes = document.querySelectorAll('div[role="textbox"][contenteditable="true"]');
    for (var i = 0; i < allBoxes.length; i++) {
      var rect = allBoxes[i].getBoundingClientRect();
      // Only pick visible ones (has height and is in viewport)
      if (rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
        return allBoxes[i];
      }
    }

    return null;
  }

  // ─── Type text into reply box (SAFE - single target) ───────
  function typeIntoReplyBox(text) {
    try {
      var replyBox = findReplyTextbox();

      if (!replyBox) {
        console.log('[X-Commentator] Reply textbox not found yet...');
        return false;
      }

      // Ensure we're clicking INTO the textbox to give it proper focus
      replyBox.click();

      // Small delay to let X's React handle the click
      setTimeout(function () {
        // Focus the textbox
        replyBox.focus();

        // Move cursor to end / select all existing content
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(replyBox);
        range.collapse(false); // collapse to end
        sel.addRange(range);

        // Insert text using execCommand (works with React/contenteditable)
        document.execCommand('insertText', false, text);

        console.log('[X-Commentator] ✅ Comment typed into reply box!');
        showToast('✅ AI comment ready! Click Reply to post.', 'success');
      }, 100);

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

    if (isGenerating) {
      console.log('[X-Commentator] Already generating, skipping...');
      return;
    }

    isGenerating = true;

    console.log('[X-Commentator] Generating comment for:', tweetText.substring(0, 80) + '...');
    showToast('✨ Generating AI comment...', 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText
      }, function (response) {
        isGenerating = false;

        if (chrome.runtime.lastError) {
          console.error('[X-Commentator] Runtime error:', chrome.runtime.lastError);
          showToast('Extension error. Reload the page.', 'error');
          return;
        }

        if (response && response.success) {
          var comment = response.comment;
          console.log('[X-Commentator] Comment generated:', comment);

          // Try to type with a few retries (reply box may need time to render)
          var typed = false;
          var attempt = 0;
          var maxAttempts = 8;

          var tryType = function () {
            if (typed || attempt >= maxAttempts) {
              if (!typed) {
                // All retries failed — copy to clipboard as fallback
                navigator.clipboard.writeText(comment).then(function () {
                  showToast('📋 Comment copied! Paste with Ctrl+V.', 'info');
                });
              }
              return;
            }
            attempt++;
            var success = typeIntoReplyBox(comment);
            if (success) {
              typed = true;
            } else {
              setTimeout(tryType, 400);
            }
          };

          tryType();

        } else {
          var errMsg = (response && response.error) ? response.error : 'Failed to generate.';
          showToast('❌ ' + errMsg, 'error');
        }
      });
    } catch (e) {
      isGenerating = false;
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

          // Extract the tweet text NOW (before the dialog opens)
          var tweetText = extractTweetText(tweetArticle);
          if (!tweetText) return;

          lastClickedTweetText = tweetText;
          console.log('[X-Commentator] Reply clicked. Tweet:', tweetText.substring(0, 60) + '...');

          // Wait for X's reply box to appear, then generate
          setTimeout(function () {
            generateAndType(lastClickedTweetText);
          }, 1000);

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

    try {
      chrome.runtime.sendMessage({ action: 'getSettings' }, function (response) {
        if (chrome.runtime.lastError) return;
        if (response && response.success && !response.settings.apiKey) {
          showToast('⚙️ X-Commentator: Set your Groq API key in extension settings.', 'info');
        }
      });
    } catch (e) { /* skip */ }

    hookReplyButtons();
    setTimeout(hookReplyButtons, 2000);
    setTimeout(hookReplyButtons, 4000);

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
