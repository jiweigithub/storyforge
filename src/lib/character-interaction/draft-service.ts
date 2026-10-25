import { updateWorkTitle } from "../workspace/works";
import { db } from "../db/schema";
import type { WorkspaceScope } from "../types";
import { createWorkspace, workspaceCreationTransactionTablesV1, } from "../workspace/create-workspace";
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord, } from "../workspace/scope";
import { cacheWorldReferenceForProductV1 } from "../world-engine/reference-cache";
import { DEFAULT_CHAT_SETTINGS, parseChatAuthoringSettingsV1, type ChatAuthoringDraftV1, type ChatAuthoringSettingsV1, } from "./authoring-contract";
export async function createChatDraftV1(title: string, settings: ChatAuthoringSettingsV1 = DEFAULT_CHAT_SETTINGS) {
    if (!title.trim() || title.length > 200)
        throw new Error("请填写 1～200 字的 角色聊天 名称");
    const parsed = parseChatAuthoringSettingsV1(settings);
    return db.transaction("rw", [...workspaceCreationTransactionTablesV1(), db.chatAuthoringDrafts], async () => {
        const created = await createWorkspace({
            name: title.trim(),
            description: "",
            genres: [],
            status: "drafting",
            targetWordCount: 10000,
        }, { kind: "character-interaction" });
        const now = Date.now();
        await db.chatAuthoringDrafts.add(stampNewRecord(created.scope, "chatAuthoringDrafts", {
            ...created.scope,
            revision: 0,
            settingsJson: JSON.stringify(parsed),
            conversationJson: "[]",
            worldReleaseId: null,
            productionId: null,
            createdAt: now,
            updatedAt: now,
        }, { owner: "work" }));
        return created;
    });
}
export async function readChatDraftV1(scopeInput: WorkspaceScope): Promise<ChatAuthoringDraftV1> {
    const scope = await resolveScope({ scope: scopeInput });
    const row = await db.chatAuthoringDrafts
        .where("workId")
        .equals(scope.workId)
        .first();
    if (!row ||
        !(await assertRecordInScope(scope, "chatAuthoringDrafts", row, {
            owner: "work",
        })))
        throw new Error("角色聊天 方案不存在或不属于当前作品");
    parseChatAuthoringSettingsV1(JSON.parse(row.settingsJson));
    return row;
}
export async function saveChatDraftV1(scope: WorkspaceScope, revision: number, settings: ChatAuthoringSettingsV1, title?: string) {
    const parsed = parseChatAuthoringSettingsV1(settings);
    if (title !== undefined && (!title.trim() || title.length > 200))
        throw new Error("请填写 1～200 字的作品名称");
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("角色聊天 方案已在其他页面修改，请刷新后再保存");
        const next = {
            ...row,
            settingsJson: JSON.stringify(parsed),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        if (title !== undefined)
            await updateWorkTitle(scope, title);
        return next;
    });
}
export async function selectChatWorldV1(scope: WorkspaceScope, revision: number, releaseId: number) {
    const current = await readChatDraftV1(scope);
    if (current.revision !== revision)
        throw new Error("角色聊天 方案已变化，请刷新后重新选择世界");
    const localId = await cacheWorldReferenceForProductV1(scope, releaseId, { narrativeProductType: 'character-interaction' });
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("角色聊天 方案已变化，请刷新后重新选择世界");
        const next = {
            ...row,
            worldReleaseId: localId,
            settingsJson: JSON.stringify({ ...parseChatAuthoringSettingsV1(JSON.parse(row.settingsJson)), characters: row.worldReleaseId === localId ? parseChatAuthoringSettingsV1(JSON.parse(row.settingsJson)).characters : [] }),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        return next;
    });
}
export interface ChatConversationTurnV1 {
    archived?: boolean;
    id: string;
    question: string;
    answer: string;
    settings: ChatAuthoringSettingsV1 | null;
    runId: number | null;
    error: string;
    createdAt: number;
}
export async function saveChatConversationV1(scope: WorkspaceScope, revision: number, turn: ChatConversationTurnV1) {
    if (turn.question.length > 5000 || turn.answer.length > 12000)
        throw new Error("角色聊天 会谈内容过长");
    if (turn.settings)
        parseChatAuthoringSettingsV1(turn.settings);
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("方案已变化，候选保留在任务记录中，请重新对照当前方案");
        const history = JSON.parse(row.conversationJson) as ChatConversationTurnV1[];
        const next = {
            ...row,
            conversationJson: JSON.stringify([
                ...history.filter((t) => t.id !== turn.id),
                turn,
            ]),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        return next;
    });
}

/** Keep the ledger while starting a fresh consultation on the same saved settings. */
export async function archiveChatConversationV1(scope: WorkspaceScope, revision: number) {
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const row = await readChatDraftV1(scope)
    if (row.revision !== revision) throw new Error('会谈已变化，请刷新后再开始新会谈')
    const history = JSON.parse(row.conversationJson) as ChatConversationTurnV1[]
    const next = {...row, conversationJson: JSON.stringify(history.map(turn => ({...turn, archived: true}))), revision: revision + 1, updatedAt: Date.now()}
    await db.chatAuthoringDrafts.put(next)
    return next
  })
}
