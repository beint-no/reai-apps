// SSRF guard for provider requests. Provider mappings are verified with one-off checks against each
// vendor's documented examples instead of committed fixtures, which went stale when the APIs were audited.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicHttpsUrl } from '../worker/lib/api-http.js';

test('SSRF guard allows public https:// and blocks localhost/private/http', () => {
  assert.equal(assertPublicHttpsUrl('https://api.example-vendor.no/v1/x').hostname, 'api.example-vendor.no');
  for (const bad of ['http://api.example-vendor.no', 'https://localhost/api', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest', 'https://internal.local/api']) {
    assert.throws(() => assertPublicHttpsUrl(bad), /https:\/\/ host|valid https/i, `Expected SSRF block for ${bad}`);
  }
});
