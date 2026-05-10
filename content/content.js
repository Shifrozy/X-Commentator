/**
 * X-Commentator AI - Content Script
 * 
 * FLOW: User clicks X's native reply/comment button (💬)
 *       → Extension clicks "Show more" to expand full post
 *       → Reads full tweet text + poster's name
 *       → Generates AI comment mentioning poster's first name
 *       → Shows comment in bottom toast card
 *       → Auto-pastes into reply textbox
 */

(function () {
  'use strict';

  console.log('[X-Commentator] Content script starting...');

  const TOAST_CLASS = 'xcai-toast';
  const SCAN_INTERVAL_MS = 1500;
  const PROCESSED_REPLY_ATTR = 'data-xcai-reply-hooked';
  var currentGenerationId = 0;

  // ─── Toast Notification ────────────────────────────────────
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
    } catch (e) {}
  }

  // ─── Comment Toast Card (bottom) ───────────────────────────
  function showCommentToast(comment) {
    try {
      document.querySelectorAll('.' + TOAST_CLASS).forEach(function (t) { t.remove(); });
      document.querySelectorAll('.xcai-comment-toast').forEach(function (t) { t.remove(); });

      var toast = document.createElement('div');
      toast.className = 'xcai-comment-toast';

      var header = document.createElement('div');
      header.className = 'xcai-ct-header';
      header.textContent = '✅ AI Comment Generated & Pasted!';

      var body = document.createElement('div');
      body.className = 'xcai-ct-body';
      body.textContent = comment;

      var footer = document.createElement('div');
      footer.className = 'xcai-ct-footer';
      footer.textContent = 'Comment auto-pasted into reply box. Click Reply to post!';

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

      setTimeout(function () {
        toast.classList.remove('xcai-comment-toast-visible');
        setTimeout(function () { toast.remove(); }, 300);
      }, 12000);
    } catch (e) {}
  }

  // ─── Click "Show more" to expand full post ─────────────────
  function expandFullPost(tweetArticle) {
    try {
      // Find "Show more" link/button inside the tweet
      var showMoreLinks = tweetArticle.querySelectorAll('[data-testid="tweet-text-show-more-link"], span');
      showMoreLinks.forEach(function (el) {
        if (el.textContent.trim().toLowerCase() === 'show more') {
          el.click();
          console.log('[X-Commentator] Clicked "Show more" to expand post.');
        }
      });
    } catch (e) {}
  }

  // ─── Extract poster's display name (first name) ────────────
  function extractPosterName(tweetArticle) {
    try {
      // The display name is usually in a span inside a link at the top of the tweet
      // Try data-testid="User-Name" first
      var userNameBlock = tweetArticle.querySelector('[data-testid="User-Name"]');
      if (userNameBlock) {
        // Get the first link text (display name, not @handle)
        var nameLink = userNameBlock.querySelector('a span');
        if (nameLink) {
          var fullName = nameLink.textContent.trim();
          // Get first name only (before space)
          var firstName = fullName.split(' ')[0];
          // Remove any emojis or special chars from the start
          firstName = firstName.replace(/[^\w\s]/g, '').trim();
          if (firstName.length > 0) {
            return firstName;
          }
          return fullName.split(' ')[0];
        }
      }

      // Fallback: look for the display name in the article header
      var allLinks = tweetArticle.querySelectorAll('a[role="link"]');
      for (var i = 0; i < allLinks.length; i++) {
        var href = allLinks[i].getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/status/')) {
          var spans = allLinks[i].querySelectorAll('span');
          for (var j = 0; j < spans.length; j++) {
            var text = spans[j].textContent.trim();
            if (text && !text.startsWith('@') && text.length > 1 && text.length < 50) {
              return text.split(' ')[0].replace(/[^\w\s]/g, '').trim() || text.split(' ')[0];
            }
          }
        }
      }

      return null;
    } catch (e) {
      console.error('[X-Commentator] Error extracting name:', e);
      return null;
    }
  }

  // ─── Extract Full Tweet Text ───────────────────────────────
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
      return null;
    }
  }

  // ─── Find Reply Textbox (inside dialog or inline) ──────────
  function findReplyTextbox() {
    // Priority 1: Inside dialog modal
    var dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      var box = dialog.querySelector('div[role="textbox"][contenteditable="true"]');
      if (box) return box;
      box = dialog.querySelector('[contenteditable="true"]');
      if (box) return box;
    }

    // Priority 2: Last visible textbox on page
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

  // ─── Auto-paste into reply box ─────────────────────────────
  function autoPasteIntoReplyBox(text) {
    try {
      var replyBox = findReplyTextbox();
      if (!replyBox) {
        console.log('[X-Commentator] Reply box not found for auto-paste.');
        return;
      }

      // Blur ALL other contenteditable elements first
      var allEditable = document.querySelectorAll('[contenteditable="true"]');
      allEditable.forEach(function (el) {
        if (el !== replyBox) {
          try { el.blur(); } catch (e) {}
        }
      });

      // Focus ONLY the reply box
      replyBox.focus();
      replyBox.click();

      // Small delay for focus to settle
      setTimeout(function () {
        replyBox.focus();

        // Place cursor at end
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(replyBox);
        range.collapse(false);
        sel.addRange(range);

        // Try insertText
        var result = document.execCommand('insertText', false, text);

        if (result) {
          console.log('[X-Commentator] ✅ Auto-pasted into reply box!');
        } else {
          console.log('[X-Commentator] execCommand returned false, text may not have pasted.');
        }
      }, 200);

    } catch (e) {
      console.error('[X-Commentator] Auto-paste error:', e);
    }
  }

  // ─── Generate AI Comment ───────────────────────────────────
  function generateAndType(tweetText, posterName) {
    if (!tweetText) {
      showToast('Could not read tweet text.', 'error');
      return;
    }

    currentGenerationId++;
    var myGenId = currentGenerationId;

    console.log('[X-Commentator] Generating (gen #' + myGenId + ') for @' + (posterName || 'unknown') + '...');
    showToast('✨ Generating AI comment...', 'info');

    try {
      chrome.runtime.sendMessage({
        action: 'generateComment',
        tweetText: tweetText,
        posterName: posterName || ''
      }, function (response) {
        if (myGenId !== currentGenerationId) return;

        if (chrome.runtime.lastError) {
          showToast('Extension error. Reload the page.', 'error');
          return;
        }

        if (response && response.success) {
          var comment = response.comment;
          console.log('[X-Commentator] Comment:', comment);

          // Step 1: Copy to clipboard
          navigator.clipboard.writeText(comment).then(function () {
            // Step 2: Show in bottom toast card
            showCommentToast(comment);

            // Step 3: Auto-paste into reply box
            setTimeout(function () {
              autoPasteIntoReplyBox(comment);
            }, 400);
          }).catch(function () {
            showCommentToast(comment);
          });

        } else {
          var errMsg = (response && response.error) ? response.error : 'Failed to generate.';
          showToast('❌ ' + errMsg, 'error');
        }
      });
    } catch (e) {
      showToast('Extension error.', 'error');
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

          // Step 1: Click "Show more" to expand full post
          expandFullPost(tweetArticle);

          // Step 2: Small delay for expansion, then extract
          setTimeout(function () {
            var tweetText = extractTweetText(tweetArticle);
            var posterName = extractPosterName(tweetArticle);
            if (!tweetText) return;

            console.log('[X-Commentator] Tweet by ' + (posterName || '?') + ': ' + tweetText.substring(0, 60) + '...');

            // Step 3: Wait for reply box to appear, then generate
            setTimeout(function () {
              generateAndType(tweetText, posterName);
            }, 800);
          }, 500);

        }, false);
      });
    } catch (e) {}
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
    } catch (e) {}
  }

  // ─── Fallback Scanner ─────────────────────────────────────
  function setupFallbackScan() {
    setInterval(function () {
      try { hookReplyButtons(); } catch (e) {}
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
    } catch (e) {}

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
