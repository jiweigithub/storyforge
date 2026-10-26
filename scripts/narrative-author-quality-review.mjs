import { authorQualityHash, validateAuthorQualityBlindPacket } from './narrative-author-quality-contract.mjs'

const html = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/** A derived, read-only view of exact blind outputs. It never receives the
 * condition key, model metadata, automatic scores or a human approval. */
export function renderAuthorQualityHumanPacket(packet) {
  validateAuthorQualityBlindPacket(packet)
  const prose = (id, title, value) => `<section id="${id}"><h2>${html(title)}</h2><pre>${html(value)}</pre></section>`
  const variants = packet.items.map(item => `<article id="variant-${item.label}">
<h1>版本${item.label}</h1>
${prose(`${item.label}-revision`, '修订后的完整故事', item.writing.revisedStory)}
${item.writing.continuation.map((chapter, index) => prose(`${item.label}-chapter${index + 1}`,
    `续写第${index + 1}章 · ${chapter.title}`, chapter.text)).join('\n')}
</article>`).join('\n')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>完整故事修订与续写 · 盲评材料</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f2ec;color:#242a28;font-family:system-ui,sans-serif}
nav{position:sticky;top:0;padding:12px 20px;background:#f4f2ecf5;border-bottom:1px solid #d8dcd5;display:flex;gap:20px;flex-wrap:wrap;z-index:1}
a{color:#245f52}main{max-width:900px;margin:auto;padding:36px 28px 80px}h1{font-size:28px;margin:0 0 20px}h2{font-size:22px;margin:0 0 18px}
p,li{font-size:16px;line-height:1.8}section,article{scroll-margin-top:75px}section{margin:32px 0;padding:30px;background:#fff;border:1px solid #e0e3dd;border-radius:8px}
article{margin-top:64px}pre{font-family:"Songti SC","Noto Serif SC",serif;font-size:20px;line-height:1.95;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.request pre,.reply pre{font-family:system-ui,sans-serif;font-size:16px;line-height:1.9}details{margin-top:48px;color:#626a66;font-size:13px;overflow-wrap:anywhere}
@media(max-width:600px){main{padding:24px 14px 60px}section{padding:20px 18px}pre{font-size:19px}nav{gap:14px}}
@media print{nav{display:none}body{background:white}main{max-width:none;padding:0}section{border:0;padding:0}article{break-before:page}details{display:none}}
</style></head><body><nav aria-label="材料导航"><a href="#original">原文</a><a href="#request">修改要求</a><a href="#variant-甲">版本甲</a><a href="#variant-乙">版本乙</a><a href="#review">评阅说明</a></nav>
<main><h1>完整故事修订与续写 · 盲评材料</h1>
<p>请阅读同一原文和修改要求，分别评阅甲、乙的完整修订稿及两章续写。两份稿件的来源标签和其他评阅意见在此隐藏。原文和稿件均按回执中的完整文字展示。</p>
${prose('original', '完整原文', packet.original)}
<div class="request">${prose('request', '本次修改要求', packet.revisionRequest)}</div>
${variants}
<section id="review"><h2>评阅说明</h2>
<p>请分别给甲、乙的一致性、人物动机与表现、编辑接受度打 1～5 分，并指出判断所依据的原文或稿件语句。</p>
<ul><li>1：严重不符或不可用；2：明显问题较多；3：需实质修改；4：少量修改可接受；5：未发现实质问题。</li>
<li>另外比较各稿与原文的一致性，明确选择“未下降”“下降”或“无法判断”。本次明确要求改变的情节本身不算矛盾。</li>
<li>列出无法由修改要求、人物视角或续写的新情节解释的硬矛盾；没有发现时可明确写“未发现”。错误信念、隐瞒和多义台词应结合原文判断。</li>
<li>保留你实际做出的改动；无需修改时明确写“无需修改”。用时请按实际记录填写，未计时就写“未计时”。空白不计作零改动或零用时。</li></ul>
<p>可以在当前对话中按下列格式回复。你尚未完成的项可以留空或写“无法判断”；材料本身不会生成评审结论。</p>
<div class="reply"><pre>甲：一致性 __/5；人物动机 __/5；接受度 __/5。
相较原文的一致性：__。判断依据与原句：__。
硬矛盾：__。实际改动：__。评阅与修改用时：__。

乙：一致性 __/5；人物动机 __/5；接受度 __/5。
相较原文的一致性：__。判断依据与原句：__。
硬矛盾：__。实际改动：__。评阅与修改用时：__。</pre></div></section>
<details><summary>材料身份</summary><p>盲评包 SHA-256：${authorQualityHash(packet)}</p>
${packet.items.map(item => `<p>版本${item.label}输出 SHA-256：${item.outputHash}</p>`).join('')}
<p>这是供阅读的派生视图；正式依据是绑定这些身份的原始回执。本材料未包含任何真人评分或质量通过结论。</p></details>
</main></body></html>\n`
}
