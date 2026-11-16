/* mentions.js — ChatUI.mentions() combobox/listbox for @-mentions, plus the pure
 * helpers ChatUI.mentions.detect() and ChatUI.mentions.filter() (used by tests).
 *
 * Classic script (no ES modules). Depends at runtime on ChatUI.createAvatar.
 */
var ChatUI = (window.ChatUI = window.ChatUI || {});

(function (ChatUI) {
  'use strict';

  var HANDLE_CHARS = /[a-z0-9_.-]/i;

  /**
   * Detect an in-progress @-mention immediately before the caret. Scans backward
   * over [a-z0-9_.-] to an `@` that sits at index 0 or after whitespace. A
   * mid-word `@` (preceded by a word character) returns null.
   *
   * @param {string} value - The textarea value.
   * @param {number} caret - Caret position (selectionStart).
   * @returns {{start:number,query:string}|null} The `@` index and query text, or null.
   */
  function detect(value, caret) {
    value = String(value == null ? '' : value);
    if (typeof caret !== 'number' || caret < 0 || caret > value.length) {
      caret = value.length;
    }
    var i = caret - 1;
    // Walk back over handle characters.
    while (i >= 0 && HANDLE_CHARS.test(value.charAt(i))) {
      i--;
    }
    // i now points at the char before the run (or -1). The run must start at @.
    if (i < 0 || value.charAt(i) !== '@') return null;
    var atIndex = i;
    // @ must be at start or preceded by whitespace.
    if (atIndex > 0 && !/\s/.test(value.charAt(atIndex - 1))) return null;
    // Trim trailing "." and "-" so "@ben." queries "ben" (keeping inner ones),
    // mirroring renderText/findMentions' trimHandle rule. The returned `start`
    // is unchanged, so mention insertion still replaces the right range.
    var query = value.slice(atIndex + 1, caret).replace(/[.\-]+$/, '');
    return { start: atIndex, query: query };
  }

  /**
   * Rank users for a query: handle-prefix, then name-prefix, then substring
   * (handle or name). Case-insensitive, stable within each rank, capped.
   *
   * @param {Array<{id:string,name:string,handle:string}>} users - Candidates.
   * @param {string} query - The text after `@` (without the `@`).
   * @param {number} [limit=6] - Max results.
   * @returns {Array} Up to `limit` matching users.
   */
  function filter(users, query, limit) {
    if (limit == null) limit = 6;
    users = users || [];
    var q = String(query == null ? '' : query).toLowerCase();

    if (q === '') {
      return users.slice(0, limit);
    }

    var ranked = [];
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      if (!u) continue;
      var handle = String(u.handle || '').toLowerCase();
      var name = String(u.name || '').toLowerCase();
      var rank;
      if (handle.indexOf(q) === 0) {
        rank = 0;
      } else if (name.indexOf(q) === 0) {
        rank = 1;
      } else if (handle.indexOf(q) !== -1 || name.indexOf(q) !== -1) {
        rank = 2;
      } else {
        continue;
      }
      ranked.push({ user: u, rank: rank, order: i });
    }
    ranked.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.order - b.order; // stable within rank
    });
    var out = [];
    for (var j = 0; j < ranked.length && out.length < limit; j++) {
      out.push(ranked[j].user);
    }
    return out;
  }

  /**
   * Attach @-mention autocomplete to a textarea. Idempotent per element.
   *
   * @param {HTMLTextAreaElement} textarea - The composer input.
   * @param {{users?:Array,container?:HTMLElement}} [options] - Users and the
   *   element to anchor the popup in (defaults to the composer form).
   * @returns {object} Controller with setUsers/isOpen/close/destroy.
   */
  function mentions(textarea, options) {
    return ChatUI._controller('mentions', textarea, function (textarea) {
      options = options || {};
      var users = options.users || [];
      var container =
        options.container || textarea.closest('form.chat-composer') || textarea.parentNode;

      var popupId =
        'chat-mention-popup-' + Math.random().toString(36).slice(2, 8);
      var popup = document.createElement('ul');
      popup.className = 'chat-mention-popup';
      popup.id = popupId;
      popup.setAttribute('role', 'listbox');
      popup.hidden = true;
      if (container) container.appendChild(popup);

      var open = false;
      var matches = []; // current filtered users
      var activeIndex = -1;
      var detection = null; // last detect() result {start, query}
      var blurTimer = null;

      // ARIA combobox wiring on the textarea.
      textarea.setAttribute('role', 'combobox');
      textarea.setAttribute('aria-autocomplete', 'list');
      textarea.setAttribute('aria-expanded', 'false');
      textarea.setAttribute('aria-controls', popupId);

      function optionId(i) {
        return popupId + '-opt-' + i;
      }

      function renderOptions() {
        while (popup.firstChild) popup.removeChild(popup.firstChild);
        for (var i = 0; i < matches.length; i++) {
          var u = matches[i];
          var li = document.createElement('li');
          li.className = 'chat-mention-popup__item';
          li.id = optionId(i);
          li.setAttribute('role', 'option');
          li.setAttribute('data-index', String(i));
          li.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');

          li.appendChild(
            ChatUI.createAvatar(
              { userId: u.id, name: u.name, avatarUrl: u.avatarUrl },
              'sm'
            )
          );

          var name = document.createElement('span');
          name.className = 'chat-mention-popup__name';
          name.textContent = u.name == null ? '' : String(u.name);
          li.appendChild(name);

          var handle = document.createElement('span');
          handle.className = 'chat-mention-popup__handle';
          handle.textContent = '@' + (u.handle == null ? '' : String(u.handle));
          li.appendChild(handle);

          popup.appendChild(li);
        }
      }

      function updateActiveAria() {
        var items = popup.children;
        for (var i = 0; i < items.length; i++) {
          items[i].setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        }
        if (activeIndex >= 0 && items[activeIndex]) {
          textarea.setAttribute('aria-activedescendant', optionId(activeIndex));
        } else {
          textarea.removeAttribute('aria-activedescendant');
        }
      }

      function openPopup() {
        if (!open) {
          open = true;
          popup.hidden = false;
          textarea.setAttribute('aria-expanded', 'true');
        }
      }

      function closePopup() {
        if (open) {
          open = false;
          popup.hidden = true;
          textarea.setAttribute('aria-expanded', 'false');
          textarea.removeAttribute('aria-activedescendant');
        }
        matches = [];
        activeIndex = -1;
        detection = null;
      }

      function refresh() {
        var caret = textarea.selectionStart;
        var det = detect(textarea.value, caret);
        if (!det) {
          closePopup();
          return;
        }
        var results = filter(users, det.query, 6);
        if (results.length === 0) {
          // Do not show an empty popup (R8.5).
          closePopup();
          return;
        }
        detection = det;
        matches = results;
        activeIndex = 0;
        renderOptions();
        updateActiveAria();
        openPopup();
      }

      function move(delta) {
        if (matches.length === 0) return;
        activeIndex = (activeIndex + delta + matches.length) % matches.length;
        updateActiveAria();
      }

      function pick(index) {
        if (index == null) index = activeIndex;
        if (!detection || index < 0 || index >= matches.length) return;
        var user = matches[index];
        var value = textarea.value;
        var caret = textarea.selectionStart;
        var start = detection.start;
        var insert = '@' + user.handle + ' ';
        var next = value.slice(0, start) + insert + value.slice(caret);
        textarea.value = next;
        var newCaret = start + insert.length;
        textarea.setSelectionRange(newCaret, newCaret);
        closePopup();
        // Native input event so auto-grow and send-button state refresh.
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      function onInput() {
        refresh();
      }
      function onKeyup(e) {
        // Caret-move keys (arrows/home/end) can change detection; ignore keys
        // already handled on keydown while open.
        if (open && isConsumedKey(e.key)) return;
        refresh();
      }
      function onClick() {
        refresh();
      }

      function isConsumedKey(key) {
        return (
          key === 'ArrowUp' ||
          key === 'ArrowDown' ||
          key === 'Enter' ||
          key === 'Tab' ||
          key === 'Escape'
        );
      }

      // Registered BEFORE the composer's keydown handler (mentions() is created
      // from inside composer() before composer attaches its own listener). While
      // open we stop propagation so Enter does not send.
      function onKeydown(e) {
        if (!open) return;
        switch (e.key) {
          case 'ArrowDown':
            e.stopImmediatePropagation();
            e.preventDefault();
            move(1);
            break;
          case 'ArrowUp':
            e.stopImmediatePropagation();
            e.preventDefault();
            move(-1);
            break;
          case 'Enter':
          case 'Tab':
            e.stopImmediatePropagation();
            e.preventDefault();
            pick();
            break;
          case 'Escape':
            e.stopImmediatePropagation();
            e.preventDefault();
            closePopup();
            break;
          default:
            break;
        }
      }

      // mousedown (not click) so preventDefault keeps textarea focus; the pick
      // then runs before blur closes the popup.
      function onPopupMousedown(e) {
        var item = e.target.closest ? e.target.closest('.chat-mention-popup__item') : null;
        if (!item) return;
        e.preventDefault();
        var idx = Number(item.getAttribute('data-index'));
        pick(idx);
      }

      function onBlur() {
        // Defer so a pointer pick (mousedown) wins over blur-close.
        blurTimer = window.setTimeout(function () {
          closePopup();
        }, 0);
      }
      function onFocus() {
        if (blurTimer) {
          window.clearTimeout(blurTimer);
          blurTimer = null;
        }
      }

      textarea.addEventListener('input', onInput);
      textarea.addEventListener('keyup', onKeyup);
      textarea.addEventListener('click', onClick);
      textarea.addEventListener('keydown', onKeydown);
      textarea.addEventListener('blur', onBlur);
      textarea.addEventListener('focus', onFocus);
      popup.addEventListener('mousedown', onPopupMousedown);

      return {
        element: textarea,
        setUsers: function (next) {
          users = next || [];
          if (open) refresh();
        },
        isOpen: function () {
          return open;
        },
        close: closePopup,
        destroy: function () {
          if (blurTimer) window.clearTimeout(blurTimer);
          textarea.removeEventListener('input', onInput);
          textarea.removeEventListener('keyup', onKeyup);
          textarea.removeEventListener('click', onClick);
          textarea.removeEventListener('keydown', onKeydown);
          textarea.removeEventListener('blur', onBlur);
          textarea.removeEventListener('focus', onFocus);
          popup.removeEventListener('mousedown', onPopupMousedown);
          if (popup.parentNode) popup.parentNode.removeChild(popup);
          textarea.removeAttribute('role');
          textarea.removeAttribute('aria-autocomplete');
          textarea.removeAttribute('aria-expanded');
          textarea.removeAttribute('aria-controls');
          textarea.removeAttribute('aria-activedescendant');
          ChatUI._forget('mentions', textarea);
        }
      };
    });
  }

  mentions.detect = detect;
  mentions.filter = filter;
  ChatUI.mentions = mentions;
})(ChatUI);
