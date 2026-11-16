import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRedacted, redactCommand } from '../core/redact';

test('env-style assignments with secret names are masked', () => {
  assert.equal(redactCommand('API_KEY=abc npm run dev'), 'API_KEY=*** npm run dev');
  assert.equal(redactCommand('export GITHUB_TOKEN="x y" && npm start'), 'export GITHUB_TOKEN="***" && npm start');
  assert.equal(redactCommand('cross-env DB_PASSWORD=hunter2 PORT=3000 node app.js'), 'cross-env DB_PASSWORD=*** PORT=3000 node app.js');
  assert.equal(redactCommand('$env:TOKEN="x"; npm run dev'), '$env:TOKEN="***"; npm run dev');
  assert.equal(redactCommand("$env:Auth_Header = 'abc' ; pnpm dev"), "$env:Auth_Header = '***' ; pnpm dev");
  assert.equal(redactCommand('set PASSWORD=x&&npm start'), 'set PASSWORD=***&&npm start');
  assert.equal(redactCommand('set PASSWORD=x y && npm start'), 'set PASSWORD=*** && npm start');
  assert.equal(redactCommand('set "SECRET=a b"&& npm start'), 'set "SECRET=***"&& npm start');
  assert.equal(redactCommand('set DB_PWD=1 & npm start'), 'set DB_PWD=*** & npm start');
});

test('non-secret assignments and flags are kept', () => {
  for (const cmd of ['PORT=3000 npm run dev', 'npm run dev -- -p 3000', 'python -m http.server 8000', '$env:NODE_ENV="development"; npm start', 'set PORT=4000&&npm start', 'vite --port 5173 --host']) {
    assert.equal(redactCommand(cmd), cmd);
    assert.equal(isRedacted(redactCommand(cmd)), false);
  }
});

test('secret CLI flags are masked, file flags and following flags are not', () => {
  assert.equal(redactCommand('ngrok http 3000 --authtoken abc --token xyz'), 'ngrok http 3000 --authtoken *** --token ***');
  assert.equal(redactCommand('app --password=x --verbose'), 'app --password=*** --verbose');
  assert.equal(redactCommand('app --api-key "a b" -p 8080'), 'app --api-key "***" -p 8080');
  assert.equal(redactCommand('app --secret --debug'), 'app --secret --debug');
  assert.equal(redactCommand('http-server --ssl-key-file ./key.pem'), 'http-server --ssl-key-file ./key.pem');
});

test('token-looking strings and URL credentials are masked', () => {
  assert.equal(redactCommand('curl -H "Authorization: Bearer abcdefgh12345"'), 'curl -H "Authorization: Bearer ***"');
  assert.equal(redactCommand('run sk-abcdefghijklmnopqrstuv'), 'run ***');
  assert.equal(redactCommand('run ghp_abcdefghijklmnopqrstuvwxyz0123'), 'run ***');
  assert.equal(redactCommand('prisma studio --url postgres://admin:s3cret@localhost:5432/db'), 'prisma studio --url postgres://admin:***@localhost:5432/db');
  assert.ok(isRedacted(redactCommand('API_KEY=abc npm run dev')));
});
