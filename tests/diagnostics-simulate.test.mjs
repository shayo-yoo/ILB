import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../adapters/repository.js';
import { createPipeline } from '../runtime/pipeline.js';
import { createRegistry } from '../runtime/registry.js';

function makePipeline() {
  const ctx = { extensionSettings: {}, characters: [{ avatar: 'a.png', name: 'A' }], characterId: 0, chatId: 'c1', name2: 'A' };
  const repository = createRepository({ getContext: () => ctx });
  const registry = createRegistry();
  const pipeline = createPipeline({ repository, injector: { apply: () => true, clear() {} }, registry });
  return { ctx, repository, pipeline };
}

test('simulate 接受取上下文的函数：不注入也能算出结果', () => {
  const { ctx, repository, pipeline } = makePipeline();
  repository.saveBook({
    book_id: 'b1', name: '书', activation: { strategy: 'always', manual: true }, pool: { share: false },
    entries: [{ id: 'e1', title: '规则', content: '王城的钟声', enabled: true, always: true }],
  });
  const out = pipeline.simulate(() => ctx);
  assert.equal(out.ok, true);
  assert.equal(out.simulated, true);
  assert.ok(Array.isArray(out.diagnostics));
});

test('simulate 也接受上下文对象；拿不到时给人话而不是抛错', () => {
  const { ctx, pipeline } = makePipeline();
  assert.equal(pipeline.simulate(ctx).ok, true);
  const bad = pipeline.simulate(null);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /上下文/);
});
