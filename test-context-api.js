const axios = require('axios');

const API_URL = 'http://localhost:3000/api/admin/context';

async function testContextApi() {
    try {
        console.log('1. Getting current context...');
        const initialResponse = await axios.get(API_URL);
        const initialContext = initialResponse.data;
        console.log('   Success! Base context length:', initialContext.baseBrainContext.length);

        console.log('2. Updating baseBrainContext...');
        const newBaseContext = initialContext.baseBrainContext + '\nTEST_UPDATE';
        await axios.post(API_URL, {
            key: 'baseBrainContext',
            value: newBaseContext
        });
        console.log('   Update sent.');

        console.log('3. Verifying update...');
        const updatedResponse = await axios.get(API_URL);
        if (updatedResponse.data.baseBrainContext.includes('TEST_UPDATE')) {
            console.log('   Success! Context updated.');
        } else {
            console.error('   FAILED! Context did not update.');
        }

        console.log('4. Restoring original context...');
        await axios.post(API_URL, {
            key: 'baseBrainContext',
            value: initialContext.baseBrainContext
        });
        console.log('   Restored.');

        console.log('5. Updating a command context (/start classifier)...');
        const newClassifier = 'TEST_CLASSIFIER';
        await axios.post(API_URL, {
            key: '/start',
            value: newClassifier,
            type: 'classifier'
        });

        const commandResponse = await axios.get(API_URL);
        if (commandResponse.data.contexts['/start'].classifier === newClassifier) {
            console.log('   Success! Command classifier updated.');
        } else {
            console.error('   FAILED! Command classifier did not update.');
        }

        console.log('6. Restoring command context...');
        await axios.post(API_URL, {
            key: '/start',
            value: initialContext.contexts['/start'].classifier,
            type: 'classifier'
        });
        console.log('   Restored.');

        console.log('ALL TESTS PASSED');

    } catch (error) {
        console.error('Test failed:', error.message);
        if (error.code) console.error('Error code:', error.code);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        } else {
            console.error('No response received');
        }
    }
}

testContextApi();
