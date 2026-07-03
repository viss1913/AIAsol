const { getResponseContext, loadContexts } = require('./context');

console.log('--- Loading Contexts Directly ---');
const data = loadContexts();
console.log('Base Context from file:', data.baseBrainContext.substring(0, 50) + '...');

console.log('\n--- Checking getResponseContext output ---');
const responseContext = getResponseContext('/start');
console.log(responseContext);
