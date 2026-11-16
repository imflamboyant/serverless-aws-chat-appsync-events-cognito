/* members.js — ChatUI.memberList(): a count button that toggles a members
 * panel (avatar + name rows) inside the layout's right pane (.chat-layout__aside).
 *
 * Classic script (no ES modules). Depends at runtime on ChatUI.createAvatar and
 * ChatUI._controller / ChatUI._forget.
 */
var ChatUI = (window.ChatUI = window.ChatUI || {});
(function (ChatUI) {
  'use strict';
  var uid = 0;
  var CLOSE_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"/></svg>';
  /**
   * Attach a members panel to a trigger button; it lives in the right pane.
   *
   * @param {HTMLElement} button - The member-count trigger (ideally a <button>).
   * @param {{members?:Array,container?:HTMLElement,title?:string}} [opts]
   * @returns {object} Controller: { element, panel, setMembers, open, close,
   *   toggle, isOpen, destroy }.
   */
  function memberList(button, opts) {
    return ChatUI._controller('memberList', button, function () {
      return build(button, opts || {});
    });
  }
  function build(button, opts) {
    var members = (opts.members || []).slice();
    var title = opts.title || 'Members';
    var layout = button.closest('.chat-layout');
    var container = opts.container || (layout && layout.querySelector('.chat-layout__aside'));
    var createdAside = false;
    if (!container) {
      container = document.createElement('aside');
      container.className = 'chat-layout__aside';
      (layout || button.parentElement).appendChild(container);
      createdAside = true;
    }
    container.hidden = true;
    var id = 'chat-member-panel-' + ++uid;
    var open = false;
    var panel = document.createElement('div');
    panel.className = 'chat-member-panel';
    panel.id = id;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', id + '-title');
    panel.hidden = true;
    var header = document.createElement('div');
    header.className = 'chat-member-panel__header';
    var heading = document.createElement('h2');
    heading.className = 'chat-member-panel__title';
    heading.id = id + '-title';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'chat-member-panel__close';
    closeBtn.setAttribute('aria-label', 'Close members list');
    closeBtn.innerHTML = CLOSE_SVG; // static constant, no user data
    header.appendChild(heading);
    header.appendChild(closeBtn);
    var list = document.createElement('ul');
    list.className = 'chat-member-panel__list';
    panel.appendChild(header);
    panel.appendChild(list);
    container.appendChild(panel);
    button.setAttribute('aria-controls', id);
    
    button.setAttribute('aria-expanded', 'false');

    function render() {
      heading.textContent = title + ' (' + members.length + ')';
      button.textContent = members.length + (members.length === 1 ? ' member' : ' members');
      while (list.firstChild) list.removeChild(list.firstChild);
      members.forEach(function (u) {
        var li = document.createElement('li');
        li.className = 'chat-member-panel__item';
        li.appendChild(ChatUI.createAvatar({ userId: u.id, name: u.name, avatarUrl: u.avatarUrl }, 'sm'));
        var name = document.createElement('span');
        name.className = 'chat-member-panel__name';
        name.textContent = u && u.name ? u.name : '';
        li.appendChild(name);
        list.appendChild(li);
      });
    }
    function emit() {
      button.dispatchEvent(
        new CustomEvent('chat:members-toggle', {
          bubbles: true,
          detail: { open: open, members: members.slice() }
        })
      );
    }
    function setOpen(next, focusTarget) {
      if (next === open) return;
      open = next;
      panel.hidden = !open;
      container.hidden = !open;
      // Below 1100px the aside is hidden by CSS; data-open shows it as an overlay.
      if (open) container.setAttribute('data-open', '');
      else container.removeAttribute('data-open');
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (focusTarget) focusTarget.focus();
      emit();
    }
    function onButtonClick() {
      setOpen(!open, open ? null : closeBtn);
    }
    function onCloseClick() {
      setOpen(false, button);
    }
    function onKeydown(e) {
      if (!open || e.key !== 'Escape') return;
      var a = document.activeElement;
      if (panel.contains(a) || a === button) {
        e.stopPropagation();
        setOpen(false, button);
      } else {
        setOpen(false);
      }
    }
    button.addEventListener('click', onButtonClick);
    closeBtn.addEventListener('click', onCloseClick);
    document.addEventListener('keydown', onKeydown);
    render();

    return {
      element: button,
      panel: panel,
      setMembers: function (users) {
        members = (users || []).slice();
        render();
      },
      open: function () { setOpen(true, closeBtn); },
      close: function () { setOpen(false); },
      toggle: function () { onButtonClick(); },
      isOpen: function () { return open; },
      destroy: function () {
        closeBtn.removeEventListener('click', onCloseClick);
        button.removeEventListener('click', onButtonClick);
        document.removeEventListener('keydown', onKeydown);
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        if (createdAside && container.parentNode) container.parentNode.removeChild(container);
        else {
          container.hidden = true;
          container.removeAttribute('data-open');
        }
        button.removeAttribute('aria-controls');
        button.setAttribute('aria-expanded', 'false');
        ChatUI._forget('memberList', button);
      }
    };
  }
  ChatUI.memberList = memberList;
})(ChatUI);
