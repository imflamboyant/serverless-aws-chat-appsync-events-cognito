/* message-list.js — ChatUI.createMessage() and ChatUI.messageList().
 *
 * Classic script (no ES modules). Depends at runtime on ChatUI utilities from
 * chat-ui.js (createAvatar, renderText, formatTime, formatDay, _toMs, _sameDay).
 */
var ChatUI = (window.ChatUI = window.ChatUI || {});

(function (ChatUI) {
  'use strict';

  var FIVE_MIN = 5 * 60 * 1000;
  var AT_BOTTOM_PX = 24;

  /**
   * Build a message `<article>` per design §3. User-supplied fields (author
   * name, body) are set via textContent / renderText only — never innerHTML.
   *
   * @param {{id:string,userId:string,name:string,avatarUrl?:string,text:string,timestamp:(number|string|Date)}} msg - Message data.
   * @param {{currentUserId?:string,users?:Array,continued?:boolean}} [opts] - Render options.
   * @returns {HTMLElement} The `<article class="chat-message">` element.
   */
  function createMessage(msg, opts) {
    msg = msg || {};
    opts = opts || {};
    var ms = ChatUI._toMs(msg.timestamp);
    var iso = isNaN(ms) ? '' : new Date(ms).toISOString();

    var article = document.createElement('article');
    article.className = 'chat-message';
    if (opts.currentUserId != null && msg.userId === opts.currentUserId) {
      article.className += ' chat-message--own';
    }
    if (opts.continued) {
      article.className += ' chat-message--continued';
    }
    if (msg.id != null) article.setAttribute('data-message-id', msg.id);
    if (msg.userId != null) article.setAttribute('data-user-id', msg.userId);

    var avatar = ChatUI.createAvatar(
      { userId: msg.userId, name: msg.name, avatarUrl: msg.avatarUrl },
      'md'
    );
    article.appendChild(avatar);

    var content = document.createElement('div');
    content.className = 'chat-message__content';

    var meta = document.createElement('header');
    meta.className = 'chat-message__meta';

    var author = document.createElement('span');
    author.className = 'chat-message__author';
    author.textContent = msg.name == null ? '' : String(msg.name);
    meta.appendChild(author);

    var time = document.createElement('time');
    time.className = 'chat-message__time';
    if (iso) {
      time.setAttribute('datetime', iso);
      time.setAttribute('title', ChatUI.formatDay(ms) + ' ' + ChatUI.formatTime(ms));
      time.textContent = ChatUI.formatTime(ms);
    }
    meta.appendChild(time);

    content.appendChild(meta);

    var body = document.createElement('div');
    body.className = 'chat-message__body';
    body.appendChild(
      ChatUI.renderText(msg.text, {
        users: opts.users,
        currentUserId: opts.currentUserId
      })
    );
    content.appendChild(body);

    article.appendChild(content);
    return article;
  }

  /**
   * Attach append-only message-list behavior to a `.chat-message-list` element.
   * Idempotent per element.
   *
   * @param {HTMLElement} el - The message-list element.
   * @param {{currentUserId?:string,users?:Array}} [options] - Render context.
   * @returns {object} Controller with append/clear/scrollToLatest/setUsers/setCurrentUser/destroy.
   */
  function messageList(el, options) {
    return ChatUI._controller('messageList', el, function (el) {
      options = options || {};
      var currentUserId = options.currentUserId;
      var users = options.users || [];

      if (!el.getAttribute('role')) el.setAttribute('role', 'log');
      if (!el.getAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

      // Grouping state: timestamp (ms) and userId of the last rendered message.
      var lastMs = null;
      var lastUserId = null;

      // Jump-to-latest button, inserted after the list inside .chat-layout__main.
      var jumpBtn = createJumpButton();
      var main = el.closest('.chat-layout__main');
      if (main) {
        main.appendChild(jumpBtn);
      } else if (el.parentNode) {
        el.parentNode.insertBefore(jumpBtn, el.nextSibling);
      }

      function createJumpButton() {
        var existing =
          (el.closest('.chat-layout__main') || el.parentNode || document).querySelector(
            '.chat-jump-latest'
          );
        var btn = existing || document.createElement('button');
        btn.className = 'chat-jump-latest';
        btn.type = 'button';
        btn.textContent = 'New messages \u2193';
        btn.hidden = true;
        return btn;
      }

      function distanceFromBottom() {
        return el.scrollHeight - el.scrollTop - el.clientHeight;
      }

      function isAtBottom() {
        return distanceFromBottom() <= AT_BOTTOM_PX;
      }

      function showJump() {
        jumpBtn.hidden = false;
      }
      function hideJump() {
        jumpBtn.hidden = true;
      }

      function scrollToLatest() {
        var behavior = ChatUI._prefersReducedMotion() ? 'auto' : 'smooth';
        try {
          el.scrollTo({ top: el.scrollHeight, behavior: behavior });
        } catch (err) {
          el.scrollTop = el.scrollHeight;
        }
        hideJump();
      }

      function appendDivider(ms) {
        var divider = document.createElement('div');
        divider.className = 'chat-date-divider';
        divider.setAttribute('role', 'separator');
        var label = document.createElement('span');
        label.className = 'chat-date-divider__label';
        label.textContent = ChatUI.formatDay(ms);
        divider.appendChild(label);
        el.appendChild(divider);
      }

      function appendOne(msg) {
        var ms = ChatUI._toMs(msg.timestamp);
        var dividerInserted = false;

        if (lastMs == null || !ChatUI._sameDay(ms, lastMs)) {
          appendDivider(ms);
          dividerInserted = true;
        }

        var continued =
          !dividerInserted &&
          lastUserId != null &&
          msg.userId === lastUserId &&
          lastMs != null &&
          ChatUI._sameDay(ms, lastMs) &&
          ms - lastMs < FIVE_MIN;

        var article = createMessage(msg, {
          currentUserId: currentUserId,
          users: users,
          continued: continued
        });
        el.appendChild(article);

        lastMs = ms;
        lastUserId = msg.userId;
      }

      /**
       * Append one message or an array, in chronological order. Scroll policy is
       * evaluated once using the pre-append position.
       * @param {object|object[]} msgOrArray
       */
      function append(msgOrArray) {
        var list = Array.isArray(msgOrArray) ? msgOrArray : [msgOrArray];
        if (list.length === 0) return;

        var wasAtBottom = isAtBottom();
        var anyOwn = false;
        for (var i = 0; i < list.length; i++) {
          if (currentUserId != null && list[i] && list[i].userId === currentUserId) {
            anyOwn = true;
          }
        }

        for (var j = 0; j < list.length; j++) {
          appendOne(list[j]);
        }

        if (wasAtBottom || anyOwn) {
          scrollToLatest();
        } else {
          showJump();
        }
      }

      function clear() {
        while (el.firstChild) el.removeChild(el.firstChild);
        lastMs = null;
        lastUserId = null;
        hideJump();
      }

      function onScroll() {
        if (isAtBottom()) hideJump();
      }
      function onJumpClick() {
        scrollToLatest();
      }

      el.addEventListener('scroll', onScroll, { passive: true });
      jumpBtn.addEventListener('click', onJumpClick);

      return {
        element: el,
        append: append,
        clear: clear,
        scrollToLatest: scrollToLatest,
        setUsers: function (next) {
          users = next || [];
        },
        setCurrentUser: function (id) {
          currentUserId = id;
        },
        destroy: function () {
          el.removeEventListener('scroll', onScroll, { passive: true });
          jumpBtn.removeEventListener('click', onJumpClick);
          if (jumpBtn.parentNode) jumpBtn.parentNode.removeChild(jumpBtn);
          ChatUI._forget('messageList', el);
        }
      };
    });
  }

  ChatUI.createMessage = createMessage;
  ChatUI.messageList = messageList;
})(ChatUI);
