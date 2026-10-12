---
title: StoryForge QQ bot guide
description: Project Q&A, update notifications, text-to-image commands, queues and privacy
lastVerified: 2026-10-12
---

# StoryForge QQ bot guide

The QQ group bot **故事熔炉bot** provides **StoryForge project Q&A, update notifications and text-to-image generation**. This guide applies to groups where a maintainer has added and configured the bot. Its running features were checked on **October 12, 2026**.

The bot runs independently. Group members do not need to provide a model API key, and the bot cannot read or operate works saved in your StoryForge app. For models inside the app, see [model and API configuration](/en/getting-started/model-config).

## 1. Mention the bot

Type `@` in QQ and select **故事熔炉bot** from the member list. You can search using characters such as 故事 or 熔炉, then select the bot and enter your question or command.

**Select the actual bot mention.** Copying the literal `@故事熔炉bot` from these examples may not trigger it. The bot does not interrupt ordinary chat; questions and commands require a mention.

## 2. Project Q&A

Mention the bot and ask directly, without another command:

```text
@故事熔炉bot What is StoryForge, and how should a new user start?
@故事熔炉bot How do I configure a model?
@故事熔炉bot How do I back up and export my work?
@故事熔炉bot What features have changed recently?
```

Topics include project basics, features and limitations, getting started, installation, model configuration, backup and export, common problems and development progress. For troubleshooting, describe the **feature, steps and error text**.

Ordinary Q&A currently processes only the first **1,000 characters** of each question. Summarize long error reports first, then provide necessary details in follow-up questions; this limit does not apply to image descriptions.

The bot can use relevant group discussion from the previous **10 minutes**, but does not remember every message or maintain long-term chat memory. Answers use the public knowledge base and GitHub; members' statements are not substitutes for verified project facts.

Synchronization takes time and answers can be wrong. Main-branch changes, tagged releases and live website deployments are different states; an answer is not a promise that a feature is live.

## 3. Public commands

Mention the bot before every command. The command keywords remain in Chinese in both languages.

| Command | Purpose |
| --- | --- |
| `/帮助` | Show ordinary-member help and commands |
| `/状态` | Show Q&A availability, update subscription and knowledge synchronization status |
| `/最新` | Show the most recently synchronized main branch, release and website update records |
| `/生图 description` | Generate one image from a complete text description |

Example: `@故事熔炉bot /最新`.

## 4. Text-to-image generation

### Basic use and resolution

```text
@故事熔炉bot /生图 An orange cat looking at stars beside a window, picture-book style, no text
@故事熔炉bot /生图 16:9 A floating city above a sea of clouds, morning light, cinematic
@故事熔炉bot /生图 4K 2:3 An adult wearing a dark blue trench coat, full body, both feet and shoes fully visible, realistic photography
```

- Each request generates **one image**, sent directly to the group without an image link.
- Without explicit settings, the **aspect ratio follows the description and resolution defaults to 2K**. You can select `1K, 2K, 3K or 4K`; resolution and ratio options can appear in either order.
- Supported ratios: `1:1, 16:9, 9:16, 3:4, 4:3, 2:3, 3:2 and 21:9`. These are provider-supported ratios and resolution tiers, not a promise of arbitrary exact pixel dimensions.
- **The bot imposes no prompt character limit and does not deliberately truncate image descriptions.** QQ's single-message limits and provider limits still apply. Prioritize essential requirements and avoid repetition or contradictions in long prompts.
- `/生图，description` and `/生图：description` also work. Use the `/生图` command; an ordinary request such as “draw something for me” does not start generation.
- Only **text-to-image** is supported. Reference-image editing is unavailable, and neither group images nor recent group discussion is automatically added to an image prompt. Put the complete requirements into each command.

### Automatic prompt refinement

Before generation, the bot fills in unspecified composition, ratio, style, background, lighting and quality requirements. It retains the complete original description, and **explicit user requirements take priority**.

For example, a person description requiring heels, stockings or leg details without a crop instruction favors a full-body composition. An explicit half-body request stays half-body. If shoes must appear, explicitly ask for “full body, both feet and shoes fully visible”; do not simultaneously request a half-body portrait.

If refinement fails, a basic template is used and the result identifies this fallback. Agnes handles both refinement and image generation; it cannot guarantee that every image will reproduce every detail accurately.

### Queue and result attribution

A request is accepted only when the bot says it **has joined the image queue** and gives a task number. The acknowledgement also shows how many tasks are ahead.

- One member can submit **different descriptions consecutively**, such as orange, yellow and black cats, without waiting for the previous image.
- Only one image is generated globally at a time, in arrival order. Limits are **5 unfinished tasks per member in a group, 10 per group and 20 globally**.
- The same member's identical description is not accepted again while queued or generating; there is also a 60-second repeat interval after acceptance. Different descriptions do not share this interval, and different members can submit the same description separately.
- A duplicate or full queue produces a reason and says **this request did not join the queue**. It will not be added later automatically; resubmit when eligible. Reason notices are limited to one per member every 30 seconds, so repeated submissions do not generate continuous warnings.
- The **image, task number, description summary and sender nickname (when QQ provides it) are combined into one image-and-text result**. Attribution uses plain nicknames; reliable native QQ mention notifications and visible references to the original command are not implemented. Match images using task numbers and descriptions.

Queue waiting time is additional. Refinement and generation may take tens of seconds or longer, rather than returning instantly. Do not resubmit an accepted task because its image has not arrived yet. A long queue can also exceed QQ's window for replying to the original command; delivery depends on platform permissions and limits.

### Upload and delivery failures

| Notice or situation | Meaning and action |
| --- | --- |
| Retrying the upload once | Generation finished, but a temporary network error interrupted upload to QQ. The same image will be uploaded once more; wait |
| Image generated, but QQ upload failed | Upload still failed; the image was not sent to the group and the task ended. Resubmit later |
| QQ rejected delivery, with an error code | Generation and upload finished, but QQ rejected the final group message. The task ended; adjust the description or provide the maintainer with the task number and error code |
| Generation result uncertain | A generation API or another step returned no confirmable result. Generation is not repeated automatically; check group messages before deciding whether to resubmit |
| No reply | Check that you selected the bot mention and used `/生图`. Check queue/rejection notices, wait, then query `/状态`; avoid repeated submissions |

A temporary upload failure allows at most one additional upload, each with a 60-second deadline. This reuses the generated image and **does not generate it again**. Permission, quota and explicit rejections are not automatically retried; uncertain final delivery is not blindly resent. A definite failure releases the description's repeat protection and the next queued task can continue. A maintainer pause or a restart during generation may stop tasks without automatically generating them again.

## 5. Updates and knowledge synchronization

After a maintainer enables the group's update subscription:

- The knowledge-base changelog is checked every day at **20:00 Beijing time (UTC+8)**, with notifications only for newly added records.
- GitHub main-branch and release changes are checked separately, normally about every **5 minutes**.
- Records from before subscription are not replayed. Editing the body of an existing record alone does not trigger a new-record notification.
- QQ must allow proactive bot messages; permissions and sending limits also affect delivery. If a notification is missing, mention the bot with `/最新` to query actively.

The Q&A knowledge collection is fully synchronized about every **30 minutes**, and the changelog page normally refreshes about every **5 minutes**. Network failures preserve previous information; clearly overdue data is marked as potentially stale. A newly published guide does not enter the Q&A index immediately in every case.

## 6. Flood protection and privacy

- There is no daily Q&A request cap. Ordinary Q&A has **10-second group and 15-second member intervals**, plus queue and outbound limits. Excessively frequent requests may be silently ignored.
- Image requests use the separate queue and duplicate rules above. An upload retry does not call the image model again.
- All bot text sent to groups excludes links; sources show document names only. Links on this web page are for reading in the knowledge base.
- Ordinary group discussion from the previous 10 minutes is temporarily retained in server memory, expires, and clears on restart. There is no long-term group-chat history. Pending mentioned questions and image descriptions temporarily enter a private server task queue; original text is removed when processing completes or ends. Operational records, including task numbers, states, send receipts and some sender nicknames, remain.
- For Q&A, **the current question, relevant recent discussion and public sources are sent to Agnes**. Image descriptions are sent to Agnes for refinement and generation. Generated images stay in memory and are uploaded to QQ for group delivery, rather than written to the website or project knowledge base. Save images received in QQ yourself if you need long-term copies.

**Do not submit API keys, passwords, private manuscripts or other sensitive information.** The bot cannot operate servers, modify the project, run administrative tasks, or directly access personal works or local files. Its image service does not mean that the StoryForge web app automatically provides the same service.
