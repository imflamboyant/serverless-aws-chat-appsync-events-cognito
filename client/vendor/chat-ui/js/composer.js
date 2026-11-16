/* composer.js — ChatUI.composer() message input with auto-grow, Enter-to-send,
 * and (when ChatUI.mentions is present) @-mention autocomplete.
 *
 * Classic script (no ES modules). Depends at runtime on ChatUI.findMentions and
 * optionally ChatUI.mentions.
 */
var ChatUI = (window.ChatUI = window.ChatUI || {});

(function (ChatUI) {
  'use strict';

  /**
   * Attach composer behavior to a `<form class="chat-composer">`. Finds the
   * `.chat-composer__input` textarea and `.chat-composer__send` button inside.
   * Idempotent per form.
   *
   * @param {HTMLFormElement} form - The composer form.
   * @param {{users?:Array}} [options] - Known users for mentions and chat:send.
   * @returns {object} Controller: setUsers/setDisabled/focus/clear/getText/destroy.
   */
  function composer(form, options) {
    return ChatUI._controller('composer', form, function (form) {
      options = options || {};
      var users = options.users || [];
      var disabled = false;

      var input = form.querySelector('.chat-composer__input');
      var sendBtn = form.querySelector('.chat-composer__send');

      // Instantiate mentions FIRST so its keydown handler is registered on the
      // textarea before the composer's handler (so it can consume Enter).
      var mentionsCtl = null;
      if (input && typeof ChatUI.mentions === 'function') {
        mentionsCtl = ChatUI.mentions(input, { users: users, container: form });
      }

      function getText() {
        return input ? input.value : '';
      }

      function updateSendButton() {
        if (!sendBtn) return;
        var empty = getText().trim() === '';
        sendBtn.disabled = empty || disabled;
      }

      function autoGrow() {
        if (!input) return;
        input.style.height = 'auto';
        // scrollHeight excludes the border; the input is border-box.
        var border = input.offsetHeight - input.clientHeight;
        input.style.height = (input.scrollHeight + border) + 'px';
      }

      function resetHeight() {
        if (!input) return;
        input.style.height = 'auto';
      }

      function submit() {
        if (disabled || !input) return;
        var text = input.value.trim();
        if (text === '') return;
        var evt = new CustomEvent('chat:send', {
          bubbles: true,
          cancelable: true,
          detail: { text: text, mentions: ChatUI.findMentions(text, users) }
        });
        form.dispatchEvent(evt);
        if (!evt.defaultPrevented) {
          input.value = '';
          resetHeight();
          updateSendButton();
          input.focus();
        }
      }

      function onKeydown(e) {
        if (e.key !== 'Enter') return;
        // Shift+Enter inserts a newline; IME composition should not send; and if
        // the mentions popup is open it has already consumed Enter via
        // stopImmediatePropagation, so this handler won't even run for that case.
        if (e.shiftKey || e.isComposing) return;
        e.preventDefault();
        submit();
      }

      function onSubmit(e) {
        e.preventDefault();
        submit();
      }

      function onInput() {
        autoGrow();
        updateSendButton();
      }

      if (input) {
        input.addEventListener('keydown', onKeydown);
        input.addEventListener('input', onInput);
      }
      form.addEventListener('submit', onSubmit);

      updateSendButton();

      return {
        element: form,
        setUsers: function (next) {
          users = next || [];
          if (mentionsCtl) mentionsCtl.setUsers(users);
        },
        setDisabled: function (bool) {
          disabled = !!bool;
          if (input) input.disabled = disabled;
          updateSendButton();
        },
        focus: function () {
          if (input) input.focus();
        },
        clear: function () {
          if (input) input.value = '';
          resetHeight();
          updateSendButton();
        },
        getText: getText,
        destroy: function () {
          if (input) {
            input.removeEventListener('keydown', onKeydown);
            input.removeEventListener('input', onInput);
          }
          form.removeEventListener('submit', onSubmit);
          if (mentionsCtl) mentionsCtl.destroy();
          ChatUI._forget('composer', form);
        }
      };
    });
  }

  ChatUI.composer = composer;
})(ChatUI);
