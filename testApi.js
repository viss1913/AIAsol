const axios = require('axios');

async function test() {
    try {
        console.log('Testing GET /spec...');
        const res = await axios.get('http://localhost:3001/spec');
        console.log('Status:', res.status);
        console.log('Data:', JSON.stringify(res.data).slice(0, 100));
    } catch (err) {
        console.error('GET /spec failed:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }

    try {
        console.log('\nTesting POST /chat...');
        const res = await axios.post('http://localhost:3001/chat', {
            userId: 'test-user',
            message: 'Привет'
        });
        console.log('Status:', res.status);
        console.log('Reply:', res.data.reply);
    } catch (err) {
        console.error('POST /chat failed:', err.message);
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Data:', err.response.data);
        }
    }
}

test();
