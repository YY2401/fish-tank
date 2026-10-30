/* 匿名讀 Twitch 聊天室（IRC over WebSocket）：不用登入、不用 Client ID，只能讀不能發 */
(function (root) {
  const URL = 'wss://irc-ws.chat.twitch.tv:443';

  // onMessage({ login, display, text, tags, badges })，訂閱／揪團是 { notice: true, kind, login, display, viewers }；onStatus('connecting' | 'joined' | 'closed')
  function connectChat(channel, onMessage, onStatus) {
    let ws = null;
    let retry = 1000;
    let stopped = false;

    function open() {
      onStatus && onStatus('connecting');
      ws = new WebSocket(URL);
      ws.onopen = () => {
        ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        ws.send('PASS SCHMOOPIIE');
        ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
        ws.send('JOIN #' + channel);
      };
      ws.onmessage = (e) => {
        for (const line of String(e.data).split('\r\n')) {
          if (!line) continue;
          if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
          const m = FishCore.parseIrc(line);
          if (m.command === 'JOIN' || m.command === 'ROOMSTATE') { retry = 1000; onStatus && onStatus('joined'); }
          if (m.command === 'RECONNECT') ws.close();
          if (m.command === 'USERNOTICE') {
            const n = FishCore.noticeOf(m);
            if (n) onMessage({ ...n, notice: true, tags: m.tags, badges: FishCore.badgesOf(m.tags), text: m.text });
            continue;
          }
          if (m.command !== 'PRIVMSG') continue;
          onMessage({
            login: m.login,
            display: m.tags['display-name'] || m.login,
            text: m.text,
            tags: m.tags,
            badges: FishCore.badgesOf(m.tags),
          });
        }
      };
      ws.onclose = () => {
        onStatus && onStatus('closed');
        if (stopped) return;
        setTimeout(open, retry);
        retry = Math.min(retry * 2, 30000);
      };
    }

    open();
    return { stop() { stopped = true; ws && ws.close(); } };
  }

  root.connectChat = connectChat;
})(self);
