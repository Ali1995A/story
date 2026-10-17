require('./route-loader.cjs');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let calls;
beforeEach(() => {
  globalThis[Symbol.for('family-ai.guard.v1')]?.clear();
  for (const k of Object.keys(process.env)) if (k.startsWith('AI_GUARD_') || k === 'AI_CALLS_ENABLED') delete process.env[k];
  process.env.ZHIPU_API_KEY = 'test-only-not-a-real-key'; calls = [];
  global.fetch = async (url, init) => { calls.push({url: String(url), init}); throw new Error('Unexpected network'); };
});
function req(body, method = 'POST') { return new Request('https://family.test/api/test', { method, ...(method === 'POST' ? {body: JSON.stringify(body)} : {}) }); }

const names = ['generate','generate-en','generate-bilingual','chat','tts'];
const routes = Object.fromEntries(names.map(n => [n,require('../src/app/api/'+n+'/route.ts')]));
test('every paid story route respects the server pause without touching memory APIs', async () => {
  process.env.AI_CALLS_ENABLED='false';
  for(const name of names) assert.equal((await routes[name].POST(req({seed:'cat',story:'A small cat.',inputText:'hello'}))).status,503,name);
  assert.equal(calls.length,0);
});
test('oversized or malformed audio and histories never call providers', async () => {
  assert.equal((await routes.chat.POST(req({story:'cat',inputAudioBase64:'x'.repeat(800*1024)}))).status,400);
  assert.equal((await routes.chat.POST(req({story:'cat',history:Array(21).fill({content:'hi'})}))).status,400);
  assert.equal((await routes.chat.POST(req({story:'cat',inputAudioBase64:'not base64!'}))).status,400);assert.equal(calls.length,0);
});
test('normal story TTS and voice chat remain usable without login and share the process quota', async () => {
  process.env.ZHIPU_TTS_MODEL='glm-tts'; process.env.AI_GUARD_PER_DAY='2';
  global.fetch = async (url,init) => { calls.push({url,init}); return String(url).endsWith('/audio/speech') ? new Response('audio-test',{headers:{'content-type':'audio/wav'}}) : Response.json({choices:[{message:{content:'Hello little cat!'}}],audio:'dGVzdA==',mime:'audio/wav'}); };
  assert.equal((await routes.tts.POST(req({story:'A small cat.'}))).status,200);
  assert.equal((await routes.chat.POST(req({story:'A small cat.',inputText:'hello'}))).status,200);
  assert.equal((await routes.generate.POST(req({seed:'cat'}))).status,429); assert.equal(calls.length,2);
});
