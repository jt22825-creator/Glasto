#!/usr/bin/env node
/*
 * Builds userscript/ticket-helper.user.js from userscript/src/ plus the
 * shared modules. Userscripts can't import files, so the shared modules are
 * inlined, each in its own function scope with a local `module` object.
 *
 *   node scripts/build-userscript.js          write the file
 *   node scripts/build-userscript.js --check  exit 1 if the file is stale
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'userscript', 'ticket-helper.user.js');
const MODULES = [
  ['TicketHelperDetection', 'shared/detection.js'],
  ['TicketHelperCountdown', 'shared/countdown.js'],
  ['TicketHelperCheckout', 'shared/checkout-fields.js'],
  ['TicketHelperSession', 'shared/session.js'],
  ['TicketHelperNtfy', 'notifications/ntfy.js'],
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').trimEnd();
}

function build() {
  const parts = [read('userscript/src/header.js'), '', '(function () {', "'use strict';", ''];
  for (const [name, rel] of MODULES) {
    parts.push(`// ---- ${rel} ----`);
    parts.push(`const ${name} = (function () {`);
    parts.push('const module = { exports: {} };');
    parts.push(read(rel));
    parts.push('return module.exports;');
    parts.push('})();', '');
  }
  parts.push('// ---- userscript/src/main.js ----');
  parts.push(read('userscript/src/main.js'));
  parts.push('})();', '');
  return parts.join('\n');
}

if (require.main === module) {
  const output = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== output) {
      console.error('userscript/ticket-helper.user.js is out of date — run `npm run build`.');
      process.exit(1);
    }
    console.log('userscript is up to date');
  } else {
    fs.writeFileSync(OUT, output);
    console.log(`wrote ${path.relative(ROOT, OUT)} (${output.length} bytes)`);
  }
}

module.exports = { build, OUT };
