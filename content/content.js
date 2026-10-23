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

  // ─── Extract poster's display name or handle ────────────────
  function extractPosterName(tweetArticle) {
    try {
      // 1. Try User-Name block in the tweet article
      var userNameBlock = tweetArticle ? tweetArticle.querySelector('[data-testid="User-Name"]') : null;
      if (!userNameBlock) {
        // Fallback: check active modal dialog
        var dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
          userNameBlock = dialog.querySelector('[data-testid="User-Name"]');
        }
      }

      if (userNameBlock) {
        // Find display name inside the first link
        var nameLink = userNameBlock.querySelector('a span');
        var fullName = nameLink ? nameLink.textContent.trim() : '';

        // Find @handle
        var allSpans = userNameBlock.querySelectorAll('span');
        var handle = '';
        for (var i = 0; i < allSpans.length; i++) {
          var t = allSpans[i].textContent.trim();
          if (t.startsWith('@') && t.length > 1) {
            handle = t;
            break;
          }
        }

        // Clean name of emojis, badges, and extra whitespace
        var cleanName = fullName.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();

        if (cleanName && cleanName.length > 1) {
          // Keep up to 2 words if reasonable (e.g. "Bitcoin AlphaX"), otherwise 1st word
          var words = cleanName.split(/\s+/).filter(Boolean);
          if (words.length <= 2 && cleanName.length <= 25) {
            return cleanName;
          }
          return words[0];
        }

        if (handle) {
          return handle;
        }
      }

      // Check dialog "Replying to @..." text
      var dialogReplyTo = document.querySelector('[role="dialog"]');
      if (dialogReplyTo) {
        var replyLabels = dialogReplyTo.querySelectorAll('div, span');
        for (var k = 0; k < replyLabels.length; k++) {
          var labelText = replyLabels[k].textContent.trim();
          var match = labelText.match(/Replying to\s+(@\w+)/i);
          if (match && match[1]) {
            return match[1];
          }
        }
      }

      return null;
    } catch (e) {
      console.error('[X-Commentator] Error extracting poster name:', e);
      return null;
    }
  }

  // ─── Extract Tweet Text & Media Context (Images, Videos, Links) ──
  function extractTweetContent(tweetArticle) {
    try {
      var tweetText = '';
      var mediaContext = [];

      // 1. Text extraction (including emoji alts)
      var tweetTextEl = tweetArticle.querySelector('[data-testid="tweetText"]');
      if (!tweetTextEl) {
        tweetTextEl = tweetArticle.querySelector('div[lang]');
      }
      if (tweetTextEl) {
        var walker = document.createTreeWalker(
          tweetTextEl,
          NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
          null,
          false
        );
        var node;
        while (node = walker.nextNode()) {
          if (node.nodeType === Node.TEXT_NODE) {
            tweetText += node.textContent;
          } else if (node.tagName === 'IMG' && node.alt) {
            tweetText += node.alt;
          }
        }
        tweetText = tweetText.trim();
      }

      // 2. Photos / Images extraction (reads user descriptions & alt text)
      var photoEls = tweetArticle.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="card.layoutLarge.media"] img');
      if (photoEls.length > 0) {
        var photoAlts = [];
        photoEls.forEach(function (img) {
          var alt = (img.getAttribute('alt') || '').trim();
          if (alt && alt.toLowerCase() !== 'image' && alt.toLowerCase() !== 'embedded image') {
            photoAlts.push('"' + alt + '"');
          }
        });

        if (photoAlts.length > 0) {
          mediaContext.push(`[Attached Photo: ${photoAlts.join(', ')}]`);
        } else {
          mediaContext.push(`[Attached: ${photoEls.length} Photo/Image in post]`);
        }
      }

      // 3. Videos / GIFs extraction
      var videoEl = tweetArticle.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
      if (videoEl) {
        var ariaLabel = videoEl.getAttribute('aria-label') || '';
        if (ariaLabel && !ariaLabel.toLowerCase().includes('video player')) {
          mediaContext.push(`[Attached Video/Clip: "${ariaLabel}"]`);
        } else {
          mediaContext.push('[Attached: Video/Clip in post]');
        }
      }

      // 4. Link / Card Previews (News headlines, Article summaries)
      var cardWrapper = tweetArticle.querySelector('[data-testid="card.wrapper"]');
      if (cardWrapper) {
        var cardDetail = cardWrapper.querySelector('[data-testid="card.layoutLarge.detail"], [data-testid="card.layoutSmall.detail"]');
        var cardTitle = cardDetail ? cardDetail.innerText.replace(/\n+/g, ' — ').trim() : '';
        if (cardTitle) {
          mediaContext.push(`[Linked News/Article Card: "${cardTitle}"]`);
        }
      }

      // 5. Quote Tweet context
      var quoteTweet = tweetArticle.querySelector('[data-testid="quoteTweet"]');
      if (quoteTweet) {
        var quoteText = quoteTweet.innerText.replace(/\n+/g, ' ').substring(0, 150).trim();
        if (quoteText) {
          mediaContext.push(`[Quoting: "${quoteText}"]`);
        }
      }

      // Combine text and media context
      var fullPostContent = tweetText;
      if (mediaContext.length > 0) {
        var mediaStr = mediaContext.join('\n');
        if (fullPostContent) {
          fullPostContent += '\n' + mediaStr;
        } else {
          fullPostContent = mediaStr;
        }
      }

      return fullPostContent.trim();
    } catch (e) {
      console.error('[X-Commentator] Error extracting tweet content:', e);
      return '';
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

  // ─── Auto-paste into reply box via ClipboardEvent ───────────
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

      setTimeout(function () {
        replyBox.focus();

        // Place cursor at end
        var sel = window.getSelection();
        sel.removeAllRanges();
        var range = document.createRange();
        range.selectNodeContents(replyBox);
        range.collapse(false);
        sel.addRange(range);

        // Use synthetic ClipboardEvent paste (X's editor handles paste natively = single insert)
        try {
          var clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', text);

          var pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: clipboardData
          });

          var handled = replyBox.dispatchEvent(pasteEvent);
          console.log('[X-Commentator] Paste event dispatched, handled:', handled);
        } catch (pasteErr) {
          console.log('[X-Commentator] ClipboardEvent paste failed:', pasteErr.message);
          // Fallback: try InputEvent
          try {
            var inputEvent = new InputEvent('beforeinput', {
              inputType: 'insertFromPaste',
              data: text,
              bubbles: true,
              cancelable: true,
              composed: true
            });
            replyBox.dispatchEvent(inputEvent);
            console.log('[X-Commentator] InputEvent fallback dispatched.');
          } catch (inputErr) {
            console.log('[X-Commentator] All auto-paste methods failed. Use Ctrl+V.');
          }
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

    // Read stored model directly so user always gets the latest selected model
    chrome.storage.local.get({ model: 'llama-3.1-8b-instant' }, function (localData) {
      chrome.storage.sync.get({ model: 'llama-3.1-8b-instant' }, function (syncData) {
        var activeModel = localData.model || syncData.model || 'llama-3.1-8b-instant';
        
        console.log('[X-Commentator] Generating (gen #' + myGenId + ') with ' + activeModel + ' for @' + (posterName || 'unknown') + '...');
        showToast('✨ Generating comment (' + activeModel + ')...', 'info', 3000);

        try {
          chrome.runtime.sendMessage({
            action: 'generateComment',
            tweetText: tweetText,
            posterName: posterName || '',
            model: activeModel
          }, function (response) {
            if (myGenId !== currentGenerationId) return;

            if (chrome.runtime.lastError) {
              showToast('Extension reloaded. Please refresh the page.', 'error');
              return;
            }

            if (response && response.success) {
              var comment = response.comment;
              var modelUsed = response.modelUsed || activeModel;
              console.log('[X-Commentator] Comment generated using ' + modelUsed + ':', comment);

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
              showToast('❌ ' + errMsg, 'error', 6000);
            }
          });
        } catch (e) {
          showToast('Extension error. Please reload the extension at chrome://extensions', 'error');
        }
      });
    });
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

          // Step 2: Small delay for expansion, then extract text, media & author
          setTimeout(function () {
            var postContent = extractTweetContent(tweetArticle);
            var posterName = extractPosterName(tweetArticle) || extractPosterName(null);

            if (!postContent) {
              console.log('[X-Commentator] No tweet content or media detected.');
              return;
            }

            console.log('[X-Commentator] Tweet by ' + (posterName || 'Unknown') + ': ' + postContent.substring(0, 60) + '...');

            // Step 3: Wait for reply box to appear, then generate
            setTimeout(function () {
              if (!posterName) {
                posterName = extractPosterName(null) || extractPosterName(tweetArticle);
              }
              generateAndType(postContent, posterName);
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
