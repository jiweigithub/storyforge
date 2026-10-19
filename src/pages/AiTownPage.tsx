import BrandIcon from '../components/shared/BrandIcon'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { liveQuery } from "dexie";
import { BookOpen } from "lucide-react";
import { db } from "../lib/db/schema";
import type {
  Project,
  Work,
  WorkspaceScope,
  ProductProductionSourceSelectionV1,
} from "../lib/types";
import {
  defaultAiTownSettings,
  settingsFromAiTownDraft,
  type AiTownAuthoringDraftV1,
} from "../lib/ai-town/authoring-contract";
import {
  createAiTownDraft,
  saveAiTownDraft,
  selectAiTownWorld,
  readAiTownDraft,
  prepareAiTownBrief,
  saveAiTownSourceSelection,
} from "../lib/ai-town/authoring-service";
import { consultProductProductionStartV1 } from "../lib/product-production/service";
import { listLocalWorldReferenceChoicesV1 } from "../lib/world-engine/reference-cache";
import { updateWorkspace } from "../lib/workspace/works";
import { exportProjectJSON, downloadJSON } from "../lib/export/json-export";
import { PRODUCT_NAVIGATION } from "../components/navigation/product-navigation";
import {
  TOWN_PAGES,
  TOWN_PRIMARY,
  TOWN_SETUP_PAGES,
  TOWN_BUILD_PAGES,
  TOWN_PLAY_PAGES,
  townPrimary,
} from "../components/ai-town/author-navigation";
import AuthorSettings from "../components/ai-town/AuthorSettings";
import { parseProductProductionHandoffV1 } from "../lib/product-production/handoff";
import "../components/longform/longform.css";
import "../components/avg/avg.css";
import "../components/ai-town/author.css";
const Studio = lazy(
  () => import("../components/product/ProductProductionStudio"),
);
const Player = lazy(() => import("../components/ai-town/AuthorPlayer"));
const Community = lazy(() => import("../components/community/CommunityPrototypeGallery"));
const Proposal = lazy(() => import("../components/ai-town/Consultation"));
const Inspector = lazy(() => import("../components/ai-town/AuthorInspector"));
const Outlet = lazy(
  () => import("../components/world-engine/WorldResourceBrowser"),
);
import { flushPendingEditsV1 } from "../lib/authoring/pending-edit-coordinator";
const PRODUCTS = ["ai-town"] as const;
type Row = {
  project: Project;
  work: Work;
  draft?: AiTownAuthoringDraftV1;
  productionId?: number;
};
export default function AiTownPage() {
  const { pageId = "library" } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const page = TOWN_PAGES.find((p) => p[0] === pageId) ?? TOWN_PAGES[0],
    primary = townPrimary(page[0]);
  const projectId = Number(params.get("project")) || null,
    workId = Number(params.get("work")) || null;
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [innerMenu, setInnerMenu] = useState(false);
  const [settings, setSettings] = useState(defaultAiTownSettings),
    [title, setTitle] = useState(""),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState("");
  const [worlds, setWorlds] = useState<
    Awaited<ReturnType<typeof listLocalWorldReferenceChoicesV1>>
  >([]);
  const [sources, setSources] = useState<Awaited<
      ReturnType<typeof consultProductProductionStartV1>
    > | null>(null),
    [selection, setSelection] =
      useState<ProductProductionSourceSelectionV1 | null>(null),
    [suggestionKey, setSuggestionKey] = useState("");
  const [sourceDirty,setSourceDirty]=useState(false);
  const row = rows.find(
    (r) => r.project.id === projectId && (!workId || r.work.id === workId),
  );
  const rowProjectId = row?.project.id, rowWorldId = row?.work.worldId, rowWorkId = row?.work.id;
  const scope = useMemo<WorkspaceScope | null>(() =>
    rowProjectId != null && rowWorldId != null && rowWorkId != null
      ? { projectId: rowProjectId, worldId: rowWorldId, workId: rowWorkId }
      : null,
    [rowProjectId, rowWorldId, rowWorkId],
  );
  const productionId =
    Number(params.get("production")) ||
    row?.draft?.productionId ||
    row?.productionId ||
    null;
  const onProductionSelected = useCallback((id: number | null) => {
    if (id == null || id === productionId) return;
    const next = new URLSearchParams(params);
    next.set("production", String(id));
    navigate(`/town/${pageId}?${next}`, { replace: true });
  }, [navigate, params, pageId, productionId]);
  const sessionId = Number(params.get("session")) || null;
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [pageId]);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const [projects, works, drafts, productions] = await Promise.all([
        db.projects.toArray(),
        db.works.toArray(),
        db.aiTownAuthoringDrafts.toArray(),
        db.productProductions.toArray(),
      ]);
      return works
        .flatMap((work) => {
          const project = projects.find((p) => p.id === work.projectId),
            production = productions
              .filter((p) => p.workId === work.id && p.productType === "ai-town")
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return project && (work.kind === "ai-town" || production)
            ? [
                {
                  project,
                  work,
                  draft: drafts.find((d) => d.workId === work.id),
                  productionId: production?.id,
                },
              ]
            : [];
        })
        .sort((a, b) => b.work.updatedAt - a.work.updatedAt);
    }).subscribe({
      next: (v) => {
        setRows(v);
        setLoading(false);
      },
      error: (e) => {
        setError(String(e));
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, []);
  useEffect(() => {
    if (!dirty) {
      setSettings(
        row?.draft ? settingsFromAiTownDraft(row.draft) : defaultAiTownSettings(),
      );
      setTitle(row?.work.title ?? "");
    }
  }, [row?.work.id, row?.draft?.revision, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void listLocalWorldReferenceChoicesV1()
      .then(setWorlds)
      .catch((e) => setError(String(e)));
  }, [pageId]);
  useEffect(() => {
    let active = true;
    setSources(null);
    setSelection(null);
    if (scope && row?.draft?.worldReleaseId)
      void consultProductProductionStartV1({
        scope,
        worldReleaseId: row.draft.worldReleaseId,
      })
        .then((v) => {
          if (!active) return;
          setSources(v);
          const key =
            row.draft?.suggestionKey ??
            v.suggestions.find((s) =>
              s.recommendedProductTypes.includes("ai-town"),
            )?.suggestionKey ??
            v.suggestions[0]?.suggestionKey ??
            "";
          setSuggestionKey(key);
          setSelection(
            row.draft?.selectionJson
              ? JSON.parse(row.draft.selectionJson)
              : (v.selectionDefaults[key] ?? null),
          );
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [
    scope,
    row?.draft?.worldReleaseId,
    row?.draft?.selectionJson,
    row?.draft?.suggestionKey,
  ]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || sourceDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty,sourceDirty]);
  const path = (id: string, target = row, extra = "") =>
    `/town/${id}${target ? `?project=${target.project.id}&work=${target.work.id}${target === row && productionId && !extra.includes("production=") ? `&production=${productionId}` : ""}${extra}` : ""}`;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (loading || (projectId && !row)) throw new Error("作品正在加载或已不存在，请从作品库重新选择");
    if (row && scope && row.draft) {
      await saveAiTownDraft(
        scope,
        row.draft.revision,
        settings,
        title || "未命名小镇",
      );
      setDirty(false);
      return row;
    }
    if (row)
      throw new Error(
        "此作品已有旧制作记录，请在制作流程中继续；新配置请从作品库新建",
      );
    const made = await createAiTownDraft(title || "未命名小镇", settings);
    const target = { project: made.project, work: made.work };
    setDirty(false);
    return target;
  };
  const saveSource=async()=>{if(!sourceDirty)return;if(!scope||!row?.draft||!selection)throw new Error('请先选择世界版本');await saveAiTownSourceSelection(scope,row.draft.revision,suggestionKey,selection);setSourceDirty(false);};
  const leave = (url: string) => void run(async () => {
    await flushPendingEditsV1();
    await saveSource();
    if (dirty) await save();
    navigate(url);
  });
  const go = (id: string) =>
    void run(async () => {
      await flushPendingEditsV1();
      await saveSource();
      const target = dirty ? await save() : row;
      setMenu(false);
      setInnerMenu(false);
      navigate(
        path(
          id,
          target,
          sessionId && TOWN_PLAY_PAGES.some((p) => p[0] === id)
            ? `&session=${sessionId}`
            : "",
        ),
      );
    });
  const step = TOWN_SETUP_PAGES.findIndex((p) => p[0] === page[0]);
  const needsSource = (
    <section className="lf-paper">
      <h3>开始制作，需要一个世界引擎</h3>
      <p>可以继续填写和保存配置。正式制作前，请选择一个已封存的世界版本。</p>
      <button
        className="lf-action lf-action-primary"
        onClick={() => go("source")}
      >
        选择世界引擎
      </button>
    </section>
  );
  const compile = () =>
    void run(async () => {
      const target = dirty || !row ? await save() : row;
      const targetScope = {
        projectId: target.project.id!,
        worldId: target.work.worldId,
        workId: target.work.id!,
      };
      const latest = await readAiTownDraft(targetScope);
      if (!latest.worldReleaseId) {
        navigate(path("confirm", target));
        throw new Error("需要一个世界引擎；配置已保存，请到世界引擎页选择版本");
      }
      const id = await prepareAiTownBrief(targetScope, latest.revision);
      navigate(path("production", target, `&production=${id}`));
      setNotice("审查方案已保存，核对后明确授权才会开始制作。");
    });
  let handoffId: number | null = null,
    handoffError = "";
  try {
    const raw = params.get("worldHandoff");
    if (raw) {
      const handoff = parseProductProductionHandoffV1(JSON.parse(raw));
      if (handoff.productType !== "ai-town") throw new Error("交接产品不匹配");
      handoffId = handoff.worldReleaseId;
      if (
        worlds.some(
          (w) => w.id === handoffId && w.hash !== handoff.worldContentHash,
        )
      )
        throw new Error("交接版本不一致");
    }
  } catch (e) {
    handoffError = String(e);
  }
  return (
    <div
      className={`longform-app avg-app town-author-app ${menu ? "lf-navigation-open" : ""} ${innerMenu ? "lf-step-menu-open" : ""}`}
      data-testid="town-author-page"
    >
      <header className="lf-top">
        <Link className="lf-brand" to="/" onClick={(event) => { event.preventDefault(); leave("/"); }}>
          <BrandIcon/>
          <span>
            <strong>StoryForge</strong>
            <small>故事熔炉</small>
          </span>
        </Link>
        <nav aria-label="产品导航">
          {PRODUCT_NAVIGATION.map((p) => (
            <Link
              key={p.id}
              to={p.path}
              onClick={(event) => { event.preventDefault(); leave(p.path); }}
              aria-current={p.id === "town" ? "page" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="lf-sidebar">
        <small>AFTERSTORY TOWN</small>
        <h1>AI 小镇</h1>
        <p>让故事之后的生活，慢慢生长。</p>
        <button className="lf-current" onClick={() => go("library")}>
          <BookOpen />
          {row?.work.title ?? "选择或新建小镇"}
        </button>
        <nav aria-label="AI 小镇页面导航">
          {TOWN_PRIMARY.map(([id, label, entry]) => (
            <button
              key={id}
              aria-current={primary === id ? "page" : undefined}
              onClick={() => go(entry)}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() =>
              void run(async () => {
                await flushPendingEditsV1();
                await saveSource();
                if (dirty) await save();
                navigate("/home/settings");
              })
            }
          >
            通用设置
          </button>
        </nav>
      </aside>
      <section className="lf-main">
        <header className="lf-heading">
          <small>
            AI 小镇 › {TOWN_PRIMARY.find((p) => p[0] === primary)?.[1]} ›{" "}
            {page[1]}
            {row ? ` · ${row.work.title}` : ""}
          </small>
          <h2>{TOWN_PRIMARY.find((p) => p[0] === primary)?.[1]}</h2>
            {!["library", "player", "community"].includes(primary) && (
              <nav className="avg-phases" aria-label="制作阶段">
                {[
                  ["source", "S1 · 世界封存"],
                  ["vision", "S2 · 产品定向"],
                  ["production", "S3 · 产品执行"],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => go(id)}>
                    {label}
                  </button>
                ))}
              </nav>
            )}
          <div className="lf-mobile-controls">
            <button
              onClick={() => {
                setMenu(!menu);
                setInnerMenu(false);
              }}
            >
              AI 小镇目录
            </button>
            {["workbench", "player"].includes(primary) && (
              <button
                onClick={() => {
                  setInnerMenu(!innerMenu);
                  setMenu(false);
                }}
              >
                内容目录
              </button>
            )}
          </div>
        </header>
        <div
          className={`lf-body ${["workbench", "player"].includes(primary) ? "lf-with-steps" : ""}`}
        >
          {["workbench", "player"].includes(primary) && (
            <aside className="lf-steps avg-content-sidebar">
              <nav aria-label="AI 小镇内容导航">
                {(primary === "workbench"
                  ? [
                      {
                        label: "S2 · 方案与配置",
                        pages: [...TOWN_SETUP_PAGES.slice(0, -1), ["agent", "方案会谈"], TOWN_SETUP_PAGES[4]],
                      },
                      { label: "S3 · 制作与检查", pages: TOWN_BUILD_PAGES },
                    ]
                  : [{ label: "游玩与团局", pages: TOWN_PLAY_PAGES }]
                ).map((g) => (
                  <section key={g.label}>
                    <h3>{g.label}</h3>
                    {g.pages.map(([id, label]) => (
                      <button
                        key={id}
                        aria-current={page[0] === id ? "page" : undefined}
                        onClick={() => go(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </section>
                ))}
              </nav>
            </aside>
          )}
          <main className="lf-content" ref={content}>

            {error && (
              <p className="avg-alert" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {loading ? (
              <p>读取AI 小镇作品…</p>
            ) : (
              <Suspense fallback={<p>打开功能…</p>}>
                {page[0] === "library" ? (
                  <>
                    <section className="lf-paper">
                      <div className="avg-actions">
                        <button
                          className="lf-action lf-action-primary"
                          onClick={() => {
                            setDirty(false);
                            setSettings(defaultAiTownSettings());
                            setTitle("");
                            navigate("/town/vision");
                          }}
                        >
                          新建小镇
                        </button>
                        <input
                          aria-label="搜索小镇"
                          placeholder="搜索小镇名称"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <p>先规划，再制作。作品版本与每一场生活分别保存。</p>
                    </section>
                    <div className="lf-library-grid">
                      {rows
                        .filter((r) => r.work.title.includes(search))
                        .map((r) => (
                          <article className="lf-paper" key={r.work.id}>
                            <small>
                              {r.draft ? "制作方案" : "已有AI 小镇作品"}
                            </small>
                            <h3>{r.work.title}</h3>
                            <p>
                              {r.draft?.worldReleaseId
                                ? "已引用世界版本"
                                : "可先规划小镇"}
                            </p>
                            <div className="avg-actions">
                              <Link
                                className="lf-action"
                                to={path(r.draft ? "vision" : "production", r)}
                              >
                                继续制作
                              </Link>
                              <Link className="lf-action" to={path("play", r)}>
                                游玩与存档
                              </Link>
                            </div>
                          </article>
                        ))}
                    </div>
                    {!rows.length && (
                      <section className="lf-paper">
                        <h3>你的第一场生活</h3>
                        <p>
                          还没有自己的小镇，可以先进入制作台填写，或者游玩社区作品。
                        </p>
                      </section>
                    )}
                    <Community productType="ai-town" onImported={release => navigate(`/town/play?project=${release.projectId}&work=${release.workId}`)} />
                  </>
                ) : step >= 0 ? (
                  <>
                    <section className="lf-paper">
                      <h3>{page[1]}</h3>
                      <p>
                        保存配置不会调用模型或开始制作。未选择世界时也可以填写。
                      </p>
                      <fieldset
                        disabled={busy || Boolean(row && !row.draft)}
                        className="avg-form"
                      >
                        <label>
                          小镇名称
                          <input
                            aria-label="小镇名称"
                            value={title}
                            maxLength={200}
                            onChange={(e) => {
                              setTitle(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        <AuthorSettings settings={settings} page={page[0]} onChange={s=>{setSettings(s);setDirty(true)}}/>
                        <div className="avg-actions">
                          <button
                            className="lf-action lf-action-primary"
                            onClick={() =>
                              void run(async () => {
                                const target = await save();
                                navigate(path(page[0], target), {
                                  replace: true,
                                });
                                setNotice("制作配置已保存");
                              })
                            }
                          >
                            保存制作方案
                          </button>
                          {step === 4 ? (
                            <button className="lf-action" onClick={compile}>
                              生成或更新审查方案
                            </button>
                          ) : null}
                        </div>
                      </fieldset>
                      {row && !row.draft && (
                        <button
                          className="lf-action"
                          onClick={() => go("production")}
                        >
                          继续已有制作记录
                        </button>
                      )}
                    </section>
                    {step === 4 && row?.draft && !row.draft.worldReleaseId
                      ? needsSource
                      : null}
                    {step === 4 && productionId && (
                      <section className="lf-paper">
                        <p>
                          已有审查方案。修改配置后请先更新方案；正式开始在制作流程中单独授权。
                        </p>
                        <button
                          className="lf-action"
                          onClick={() => go("agent")}
                        >
                          讨论制作方案
                        </button>
                        <button
                          className="lf-action"
                          onClick={() => go("production")}
                        >
                          打开制作流程
                        </button>
                      </section>
                    )}
                  </>
                ) : page[0] === "source" ? (
                  <>
                    <section className="lf-paper">
                      <h3>世界版本与本小镇的数据出口</h3>
                      <p>调整读取范围，不修改原世界；没有世界也可继续配置。</p>
                      <Link className="lf-action" to="/world/worlds">
                        创建或封存世界
                      </Link>
                      {handoffError && <p role="alert">{handoffError}</p>}
                      {worlds.map((w) => (
                        <article className="avg-source" key={w.id}>
                          <div>
                            <h4>
                              {w.label}
                              {handoffId === w.id ? " · 世界引擎带入" : ""}
                            </h4>
                            <p>
                              {w.worldCode} · v{w.version}
                            </p>
                          </div>
                          <button
                            className="lf-action"
                            disabled={
                              busy ||
                              Boolean(row && !row.draft) ||
                              Boolean(handoffError)
                            }
                            onClick={() =>
                              void run(async () => {
                                const target =
                                  dirty || !row ? await save() : row;
                                const sc = {
                                  projectId: target.project.id!,
                                  workId: target.work.id!,
                                  worldId: target.work.worldId,
                                };
                                const d = await readAiTownDraft(sc);
                                await selectAiTownWorld(sc, d.revision, w.id);
                                navigate(path("source", target));
                                setSourceDirty(false);setNotice("世界版本已选择");
                              })
                            }
                          >
                            选择此版本
                          </button>
                        </article>
                      ))}
                      {!worlds.length && (
                        <p>尚无已封存世界。可以先填写小镇方案。</p>
                      )}
                    </section>
                    {scope && row?.draft?.worldReleaseId && (
                      <>
                        <Outlet
                          projectId={scope.projectId}
                          worldId={scope.worldId}
                          initialReleaseId={row.draft.worldReleaseId}
                          onVersions={() => navigate("/world/worlds")}
                        />
                        {sources && selection && (
                          <section className="lf-paper">
                            <h3>选择本小镇读取的资源</h3>
                            <label>
                              建议起点
                              <select
                                value={suggestionKey}
                                onChange={(e) => {
                                  setSuggestionKey(e.target.value);setSourceDirty(true);
                                  setSelection(
                                    sources.selectionDefaults[e.target.value],
                                  );
                                }}
                              >
                                {sources.suggestions.map((s) => (
                                  <option
                                    key={s.suggestionKey}
                                    value={s.suggestionKey}
                                  >
                                    {s.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {(
                              [
                                ["storyResourceKeys", "storySources", "故事"],
                                ["characterResourceKeys", "characters", "人物"],
                                [
                                  "importantLocationResourceKeys",
                                  "importantLocations",
                                  "地点",
                                ],
                                ["artifactResourceKeys", "artifacts", "物品"],
                                [
                                  "codexEntryResourceKeys",
                                  "codexEntries",
                                  "设定",
                                ],
                                ["storyArcResourceKeys", "storyArcs", "故事线"],
                              ] as const
                            ).map(([key, field, label]) => (
                              <fieldset key={key}>
                                <legend>{label}</legend>
                                {sources.sourceOptions[field].map((o) => (
                                  <label
                                    className="town-check"
                                    key={o.resourceKey}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selection[key].includes(
                                        o.resourceKey,
                                      )}
                                      onChange={(e) => {setSourceDirty(true);
                                        setSelection({
                                          ...selection,
                                          [key]: e.target.checked
                                            ? [...selection[key], o.resourceKey]
                                            : selection[key].filter(
                                                (v) => v !== o.resourceKey,
                                              ),
                                        });}
                                      }
                                    />
                                    {o.label}
                                  </label>
                                ))}
                              </fieldset>
                            ))}
                            <button
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  await saveAiTownSourceSelection(
                                    scope,
                                    row.draft!.revision,
                                    suggestionKey,
                                    selection,
                                  );
                                  setSourceDirty(false);setNotice("出口范围已保存");
                                })
                              }
                            >
                              保存出口范围
                            </button>
                          </section>
                        )}
                      </>
                    )}
                  </>
                ) : page[0] === "agent" ? (
                  <><button className="lf-action" disabled={busy} onClick={()=>void run(async()=>{const target=await save();navigate(path('agent',target));setNotice('制作方案已保存');})}>保存制作方案</button>
                  <Proposal key={row?.work.id ?? 'new'} scope={scope} draft={row?.draft} settings={settings} onSource={()=>go('source')} onConfirm={value=>void run(async()=>{if(!scope||!row?.draft)throw new Error('请先保存方案');await saveAiTownDraft(scope,row.draft.revision,value,title||row.work.title);setNotice('候选已回填，可在各配置页继续编辑');})}/></>
                ) : ["production", "review", "release"].includes(page[0]) ? (
                  <>
                    {scope && productionId ? (
                      <>
                        <section className="lf-paper">
                          <h3>{page[1]}</h3>
                          {row?.draft &&
                            row.draft.preparedRevision !==
                              row.draft.revision && (
                              <p>
                                配置已调整；下方仍是之前保存的制作方案。请到确认页生成新方案后再开始。
                              </p>
                            )}
                          <button
                            className="lf-action"
                            onClick={() => go("confirm")}
                          >
                            回到方案确认
                          </button>
                          {!row?.project.productPlatformOptIns
                            ?.productProductionV3 && (
                            <button
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  await updateWorkspace(scope.projectId, {
                                    productPlatformOptIns: {
                                      ...row?.project.productPlatformOptIns,
                                      productProductionV3: true,
                                    },
                                  });
                                  setNotice("已启用自动制作，仍需单独授权开始");
                                })
                              }
                            >
                              启用本作品的自动制作
                            </button>
                          )}
                        </section>
                        <div className="avg-production">
                          <Studio
                            scope={scope}
                            allowedProducts={PRODUCTS}
                            initialProduct="ai-town"
                            initialProductionId={productionId}
                            onProductionSelected={onProductionSelected}
                            managedCreation
                            view={
                              page[0] as "production" | "review" | "release"
                            }
                            authorOptIn={
                              row?.project.productPlatformOptIns
                                ?.productProductionV3 === true && (!row?.draft || row.draft.preparedRevision === row.draft.revision)
                            }
                            onPreviewStarted={(_, id) =>
                              navigate(path("play", row, `&session=${id}`))
                            }
                            onPublished={() => go("play")}
                          />
                        </div>
                      </>
                    ) : row?.draft && !row.draft.worldReleaseId ? (
                      needsSource
                    ) : (
                      <section className="lf-paper">
                        <h3>{page[1]}</h3>
                        <p>这里将显示实际制作步骤、质量检查与发布版本。</p>
                        <button
                          className="lf-action"
                          onClick={() => go("confirm")}
                        >
                          确认制作方案
                        </button>
                      </section>
                    )}
                    {page[0] === "release" && scope && (
                      <section className="lf-paper">
                        <h3>作品完整备份</h3>
                        <button
                          className="lf-action"
                          onClick={() =>
                            void run(async () =>
                              await downloadJSON(
                                await exportProjectJSON(scope.projectId),
                                `${row?.work.title ?? "AI 小镇"}.json`,
                              ),
                            )
                          }
                        >
                          导出AI 小镇备份
                        </button>
                      </section>
                    )}
                  </>
                ) : primary === "player" ? (
                  <Player
                    scope={scope}
                    project={row?.project}
                    sessionId={sessionId}
                    page={page[0]}
                    onSession={(id) =>
                      navigate(path(page[0], row, `&session=${id}`))
                    }
                  />
                ) : page[0] === "community" ? (
                  <>
                    <section className="lf-paper">
                      <h3>AI 小镇作品与本地生活</h3>
                      <p>
                        可安装已发布作品开始游玩。自己的小镇可在“发布与版本”导出游戏包；公共联机与发行服务是否可用，取决于部署配置。
                      </p>
                      <button
                        className="lf-action"
                        onClick={() => go("release")}
                      >
                        我的发布与版本
                      </button>
                    </section>
                    <Community productType="ai-town" onImported={release => navigate(`/town/play?project=${release.projectId}&work=${release.workId}`)} />
                  </>
                ) : (
                  <Inspector
                    scope={scope}
                    productionId={productionId}
                    page={page[0]}
                    onProduction={() => go("production")}
                  />
                )}
              </Suspense>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
