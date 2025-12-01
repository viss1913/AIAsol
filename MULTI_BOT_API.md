# Multi-Bot API Documentation

## Base URL
```
http://localhost:3000
```

## Authentication
All `/api/admin/*` endpoints require HTTP Basic Authentication.

**Headers:**
```
Authorization: Basic <base64(username:password)>
```

Credentials are set via environment variables:
- `ADMIN_USER`
- `ADMIN_PASS`

---

## 🤖 Bot Management

### 1. Get All Bots
**GET** `/api/admin/bots`

**Response:**
```json
[
  {
    "id": 1,
    "name": "Default Bot",
    "token": "12345...",  // Masked for security
    "is_active": true,
    "created_at": "2025-12-01T10:00:00.000Z"
  }
]
```

---

### 2. Create New Bot
**POST** `/api/admin/bots`

**Request Body:**
```json
{
  "name": "My New Bot",
  "token": "1234567890:ABCdefGHIjklMNOpqrsTUVwxyz",
  "baseBrainContext": "You are a helpful assistant." // Optional
}
```

**Response:**
```json
{
  "success": true,
  "id": 2,
  "message": "Bot created and started"
}
```

**Notes:**
- Bot will start automatically after creation
- Token must be unique

---

### 3. Update Bot
**PUT** `/api/admin/bots/:id`

**Request Body:**
```json
{
  "name": "Updated Name",           // Optional
  "token": "new_token",             // Optional
  "isActive": false,                // Optional
  "baseBrainContext": "New context" // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bot updated"
}
```

**Notes:**
- If `isActive` is set to `false`, bot will stop
- If `isActive` is set to `true` or token changes, bot will restart

---

### 4. Delete Bot
**DELETE** `/api/admin/bots/:id`

**Response:**
```json
{
  "success": true,
  "message": "Bot deleted"
}
```

**Notes:**
- Bot will be stopped before deletion
- All related data (contexts, sessions, messages) will be deleted (CASCADE)

---

## 🧠 Context Management (Per Bot)

### 5. Get All Contexts for Bot
**GET** `/api/admin/context?botId=1`

**Query Parameters:**
- `botId` (required) - ID of the bot

**Response:**
```json
{
  "baseBrainContext": "You are a helpful assistant.",
  "contexts": {
    "/start": {
      "classifier": "User wants to start conversation",
      "response": "Welcome! How can I help you?",
      "section": "onboarding"
    },
    "/help": {
      "classifier": "User needs help",
      "response": "Here's how I can assist you...",
      "section": "support"
    }
  }
}
```

---

### 6. Create/Update Command Context
**POST** `/api/admin/context`

**Request Body:**
```json
{
  "botId": 1,
  "key": "/start",
  "classifier": "User wants to start conversation",
  "response": "Welcome! How can I help you?",
  "section": "onboarding"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Context updated successfully"
}
```

**Notes:**
- `key` is the command name (e.g., `/start`)
- Both `classifier` and `response` are optional, but at least one should be provided
- If context exists, it will be updated; otherwise, it will be created

---

### 7. Update Base Brain Context
**PUT** `/api/admin/context/brain`

**Request Body:**
```json
{
  "botId": 1,
  "baseBrainContext": "You are a professional financial advisor."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Base brain context updated"
}
```

**Notes:**
- This updates the global system prompt for the bot
- This is stored in the `bots` table, not in `ai_commands`

---

### 8. Delete Command Context
**POST** `/api/admin/context/delete`

**Request Body:**
```json
{
  "botId": 1,
  "key": "/start"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Context deleted successfully"
}
```

---

## 👥 User Management

### 9. Get All Users
**GET** `/api/admin/users`

**Response:**
```json
[
  {
    "user_id": "123456789",
    "nickname": "John Doe",
    "username": "johndoe",
    "registration_date": "2025-11-30T10:00:00.000Z",
    "last_message_date": "2025-12-01T09:30:00.000Z"
  }
]
```

**Notes:**
- Users are global across all bots
- `last_message_date` shows the most recent message from any bot

---

### 10. Get User Messages
**GET** `/api/admin/users/:id/messages`

**Parameters:**
- `:id` - User ID (Telegram user ID)

**Response:**
```json
[
  {
    "role": "user",
    "content": "Hello!",
    "created_at": "2025-12-01T09:00:00.000Z"
  },
  {
    "role": "assistant",
    "content": "Hi! How can I help you?",
    "created_at": "2025-12-01T09:00:05.000Z"
  }
]
```

**Notes:**
- Returns all messages from all bots for this user
- Messages are ordered by `created_at`

---

### 11. Send Message to User
**POST** `/api/admin/users/:id/send`

**Parameters:**
- `:id` - User ID (Telegram user ID)

**Request Body:**
```json
{
  "botId": 1,
  "message": "Hello from admin!"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent"
}
```

**Notes:**
- Message will be sent via the specified bot
- Message will be saved to the database as an assistant message

---

### 12. Broadcast Message to All Users
**POST** `/api/admin/users/broadcast`

**Request Body:**
```json
{
  "botId": 1,
  "message": "Important announcement for all users!"
}
```

**Response:**
```json
{
  "success": true,
  "total": 100,
  "sent": 98,
  "failed": 2
}
```

**Notes:**
- Sends message to ALL users in the database
- Uses the specified bot to send messages
- Returns statistics about delivery

---

## 🔧 Database Schema

### Tables

#### `bots`
```sql
CREATE TABLE bots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL UNIQUE,
  base_brain_context TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `ai_commands`
```sql
CREATE TABLE ai_commands (
  command VARCHAR(255),
  classifier TEXT,
  response TEXT,
  section VARCHAR(255) DEFAULT 'general',
  bot_id INT,
  PRIMARY KEY (command, bot_id),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
```

#### `users`
```sql
CREATE TABLE users (
  user_id VARCHAR(255) PRIMARY KEY,
  nickname VARCHAR(255),
  username VARCHAR(255),
  registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_message_date TIMESTAMP NULL
);
```

#### `sessions`
```sql
CREATE TABLE sessions (
  user_id VARCHAR(255),
  bot_id INT,
  last_command VARCHAR(255) DEFAULT '/start',
  history JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, bot_id),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);
```

#### `messages`
```sql
CREATE TABLE messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(255),
  bot_id INT,
  role ENUM('user','assistant') NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX(user_id),
  FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE SET NULL
);
```

---

## 🚀 Frontend Integration

### API Client Setup

```javascript
const API_BASE_URL = 'http://localhost:3000/api/admin';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'password';

const authHeader = 'Basic ' + btoa(`${ADMIN_USER}:${ADMIN_PASS}`);

// Example: Get all bots
fetch(`${API_BASE_URL}/bots`, {
  headers: {
    'Authorization': authHeader
  }
})
.then(res => res.json())
.then(bots => console.log(bots));
```

### Important Notes for Frontend

1. **All requests to `/api/admin/*` must include Authorization header**
2. **All context-related endpoints require `botId` parameter**
3. **Bot selection should be persistent in the UI** (e.g., in localStorage or state)
4. **When switching bots, reload contexts for the selected bot**

---

## 📝 Example Workflow

### Creating and Managing a New Bot

```javascript
// 1. Create a new bot
const createBot = await fetch(`${API_BASE_URL}/bots`, {
  method: 'POST',
  headers: {
    'Authorization': authHeader,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Support Bot',
    token: 'YOUR_BOT_TOKEN',
    baseBrainContext: 'You are a customer support assistant.'
  })
});

const { id: botId } = await createBot.json();

// 2. Add a command context
await fetch(`${API_BASE_URL}/context`, {
  method: 'POST',
  headers: {
    'Authorization': authHeader,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    botId: botId,
    key: '/start',
    classifier: 'User starts conversation',
    response: 'Welcome to support! How can I help?',
    section: 'onboarding'
  })
});

// 3. Get all contexts for this bot
const contexts = await fetch(`${API_BASE_URL}/context?botId=${botId}`, {
  headers: { 'Authorization': authHeader }
});

console.log(await contexts.json());
```

---

## ⚠️ Error Handling

### Common Error Responses

**400 Bad Request**
```json
{
  "error": "botId is required"
}
```

**401 Unauthorized**
```
Authentication required.
```

**500 Internal Server Error**
```json
{
  "error": "Internal server error"
}
```

---

## 🔐 Security Notes

1. **Never expose bot tokens in responses** - they are masked in GET `/api/admin/bots`
2. **Always use HTTPS in production**
3. **Store credentials securely** - use environment variables
4. **Implement rate limiting** for production use
5. **Consider using JWT instead of Basic Auth** for better security

---

## 📊 Migration from Single Bot

If you have an existing single-bot setup:

1. **Default bot is created automatically** from `TELEGRAM_TOKEN` in `.env`
2. **Existing contexts are migrated** to the default bot
3. **Existing sessions and messages** are linked to the default bot
4. **No data loss** - all migrations are handled automatically on startup

---

## 🆘 Troubleshooting

### Frontend can't connect to backend

**Check:**
1. CORS is enabled: `app.use(cors())`
2. Backend is running on correct port
3. Authorization header is correctly formatted
4. Environment variables are set (ADMIN_USER, ADMIN_PASS)

### Bot not responding

**Check:**
1. Bot is active: `is_active = true` in database
2. Bot token is valid
3. Bot is started: check console logs for "Bot started: [name]"
4. Telegram webhook is set correctly (if using webhooks)

### Database errors

**Check:**
1. MySQL is running
2. Database credentials in `.env` are correct
3. Database exists and tables are created
4. Run `initDB()` to create/migrate tables
