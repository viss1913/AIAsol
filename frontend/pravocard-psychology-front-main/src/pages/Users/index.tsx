import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';

const BOT_STORAGE_KEY = 'adminSelectedBotId';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  bot_name?: string | null;
}

interface User {
  user_id: string;
  nickname: string;
  username: string | null;
  registration_date: string;
  last_message_date: string;
}

interface BotRow {
  id: number;
  name: string;
}

export const Users: React.FC = () => {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const pickBotId = useCallback((list: BotRow[]) => {
    if (!list.length) return '';
    let next = String(list[0].id);
    try {
      const saved = localStorage.getItem(BOT_STORAGE_KEY);
      if (saved && list.some((b) => String(b.id) === saved)) {
        next = saved;
      }
    } catch {
      /* ignore */
    }
    return next;
  }, []);

  const loadBots = useCallback(async () => {
    const res = await axios.get<BotRow[]>('/api/admin/bots');
    const list = res.data || [];
    setBots(list);
    const id = pickBotId(list);
    setSelectedBotId(id);
    return id;
  }, [pickBotId]);

  const loadUsersForBot = useCallback(async (botId: string) => {
    if (!botId) {
      setUsers([]);
      return;
    }
    const response = await axios.get<User[]>('/api/admin/users', {
      params: { botId },
    });
    setUsers(response.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const botId = await loadBots();
        if (cancelled) return;
        if (botId) await loadUsersForBot(botId);
        else setUsers([]);
      } catch (e) {
        console.error(e);
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadBots, loadUsersForBot]);

  const refreshUsers = async () => {
    if (!selectedBotId) return;
    setLoading(true);
    try {
      await loadUsersForBot(selectedBotId);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const onBotChange = (id: string) => {
    setSelectedBotId(id);
    setExpandedUserId(null);
    setMessages([]);
    try {
      localStorage.setItem(BOT_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setLoading(true);
    loadUsersForBot(id)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  const handleExpand = async (userId: string) => {
    if (!selectedBotId) return;
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setMessages([]);
      return;
    }

    setExpandedUserId(userId);
    setLoadingMessages(true);
    try {
      const response = await axios.get<Message[]>(`/api/admin/users/${userId}/messages`, {
        params: { botId: selectedBotId },
      });
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Пользователи</h1>
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <label htmlFor="users-bot">Бот</label>
        <select
          id="users-bot"
          value={selectedBotId}
          onChange={(e) => onBotChange(e.target.value)}
          disabled={!bots.length}
        >
          {!bots.length ? (
            <option value="">Нет ботов</option>
          ) : (
            bots.map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name || `Бот #${b.id}`}
              </option>
            ))
          )}
        </select>
        <button type="button" onClick={() => refreshUsers()} disabled={!selectedBotId}>
          Обновить
        </button>
      </div>
      {loading ? (
        <div>Загрузка…</div>
      ) : !selectedBotId ? (
        <div>Создай бота в админке, чтобы видеть пользователей.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {users.map((user) => (
            <div
              key={user.user_id}
              style={{
                border: '1px solid #ccc',
                borderRadius: '8px',
                padding: '15px',
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                }}
                onClick={() => handleExpand(user.user_id)}
              >
                <div>
                  <strong>{user.nickname}</strong>
                  {user.username && (
                    <span style={{ color: '#666', marginLeft: '10px' }}>({user.username})</span>
                  )}
                </div>
                <div style={{ fontSize: '0.9em', color: '#888' }}>
                  Регистрация: {new Date(user.registration_date).toLocaleString()}
                </div>
              </div>

              {expandedUserId === user.user_id && (
                <div style={{ marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                  <h3>История диалога</h3>
                  {loadingMessages ? (
                    <div>Загрузка сообщений...</div>
                  ) : messages.length > 0 ? (
                    <div
                      style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {messages.map((msg, idx) => (
                        <div
                          key={idx}
                          style={{
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            background: msg.role === 'user' ? '#e3f2fd' : '#f5f5f5',
                            padding: '8px 12px',
                            borderRadius: '10px',
                            maxWidth: '80% ',
                          }}
                        >
                          <div style={{ fontSize: '0.8em', color: '#999', marginBottom: '4px' }}>
                            {msg.role === 'user' ? 'Пользователь' : 'Бот'} •{' '}
                            {new Date(msg.created_at).toLocaleString()}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div>Нет сообщений</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
