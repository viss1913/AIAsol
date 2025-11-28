require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-pro-1.5';

console.log('--- OpenRouter Connection Test ---');
console.log('API Key present:', !!API_KEY);
if (API_KEY) console.log('API Key length:', API_KEY.length);
console.log('Model:', MODEL);

async function test() {
    try {
        console.log('Sending request...');
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: MODEL,
                messages: [
                    { role: 'user', content: 'Hello, are you working?' }
                ],
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://test.com',
                    'X-Title': 'TestScript',
                },
            }
        );

        console.log('✅ Success!');
        console.log('Response:', response.data.choices[0].message.content);
    } catch (error) {
        console.error('❌ Error!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Message:', error.message);
        }
    }
}

test();
