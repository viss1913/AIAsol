const { askAI } = require('./ai');
const { getResponseContext } = require('./context');

async function testAI() {
    const context = getResponseContext('/start');
    console.log('--- Prompt ---');
    console.log(context);
    console.log('--- User Message ---');
    console.log('Как тебя зовут?');

    console.log('--- AI Response ---');
    const response = await askAI('Как тебя зовут?', context);
    console.log(response);
}

testAI();
