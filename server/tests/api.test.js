import test from 'node:test';
import assert from 'node:assert';

test('API - Health check', async () => {
  const response = await fetch('http://localhost:5003/api/health');
  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.strictEqual(data.status, 'ok');
});

test('API - Config', async () => {
  const response = await fetch('http://localhost:5003/api/config');
  assert.strictEqual(response.status, 200);
  const data = await response.json();
  assert.ok(data.themeColor || data.theme_color);
});
