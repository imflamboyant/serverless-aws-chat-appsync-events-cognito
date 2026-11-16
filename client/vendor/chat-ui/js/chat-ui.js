/* chat-ui.js — ChatUI namespace, core utilities, renderText, layout(), channelList().
 *
 * Classic script (no ES modules). Load order does not matter: every file starts
 * with the namespace one-liner below, and cross-file calls happen at runtime.
 *
 * Public surface added here: escapeHtml, renderText, findMentions, initials,
 * hueFor, formatDay, formatTime, createAvatar, layout, channelList, plus the
 * internal controller-cache helper ChatUI._controller.
 */
var ChatUI = (window.ChatUI = window.ChatUI || {});

(function (ChatUI) {
  'use strict';

  /* --- Idempotent controller cache -------------------------------------- *
   * Each factory keeps a WeakMap(element -> controller). A second call on the
   * same element returns the existing controller and attaches no new listeners.
   * We namespace by factory key so, e.g., composer() and mentions() on the same
   * textarea do not collide. */
  var controllerCaches = Object.create(null);

  /**
   * Return the cached controller for an element under a factory key, or create
   * and cache a new one. Guarantees idempotency for the factory.
   *
   * @param {string} key - Factory identity (e.g. "layout").
   * @param {Element} el - The element the controller is bound to.
   * @param {function(Element): object} create - Builder invoked only on a miss.
   * @returns {object} The controller for `el`.
   */
  function getOrCreateController(key, el, create) {
    var cache = controllerCaches[key] || (controllerCaches[key] = new WeakMap());
    var existing = cache.get(el);
    if (existing) return existing;
    var controller = create(el);
    cache.set(el, controller);
    return controller;
  }

  /**
   * Forget a controller for an element so a later factory call rebuilds it.
   * Called from controller.destroy() implementations.
   *
   * @param {string} key - Factory identity.
   * @param {Element} el - The bound element.
   * @returns {void}
   */
  function forgetController(key, el) {
    var cache = controllerCaches[key];
    if (cache) cache.delete(el);
  }

  ChatUI._controller = getOrCreateController;
  ChatUI._forget = forgetController;

  /* --- String + value utilities ----------------------------------------- */

  var HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  /**
   * Escape the five HTML-significant characters (& < > " ') in a string.
   * Provided for hosts that build HTML strings; the library itself never uses
   * innerHTML with user data (see renderText).
   *
   * @param {string} str - Raw text.
   * @returns {string} HTML-escaped text.
   */
  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (ch) {
      return HTML_ESCAPES[ch];
    });
  }

  /**
   * Up to two uppercase initials derived from a display name.
   *
   * @param {string} name - Display name.
   * @returns {string} 0–2 uppercase letters.
   */
  function initials(name) {
    var parts = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  }

  /**
   * Deterministic hue in [0, 359] from an id, for avatar-initials color.
   *
   * @param {string} id - Stable identifier.
   * @returns {number} Integer hue 0–359.
   */
  function hueFor(id) {
    var str = String(id == null ? '' : id);
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // keep it a 32-bit int
    }
    return Math.abs(hash) % 360;
  }

  /**
   * Normalize a timestamp (epoch ms, ISO string, or Date) to epoch ms.
   *
   * @param {number|string|Date} ts - Timestamp in any supported form.
   * @returns {number} Epoch milliseconds (NaN if unparseable).
   */
  function toMs(ts) {
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string') {
      var n = Date.parse(ts);
      return n;
    }
    return NaN;
  }

  /** True when two timestamps fall on the same calendar day (local time). */
  function sameDay(aMs, bMs) {
    var a = new Date(aMs);
    var b = new Date(bMs);
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /**
   * Human day label: "Today", "Yesterday", or an Intl date (weekday + month +
   * day, plus year when it differs from `now`).
   *
   * @param {number|string|Date} ts - The message timestamp.
   * @param {number|string|Date} [now] - Reference "now" (defaults to Date.now()).
   * @returns {string} Day label.
   */
  function formatDay(ts, now) {
    var ms = toMs(ts);
    var nowMs = now == null ? Date.now() : toMs(now);
    if (isNaN(ms)) return '';
    if (sameDay(ms, nowMs)) return 'Today';
    var yesterday = nowMs - 24 * 60 * 60 * 1000;
    if (sameDay(ms, yesterday)) return 'Yesterday';
    var sameYear = new Date(ms).getFullYear() === new Date(nowMs).getFullYear();
    var opts = { weekday: 'long', month: 'long', day: 'numeric' };
    if (!sameYear) opts.year = 'numeric';
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(ms));
  }

  /**
   * Short clock time via Intl (hour + 2-digit minute).
   *
   * @param {number|string|Date} ts - The message timestamp.
   * @returns {string} Formatted time.
   */
  function formatTime(ts) {
    var ms = toMs(ts);
    if (isNaN(ms)) return '';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(ms));
  }

  /* --- Mentions in text ------------------------------------------------- *
   * The handle grammar is [a-z0-9_.-]+, but trailing punctuation is trimmed so
   * "@ben," mentions "ben" and leaves the comma. We match greedily then strip
   * trailing "." and "-" (keeping inner ones), matching renderText's rule. */
  var MENTION_RE = /(^|\s)@([a-z0-9_.-]+)/gi;

  /** Trim trailing "." and "-" so a handle ends at [a-z0-9_]. */
  function trimHandle(raw) {
    return raw.replace(/[.\-]+$/, '');
  }

  /**
   * Unique user ids mentioned in `text`. Shared by renderText and chat:send so
   * the two never disagree about who was mentioned.
   *
   * @param {string} text - Message text.
   * @param {Array<{id:string,handle:string}>} users - Known users.
   * @returns {string[]} Unique mentioned user ids, in first-seen order.
   */
  function findMentions(text, users) {
    var byHandle = handleIndex(users);
    var ids = [];
    var seen = Object.create(null);
    var str = String(text == null ? '' : text);
    MENTION_RE.lastIndex = 0;
    var m;
    while ((m = MENTION_RE.exec(str))) {
      var handle = trimHandle(m[2]).toLowerCase();
      var user = handle && byHandle[handle];
      if (user && !seen[user.id]) {
        seen[user.id] = true;
        ids.push(user.id);
      }
    }
    return ids;
  }

  /** Build a lowercase handle -> user lookup. */
  function handleIndex(users) {
    var index = Object.create(null);
    if (users) {
      for (var i = 0; i < users.length; i++) {
        var u = users[i];
        if (u && u.handle) index[String(u.handle).toLowerCase()] = u;
      }
    }
    return index;
  }

  /**
   * Render message text to a DocumentFragment of text nodes and
   * span.chat-mention elements only. Never uses innerHTML, so untrusted text
   * (e.g. "<img src=x onerror=alert(1)>") renders as literal text.
   *
   * @param {string} text - Raw message text.
   * @param {{users?:Array, currentUserId?:string}} [opts] - Known users and the
   *   current user id (mentions of whom get the --self modifier).
   * @returns {DocumentFragment} Fragment ready to append to the DOM.
   */
  function renderText(text, opts) {
    opts = opts || {};
    var byHandle = handleIndex(opts.users);
    var currentUserId = opts.currentUserId;
    var frag = document.createDocumentFragment();
    var str = String(text == null ? '' : text);
    var lastIndex = 0;
    MENTION_RE.lastIndex = 0;
    var m;
    while ((m = MENTION_RE.exec(str))) {
      var lead = m[1]; // "" or the whitespace before @
      var rawHandle = m[2];
      var handle = trimHandle(rawHandle);
      var user = handle ? byHandle[handle.toLowerCase()] : null;
      var atIndex = m.index + lead.length; // position of "@"
      var handleEnd = atIndex + 1 + handle.length; // end of the matched handle

      // Text before the "@" (including any leading whitespace captured).
      if (atIndex > lastIndex) {
        frag.appendChild(document.createTextNode(str.slice(lastIndex, atIndex)));
      }

      if (user) {
        var span = document.createElement('span');
        span.className = 'chat-mention';
        if (currentUserId != null && user.id === currentUserId) {
          span.className += ' chat-mention--self';
        }
        span.setAttribute('data-user-id', user.id);
        span.textContent = '@' + handle;
        frag.appendChild(span);
      } else {
        // Unknown handle stays plain text.
        frag.appendChild(document.createTextNode('@' + handle));
      }

      lastIndex = handleEnd;
      // Rewind the regex so trailing punctuation we trimmed can start the next
      // search (it is just plain text and will be emitted on the next slice).
      MENTION_RE.lastIndex = handleEnd;
    }
    if (lastIndex < str.length) {
      frag.appendChild(document.createTextNode(str.slice(lastIndex)));
    }
    return frag;
  }

  /* --- Avatar ----------------------------------------------------------- */

  var AVATAR_URL_RE = /^(https?:|data:image\/)/i;

  /**
   * Build an avatar element. If avatarUrl passes the allow-list
   * (http:/https:/data:image/) an <img> is used; otherwise initials on a
   * deterministic hue background.
   *
   * @param {{userId?:string,name?:string,avatarUrl?:string}} user - Source data.
   * @param {("sm"|"md"|"lg")} [size="md"] - Avatar size modifier.
   * @returns {HTMLSpanElement} The avatar element.
   */
  function createAvatar(user, size) {
    user = user || {};
    var span = document.createElement('span');
    span.className = 'chat-avatar chat-avatar--' + (size || 'md');
    var url = user.avatarUrl;
    if (url && AVATAR_URL_RE.test(String(url).trim())) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = ''; // author name is adjacent text
      span.appendChild(img);
    } else {
      span.setAttribute('aria-hidden', 'true');
      span.style.setProperty('--chat-avatar-hue', String(hueFor(user.userId)));
      span.textContent = initials(user.name);
    }
    return span;
  }

  /* --- matchMedia helpers ----------------------------------------------- */

  /** True when the viewport is narrow (sidebar is off-canvas). */
  function isNarrow() {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : false;
  }

  /** True when the user prefers reduced motion. */
  function prefersReducedMotion() {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  }

  ChatUI._isNarrow = isNarrow;
  ChatUI._prefersReducedMotion = prefersReducedMotion;

  /* --- layout() --------------------------------------------------------- */

  /**
   * Attach app-shell behavior to a `.chat-layout` element: sidebar toggles,
   * scrim click to close, and auto-close on channel select on narrow viewports.
   * Idempotent per element.
   *
   * @param {HTMLElement} el - The `.chat-layout` element.
   * @returns {{openSidebar:Function,closeSidebar:Function,toggleSidebar:Function,destroy:Function,element:HTMLElement}}
   */
  function layout(el) {
    return getOrCreateController('layout', el, function (el) {
      function setSidebar(state) {
        el.setAttribute('data-sidebar', state);
      }
      function openSidebar() { setSidebar('open'); }
      function closeSidebar() { setSidebar('closed'); }
      function toggleSidebar() {
        if (el.getAttribute('data-sidebar') === 'open') closeSidebar();
        else openSidebar();
      }

      function onClick(e) {
        if (e.target.closest && e.target.closest('[data-chat-sidebar-toggle]')) {
          toggleSidebar();
          return;
        }
        if (e.target.closest && e.target.closest('.chat-layout__scrim')) {
          closeSidebar();
        }
      }
      function onChannelSelect() {
        if (isNarrow()) closeSidebar();
      }

      el.addEventListener('click', onClick);
      el.addEventListener('chat:channel-select', onChannelSelect);

      return {
        element: el,
        openSidebar: openSidebar,
        closeSidebar: closeSidebar,
        toggleSidebar: toggleSidebar,
        destroy: function () {
          el.removeEventListener('click', onClick);
          el.removeEventListener('chat:channel-select', onChannelSelect);
          forgetController('layout', el);
        }
      };
    });
  }

  /* --- channelList() ---------------------------------------------------- */

  /**
   * Attach channel-list behavior to a `<nav>`: a delegated click handler
   * dispatches a bubbling `chat:channel-select` event. The library does not
   * decide the active channel (R4.3); setActive/setUnread are host conveniences.
   * Idempotent per element.
   *
   * @param {HTMLElement} el - The channel-list `<nav>`.
   * @returns {{setActive:Function,setUnread:Function,destroy:Function,element:HTMLElement}}
   */
  function channelList(el) {
    return getOrCreateController('channelList', el, function (el) {
      function onClick(e) {
        var item = e.target.closest
          ? e.target.closest('.chat-channel-item[data-channel-id]')
          : null;
        if (!item || !el.contains(item)) return;
        var id = item.getAttribute('data-channel-id');
        el.dispatchEvent(
          new CustomEvent('chat:channel-select', {
            bubbles: true,
            detail: { id: id, element: item }
          })
        );
      }

      el.addEventListener('click', onClick);

      function itemFor(id) {
        return el.querySelector(
          '.chat-channel-item[data-channel-id="' + cssEscape(id) + '"]'
        );
      }

      return {
        element: el,
        setActive: function (id) {
          var items = el.querySelectorAll('.chat-channel-item[data-channel-id]');
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.getAttribute('data-channel-id') === String(id)) {
              it.setAttribute('aria-current', 'true');
            } else {
              it.removeAttribute('aria-current');
            }
          }
        },
        setUnread: function (id, count) {
          var item = itemFor(id);
          if (!item) return;
          var n = Number(count) || 0;
          var badge = item.querySelector('.chat-badge');
          if (n > 0) {
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'chat-badge';
              item.appendChild(badge);
            }
            badge.textContent = n > 99 ? '99+' : String(n);
            item.classList.add('chat-channel-item--unread');
          } else {
            if (badge) badge.remove();
            item.classList.remove('chat-channel-item--unread');
          }
        },
        destroy: function () {
          el.removeEventListener('click', onClick);
          forgetController('channelList', el);
        }
      };
    });
  }

  /** Minimal CSS attribute-value escaper for selector building. */
  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* --- Public exports --------------------------------------------------- */
  ChatUI.escapeHtml = escapeHtml;
  ChatUI.initials = initials;
  ChatUI.hueFor = hueFor;
  ChatUI.formatDay = formatDay;
  ChatUI.formatTime = formatTime;
  ChatUI.findMentions = findMentions;
  ChatUI.renderText = renderText;
  ChatUI.createAvatar = createAvatar;
  ChatUI.layout = layout;
  ChatUI.channelList = channelList;
  ChatUI._toMs = toMs;
  ChatUI._sameDay = sameDay;
})(ChatUI);
