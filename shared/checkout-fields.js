/*
 * Parses the local checkout-info text into groups of copyable fields.
 *
 *   # Alex (lead booker)
 *   Registration: 1234567890
 *   Postcode: BA4 4BY
 *
 *   # Sam
 *   Registration: 2345678901
 *
 * Lines before the first "# heading" go into an untitled group. The values
 * are only ever copied to the clipboard by a button the user clicks.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TicketHelperCheckout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function parseCheckoutFields(text) {
    const groups = [];
    let current = null;
    const errors = [];
    String(text || '')
      .split(/\r?\n/)
      .forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;
        if (line.startsWith('#')) {
          current = { title: line.replace(/^#+\s*/, ''), fields: [] };
          groups.push(current);
          return;
        }
        const idx = line.indexOf(':');
        if (idx <= 0) {
          errors.push(`Line ${i + 1}: expected "Label: value"`);
          return;
        }
        const label = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!value) return;
        if (!current) {
          current = { title: '', fields: [] };
          groups.push(current);
        }
        current.fields.push({ label, value });
      });
    return { groups: groups.filter((g) => g.fields.length), errors };
  }

  /** Mask all but the last few characters, for display on shared screens. */
  function mask(value, visible) {
    const v = String(value);
    const keep = visible == null ? 3 : visible;
    if (v.length <= keep) return v;
    return '•'.repeat(Math.min(8, v.length - keep)) + v.slice(-keep);
  }

  const EXAMPLE = [
    '# Alex (lead booker)',
    'Name: Alex Example',
    'Registration: 1234567890',
    'Postcode: BA4 4BY',
    'Email: alex@example.com',
    '',
    '# Sam',
    'Registration: 2345678901',
    'Postcode: BS1 1AA',
  ].join('\n');

  return { parseCheckoutFields, mask, EXAMPLE };
});
