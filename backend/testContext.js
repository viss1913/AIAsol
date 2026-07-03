// Test script to verify contexts loaded from contexts.json
const { loadContexts, getResponseContext, getClassifierContext } = require('./context');

function test() {
    console.log('--- Loaded Contexts ---');
    const all = loadContexts();
    console.log(JSON.stringify(all, null, 2));

    const sampleCommands = ['/start', '/goLife', '/plan'];
    sampleCommands.forEach(cmd => {
        console.log(`\nCommand: ${cmd}`);
        console.log('Classifier:', getClassifierContext(cmd));
        console.log('Response Context:', getResponseContext(cmd));
    });
}

test();
