import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { WorkspaceScope } from "../../lib/types";
import type { ChatAuthoringDraftV1, ChatAuthoringSettings, } from "../../lib/character-interaction/authoring-contract";
import { consultChatV1 } from "../../lib/character-interaction/consultation";
import { archiveChatConversationV1, type ChatConversationTurnV1 } from "../../lib/character-interaction/draft-service";
import { useAIConfigStore } from "../../stores/ai-config";
import { isAIConfigReady } from "../../lib/ai/config-readiness";
import { readLatestVerifiedAgentRunCheckpointV1 } from "../../lib/agent/run/checkpoint";
const LABELS: Record<string, string> = {
    playerRole: "玩家身份",
    openingSituation: "开场目标",
    experience: "体验重点",
    mode: "聊天模式",
    maxTurns: "场景回合数",
    replyBudget: "场景回复预算",
    maxMemoryEntries: "关键记忆上限",
    relationshipThreshold: "重大关系变化阈值",
    contentBoundaries: "内容边界",
    characters: "角色专属设置",
    targetPlayMinutes: "游玩分钟",
    qualityProfile: "制作质量",
};
const VALUES: Record<string, string> = {
    single: "单角色",
    multi: "多角色",
    prototype: "原型",
    internal: "内部评审",
    "commercial-candidate": "商业候选",
};
export default function Consultation({ scope, draft, onConfirm, onSource, }: {
    scope: WorkspaceScope | null;
    draft?: ChatAuthoringDraftV1;
    settings: ChatAuthoringSettings;
    onConfirm: (value: ChatAuthoringSettings) => void;
    onSource: () => void;
}) {
    const config = useAIConfigStore((s) => s.config);
    const [question, setQuestion] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovered, setRecovered] = useState<ChatConversationTurnV1 | null>(null);
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const turns = draft
        ? (JSON.parse(draft.conversationJson) as ChatConversationTurnV1[])
        : [];
    const send = async () => {
        if (!scope || busy)
            return;
        setBusy(true);
        setError("");
        controller.current = new AbortController();
        try {
            await consultChatV1({
                scope,
                question,
                config,
                signal: controller.current.signal,
            });
            setQuestion("");
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const candidate = recovered ?? [...turns].reverse().find((t) => !t.archived && t.settings);
    return (<div className="avg-consult">
      <section className="lf-paper">
        <h3>角色聊天 主 Agent</h3>
        <p>
          一起确定聊天对象、玩家身份、场景、关系与记忆边界。建议先成为候选，确认后才回填制作方案。世界事实会在确认制作时通过所选出口校验。
        </p>
        {!scope || !draft ? (<p>请先保存一份制作方案，再开始可恢复的会谈。</p>) : (<>
            {!draft.worldReleaseId && (<button className="lf-action" onClick={onSource}>
                选择世界（也可先讨论方案）
              </button>)}

            {turns.some(t => t.archived) && <details><summary>历史会谈（保留记录）</summary>{turns.filter(t => t.archived).map(t => <article key={t.id}><p>{t.question}</p><p>{t.answer || t.error}</p></article>)}</details>}
            <button className="lf-action" disabled={busy || !turns.some(t=>!t.archived)} onClick={()=>{setError('');void archiveChatConversationV1(scope,draft.revision).then(()=>setRecovered(null)).catch(e=>setError(String(e)))}}>归档并开始新会谈</button><div className="avg-messages">
              {turns.filter(t => !t.archived).map((t) => (<article key={t.id}>
                  <h4>你</h4>
                  <p>{t.question}</p>
                  <h4>主 Agent</h4>
                  <p>
                    {t.answer ||
                    t.error ||
                    "此轮尚无回复；若刷新或关闭中断，可查看已保存的候选。"}
                  </p>
                  {t.runId && !t.answer && (<button className="lf-action" onClick={() => void readLatestVerifiedAgentRunCheckpointV1(scope, t.runId!)
                        .then((r) => {
                        if (r?.resumePayload)
                            setRecovered(r.resumePayload as ChatConversationTurnV1);
                        else
                            setError("没有完成的候选，请重新发送本轮问题。");
                    })
                        .catch((e) => setError(String(e)))}>
                      恢复已生成候选
                    </button>)}
                </article>))}
            </div>
            <label>
              你的想法
              <textarea aria-label="角色聊天 会谈输入" value={question} maxLength={5000} onChange={(e) => setQuestion(e.target.value)}/>
            </label>
            {!isAIConfigReady(config) && (<p>
                尚未配置文本模型。<Link to="/home/settings">打开全局设置</Link>
              </p>)}
            <div className="avg-actions">
              <button className="lf-action lf-action-primary" disabled={busy || !question.trim() || !isAIConfigReady(config)} onClick={() => void send()}>
                {busy ? "会谈中…" : "发送"}
              </button>
              {busy && (<button className="lf-action" onClick={() => controller.current?.abort()}>
                  停止
                </button>)}
            </div>
          </>)}
        {error && <p role="alert">{error}</p>}
      </section>
      <aside className="lf-paper">
        <h3>待确认方案</h3>
        {candidate?.settings ? (<>
            <p>{candidate.answer}</p>
            <dl>
              {Object.entries(candidate.settings)
                .filter(([key]) => key !== "version")
                .map(([key, value]) => (<div key={key}>
                    <dt>{LABELS[key]}</dt>
                    <dd>
                      {Array.isArray(value) ? value.map(c => `${c.sourceKey}：信任 ${c.initialTrust}；${c.voiceRules}；私密知识 ${c.privateKnowledge ? "已配置" : "未填写"}`).join("；") : VALUES[String(value)] || String(value) || "尚未填写"}
                    </dd>
                  </div>))}
            </dl>
            <button className="lf-action lf-action-primary" disabled={busy} onClick={() => onConfirm(candidate.settings!)}>
              确认并回填制作方案
            </button>
          </>) : (<p>尚无候选。填写你的想法，主 Agent 会提出可以继续调整的方案。</p>)}
      </aside>
    </div>);
}
