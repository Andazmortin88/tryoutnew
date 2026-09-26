const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'midtrans-webhook/index.ts'), 'utf8');
const match = source.match(/function parseMoneyMinor\(value: string\) \{([\s\S]*?)\n\}/);
assert.ok(match, 'money parser exists');
const body = match[1].replace('const s = String(value || \'\').trim()', 'const s = String(value || \'\').trim()');
const fn = vm.runInNewContext('(value) => {' + body + '}', { BigInt });
for (const [input, expected] of [
  ['40000', 4000000n],
  ['40000.00', 4000000n],
  ['40000.50', 4000050n],
  ['0.01', 1n],
  ['40000.001', null],
  ['4e4', null],
  ['-1', null],
]) assert.equal(fn(input), expected, input);
console.log('Money parser accepts Midtrans amounts and rejects malformed values.');
