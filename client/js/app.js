// Chat client: REST API for channels and history, AppSync Events WebSocket for real time.
// Every request carries the Cognito ID token.
import { getIdToken, signIn, signOut } from './auth.js';

(async function () {
  const cfg = window.CHAT_CONFIG;
  const CHANNEL_PREFIX = '/serverlesschat/channels/';
  const statusEl = document.getElementById('status');

  const firstToken = await getIdToken();
  if (!firstToken) {
    await signIn();
    return;
  }
  const me = firstToken.payload;
  document.getElementById('current-user').textContent = me.name || me['cognito:username'];
  document.getElementById('sign-out').addEventListener('click', () => signOut());

  // a valid ID token, or back to the sign-in page when the session is gone
  async function idToken() {
    const token = await getIdToken();
    if (!token) {
      await signIn();
      throw new Error('Signed out');
    }
    return token.toString();
  }

  function showStatus(text) {
    statusEl.textContent = text;
  }

  async function api(path) {
    const response = await fetch(cfg.restApiUrl.replace(/\/$/, '') + path, {
      headers: { Authorization: await idToken() },
    });
    if (!response.ok) {
      throw new Error(`GET ${path}: HTTP ${response.status}`);
    }
    return response.json();
  }

  // map backend data to the chat-ui User and Message shapes
  const toUser = (m) => ({ id: m.id, name: m.name || m.username, handle: m.username });
  const toMessage = (m) => ({
    id: m.id,
    userId: m.userId,
    name: m.name || m.username,
    text: m.message,
    timestamp: m.timestamp,
  });

  // channels the signed-in user is a member of, with their members
  const channels = (await api('/channels')).sort((a, b) => a.id.localeCompare(b.id));
  const allUsers = [...new Map(channels.flatMap((c) => c.members).map((m) => [m.id, toUser(m)])).values()];

  const navEl = document.getElementById('channel-list');
  for (const channel of channels) {
    const item = document.createElement('button');
    item.className = 'chat-channel-item';
    item.type = 'button';
    item.dataset.channelId = channel.id;
    const hash = document.createElement('span');
    hash.className = 'chat-channel-item__hash';
    hash.setAttribute('aria-hidden', 'true');
    hash.textContent = '#';
    const name = document.createElement('span');
    name.className = 'chat-channel-item__name';
    name.textContent = channel.id;
    item.append(hash, name);
    navEl.append(item);
  }

  const formEl = document.getElementById('composer');
  const inputEl = document.getElementById('composer-input');
  const headerNameEl = document.getElementById('header-name');
  ChatUI.layout(document.getElementById('app'));
  const channelNav = ChatUI.channelList(navEl);
  const list = ChatUI.messageList(document.getElementById('message-list'), { currentUserId: me.sub, users: allUsers });
  const composer = ChatUI.composer(formEl, { users: [] });
  const members = ChatUI.memberList(document.getElementById('header-meta'), { members: [] });

  let current = null;
  const unread = {};

  async function show(id) {
    current = id;
    channelNav.setActive(id);
    unread[id] = 0;
    channelNav.setUnread(id, 0);
    headerNameEl.textContent = `# ${id}`;
    inputEl.placeholder = `Message #${id}`;
    const channelUsers = channels.find((c) => c.id === id).members.map(toUser);
    members.setMembers(channelUsers);
    members.close();
    composer.setUsers(channelUsers);
    list.clear();
    const history = await api(`/channels/${encodeURIComponent(id)}/messages`);
    if (current !== id) return; // switched channel while loading
    list.clear();
    list.append(history.map(toMessage));
  }

  navEl.addEventListener('chat:channel-select', (e) => show(e.detail.id).catch((err) => showStatus(err.message)));

  // AppSync Events WebSocket, authorized with the ID token
  function subprotocol(authorization) {
    const header = btoa(JSON.stringify(authorization))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header-${header}`;
  }

  async function authorization() {
    return { host: cfg.eventApiHttpDns, Authorization: await idToken() };
  }

  let socket;

  async function connect() {
    socket = new WebSocket(`wss://${cfg.eventApiRealtimeDns}/event/realtime`,
      ['aws-appsync-event-ws', subprotocol(await authorization())]);
    socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
    socket.onmessage = (e) => onSocketMessage(JSON.parse(e.data));
    // reconnect with a fresh token, for example after a network drop
    socket.onclose = () => setTimeout(() => connect().catch(console.error), 2000);
  }

  async function onSocketMessage(msg) {
    switch (msg.type) {
      case 'connection_ack':
        // subscribe to every channel, so unread counts work for the ones not shown
        for (const channel of channels) {
          socket.send(JSON.stringify({
            type: 'subscribe',
            id: `sub-${channel.id}`,
            channel: CHANNEL_PREFIX + channel.id,
            authorization: await authorization(),
          }));
        }
        showStatus('');
        break;
      case 'data': {
        // own messages are shown when they come back here, with the server's author and time
        const message = JSON.parse(msg.event);
        if (message.channel === current) {
          list.append(toMessage(message));
        } else {
          unread[message.channel] = (unread[message.channel] || 0) + 1;
          channelNav.setUnread(message.channel, unread[message.channel]);
        }
        break;
      }
      case 'subscribe_error':
      case 'publish_error':
      case 'broadcast_error':
        console.warn(msg);
        showStatus(`${msg.type}: ${(msg.errors || []).map((e) => e.errorType).join(', ')}`);
        break;
    }
  }

  formEl.addEventListener('chat:send', async (e) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !current) {
      e.preventDefault(); // keep the text in the composer
      showStatus('Not connected');
      return;
    }
    socket.send(JSON.stringify({
      type: 'publish',
      id: crypto.randomUUID(),
      channel: CHANNEL_PREFIX + current,
      events: [JSON.stringify({ message: e.detail.text })],
      authorization: await authorization(),
    }));
  });

  if (channels.length === 0) {
    headerNameEl.textContent = 'You are not a member of any channel';
    composer.setDisabled(true);
    return;
  }
  await connect();
  await show(channels[0].id);
})().catch((err) => {
  console.error(err);
  document.getElementById('status').textContent = err.message;
});
