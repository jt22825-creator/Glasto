'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../shared/checkout-fields');

test('parses grouped Label: value lines', () => {
  const { groups, errors } = K.parseCheckoutFields(K.EXAMPLE);
  assert.deepEqual(errors, []);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Alex (lead booker)');
  assert.deepEqual(groups[0].fields.map((f) => f.label), ['Name', 'Registration', 'Postcode', 'Email']);
  assert.equal(groups[1].fields[0].value, '2345678901');
});

test('ungrouped fields, values containing colons, bad lines, empty groups', () => {
  const { groups, errors } = K.parseCheckoutFields('Postcode: BA4 4BY\nNote: pick up at 10:30\njunk\n# Empty\n');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, '');
  assert.equal(groups[0].fields[1].value, 'pick up at 10:30');
  assert.equal(errors.length, 1);
});

test('mask hides all but the last characters', () => {
  assert.equal(K.mask('1234567890'), '•••••••890');
  assert.equal(K.mask('BA4'), 'BA4');
  assert.equal(K.mask('abcdef', 2), '••••ef');
});
