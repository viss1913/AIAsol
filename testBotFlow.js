// Test script to simulate a Telegram bot message flow
// It runs the same steps as telegram.js but without real Telegram connection.
const { getClassifierContext, getResponseContext } = require('./context');
const { classifyIntent, askAI } = require('./ai');

async function simulate(userMessage, currentCommand = '/start') {
    console.log('=== Simulating message ===');
    console.log('User message:', userMessage);
    console.log('Current command:', currentCommand);

    // Step 1: classifier context
    const classifierContext = await getClassifierContext(currentCommand);
    console.log('\n[1] Classifier context (truncated):', classifierContext ? classifierContext.slice(0, 120) + '...' : 'Empty');

    // Step 2: classify intent (first AI)
    const newCommand = await classifyIntent(userMessage, classifierContext);
    console.log('\n[2] New command from classifier:', newCommand);

    // Step 3: response context (base + command response)
    const responseContext = await getResponseContext(newCommand);
    console.log('\n[3] Response context (truncated):', responseContext.slice(0, 120) + '...');

    // Step 4: generate reply (second AI)
    const mockHistory = [
        { role: 'user', content: 'Предыдущее сообщение пользователя' },
        { role: 'assistant', content: 'Предыдущий ответ бота' }
    ];
    const reply = await askAI(userMessage, responseContext, mockHistory);
    console.log('\n[4] AI reply:', reply);
    console.log('=== End simulation ===\n');
}

// Example runs – you can edit these messages as needed
(async () => {
    await simulate('Привет, я хочу открыть вклад');
    // await simulate('Какой процент по плану?', '/plan');
})();
