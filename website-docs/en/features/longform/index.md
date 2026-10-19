---
productId: independent.longform
status: released
lastVerified: 2026-10-19
---
# Step-by-step longform

For novels, web fiction, and ongoing serials. The current engineering path is implemented; literary quality, cost, and long-term results still require author review.

Entry: “Longform → Library → New longform” (长篇 → 作品库 → 新建长篇). Longform owns its work data and prose. A separate world engine is not a prerequisite.

## From an idea to a first draft

1. Set the name and creative goal in Work overview (作品概况).
2. Collect ideas and references in Inspiration and references (灵感与参考); use [document import](/en/guides/import) for an existing novel.
3. Define the core conflict, main plot, and creative rules in Story design (故事设计).
4. Create key characters and motivations in Characters and relationships (人物与关系); add worlds and locations as the plot requires.
5. Plan volumes and chapters in Outline and chapter plans (大纲与章纲), then break the chapter into writable actions in Scene beats (场景细纲).
6. Write, generate, or revise in Prose (正文); review candidates and decide whether to adopt them.
7. Review facts, character states, foreshadowing, and storyline changes introduced by the chapter before continuing.
8. Keep prose exports and full backups in Versions and export (版本与导出).

## Workbench areas

| Area | What it stores | When to use it |
| --- | --- | --- |
| Inspiration and references | Ideas, source works, reference analysis | Before planning or when more evidence is needed |
| Worlds and settings | Rules, environment, society, history | When the story needs a stable background |
| Story design | Story core and creative rules | Before outlining or when the main plot changes |
| Characters and relationships | Profiles and relationships | When establishing or changing characters |
| Outlines and scene beats | Whole-book structure and chapter tasks | Before prose or when changing future direction |
| Prose and revision impact | Manuscript and change impact | Daily writing and revision |
| Foreshadowing, facts, states, inventory, timeline | Established events and continuity | After chapters and before continuation |
| Style learning and Prompts | Writing preferences and task requirements | Adjusting generation style |
| Versions and export | History, prose, and backups | Milestones and before changing devices |

Use these areas as needed. A short realistic scene does not require a power system; a single-world story does not need multi-world mode.

## Choose what to write now

Start from a minimal confirmed idea, or work only on a selected volume, chapter, prose passage, or character field. Tell the companion your scope—for example, “only add the character's motivation” or “write chapter three first; do not change the world.” Review the plan before confirming. Completing every setting first is not required.

Candidates can be read, edited, discussed further, or explicitly declined. Declining optional work should not force you to complete it. If optional post-adoption organization fails, adopted prose remains saved and the follow-up can be recovered separately where offered. Library word counts reflect saved prose; generated drafts are not saved word counts.

## Free discussion and draft writing

Choose Free discussion / Draft writing (自由讨论 / 试写) under Luniang's conversation mode. Explore settings, draft a random scene, or compare versions without completing every form or creating a chapter first. Optionally select world settings, characters, or story core for the current turn; unselected material is not represented as fully read.

Replies stay in this work's conversation and do not automatically change the work. Choose Extract as setting candidates (提取为设定候选) beside a reply, select a category, then AI split entries from content (AI 从内容拆分词条). Check the source and candidates before confirming Write selected (写入所选). Pending candidates can be recovered in the same work and category; refreshing does not repeat the model call. Switch back to Discussion and planning (讨论与规划) to review and start a creative task plan.

Setting lookup (设定查询) in the prose editor keeps search and reading; writing conversations open Luniang. Old unscoped setting-question history appears only after you choose to inspect it. Export the original first if needed, then confirm whether it belongs to the current work. Claiming copies the messages and retains the original; it does not write settings or prose.

## Luniang (炉娘) and voice

The writing companion is now named Luniang (炉娘). Open Assistant and voice settings (助手与语音设置) to adjust visibility, portrait, and voice modes.

- Recognized speech enters an editable input box. Review it before sending; speech does not automatically execute plans or adopt candidates.
- Choose browser recognition or configure a transcription service. Service recordings are limited to 60 seconds and are not stored in the work. Browser recognition may process audio online through the browser vendor.
- Read visible replies or the beginning of prose aloud, up to 2,000 characters per manual request. Automatic reading is off by default; when enabled, it reads up to 400 characters from new replies. Stop at any time; starting speech input also stops playback.
- External transcription or speech services receive the relevant audio or text and may charge fees. Browser support varies; do not assume everything runs offline.

## How AI connects to earlier content

Tasks read relevant confirmed settings, characters, chapter plans, prose evidence, and memory, recording the sources actually used. Summaries locate information; original prose verifies it. Retrieval does not mean the model sees the whole book every time.

After prose edits, old candidates and reviews may become invalid. Check the current generation's evidence before handling stale results, so old output does not overwrite a new manuscript.

Details: [Settings and characters](/en/features/longform/planning) · [Outlines and prose](/en/features/longform/writing) · [Continuity and revision](/en/features/longform/continuity).

## Advanced longform tools

- [Style learning and calibration](/en/features/longform/style-learning): corpus, profile, injection switch, and revision feedback.
- [References and work analysis](/en/features/longform/references): import, research, active analysis versions, and writing references.
- [Character-driven plotting](/en/features/longform/character-driven): arc plans, outline adoption, and active references.
- [Foreshadowing, facts, and knowledge](/en/features/longform/facts-foreshadowing): plans, evidence, character knowledge, and state changes.
- [Multiple worlds, locations, and maps](/en/features/longform/worlds-maps): world scopes, spatial relations, and map candidates.

## Backup and derivation

Prose exports are for reading, submission, and external editing. Complete JSON is for project backup; neither replaces the other. The [local memory workspace](/en/features/memory-workspace) stores supported content as disk files, with synchronization explicitly checked and confirmed by the author.

Longform can explicitly [derive a world](/en/features/world-engine). The original work remains independent; later changes do not synchronize automatically in either direction.

## Current limitations

Engineering-scale validation does not mean “one-click million-word masterpieces.” Metaphor, unregistered foreshadowing, subtle psychology, and literary judgment still need the author. For free composition, read the [node-authoring preview boundaries](/en/features/nodes).
