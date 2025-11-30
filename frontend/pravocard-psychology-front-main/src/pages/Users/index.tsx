import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface User {
  user_id: string;
  nickname: string;
  username: string | null;
  registration_date: string;
  last_message_date: string;
}

export const Users: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/admin/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleExpand = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      setMessages([]);
      return;
    }

    setExpandedUserId(userId);
    setLoadingMessages(true);
    try {
      const response = await axios.get(`/api/admin/users/${userId}/messages`);
      setMessages(response.data);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  if (loading) return <div>Загрузка пользователей...</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h1>Пользователи</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {users.map((user) => (
          <div key={user.user_id} style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '15px', background: '#fff' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => handleExpand(user.user_id)}
            >
              <div>
                <strong>{user.nickname}</strong>
                {user.username && <span style={{ color: '#666', marginLeft: '10px' }}>({user.username})</span>}
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
                  <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {messages.map((msg, idx) => (
                      <div
                        key={idx}
                        style={{
                          alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                          background: msg.role === 'user' ? '#e3f2fd' : '#f5f5f5',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          maxWidth: '80% '
                        }}
                      >
                        <div style={{ fontSize: '0.8em', color: '#999', marginBottom: '4px' }}>
                          {msg.role === 'user' ? 'Пользователь' : 'Бот'} • {new Date(msg.created_at).toLocaleString()}
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
    </div>
  );
};
