import test from 'node:test'
import assert from 'node:assert/strict'
import { authorQualityHash } from './narrative-author-quality-contract.mjs'
import { renderAuthorQualityHumanPacket } from './narrative-author-quality-review.mjs'

const packet = () => ({ schema: 'storyforge.narrative-author-quality-blind-packet', version: 1,
  original: '第一段原文。\n\n最后一段原文。', originalHash: authorQualityHash('第一段原文。\n\n最后一段原文。'),
  revisionRequest: '保留完整故事，再续写两章。', accepted: false,
  items: ['甲', '乙'].map(label => {
    const writing = { revisedStory: `${label}修订开头。\n\n${label}修订结尾。`,
      continuation: [1, 2].map(index => ({ title: `${label}第${index}章标题`, text: `${label}第${index}章开头。\n\n${label}第${index}章结尾。` })) }
    return { label, writing, outputHash: authorQualityHash(writing) }
  }) })

test('human view contains every original, revised and continuation paragraph without source identities or scores', () => {
  const source = packet(), html = renderAuthorQualityHumanPacket(source)
  for (const text of [source.original, source.revisionRequest,
    ...source.items.flatMap(item => [item.writing.revisedStory, ...item.writing.continuation.map(chapter => chapter.text)])]) {
    assert.ok(html.includes(text), text)
  }
  assert.ok(html.includes(authorQualityHash(source)))
  assert.ok(!html.includes('original-lexical') && !html.includes('original-ir') && !html.includes('gpt-'))
  assert.ok(html.includes('未计时') && html.includes('无法判断'))
  assert.ok(!html.includes('consistency":4') && !html.includes('accepted":true'))
})

test('story markup remains text and cannot introduce active HTML', () => {
  const source = packet()
  source.original = '<script>alert("story text")</script>&\n<iframe src="https://example.invalid/">'
  source.originalHash = authorQualityHash(source.original)
  const html = renderAuthorQualityHumanPacket(source)
  assert.ok(!html.includes('<script>') && !html.includes('<iframe'))
  assert.ok(html.includes('&lt;script&gt;alert(&quot;story text&quot;)&lt;/script&gt;&amp;'))
  assert.ok(html.includes("default-src 'none'"))
})

test('a changed output or an incomplete pair cannot render as a bound review packet', () => {
  const source = packet(); source.items[0].writing.continuation[1].text += '改动'
  assert.throws(() => renderAuthorQualityHumanPacket(source), /changed/)
  const missing = packet(); missing.items.pop()
  assert.throws(() => renderAuthorQualityHumanPacket(missing), /Invalid blind packet/)
})
