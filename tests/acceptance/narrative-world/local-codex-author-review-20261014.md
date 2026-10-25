# NW-1C 本机 Codex 候选抽检材料

状态：**材料被作者指出不适合故事含义抽检，本次请求已撤回，未通过人工验收**。下面四条是带答案提示的合成说明句，不是完整故事。真实调用回执仅保留为协议与流程测试证据；每项一次调用，均未采纳到正式记录。自动检查通过不证明模型独立理解故事。

原始完整回执：[local-codex-candidate-eval-20261014-v5.json](local-codex-candidate-eval-20261014-v5.json)。通道为本机 Codex 订阅，模型 `gpt-6.1-sol`，CLI `Codex 0.162.0-alpha.17.2`；代码树指纹 `92318ee97bf7cde77d10b1d4c44db525e93c99165dd704f7c555eb450fddcd1e`。

作者反馈：这些文字已经解释了事实、计划和误信，无法据此阅读故事并判断候选。该反馈不记为通过。下面保留原材料便于追溯；下一轮必须提供未夹带分析结论的完整故事、模型实际输入和输出，并明确已有业务记录提供了哪些信息。

## 1. 铜铃交接

**原文**

> 小桥在暮色中把铜铃交给阿澈。这是已经发生的交接。
> 原文没有说明日期，也没有说明交接的原因。

**候选含义**

已发生的交接。小桥是交出铜铃者，阿澈是接收者；未补造日期或原因。可见性尚未评审。

**实际逐字引文**

- 小桥在暮色中把铜铃交给阿澈。这是已经发生的交接。 / 原文没有说明日期，也没有说明交接的原因。（supports）
- 小桥（supports）
- 阿澈（supports）

<details><summary>完整结构化候选</summary>

```json
{
  "annotations": {
    "narrativeModalityV1": "established",
    "narrativeVisibilityV1": {
      "class": "unclassified",
      "audienceKeys": [],
      "policyVersion": "author-review-v1"
    },
    "narrativeEventV1": {
      "eventType": "action",
      "participants": [
        {
          "entity": {
            "characterId": null,
            "sourceUid": "res:v1:character:d9074488-6b3f-4d1e-a57c-b30f435f7c8e"
          },
          "role": "交出铜铃者"
        },
        {
          "entity": {
            "characterId": null,
            "sourceUid": "res:v1:character:8433ba8f-bda0-4f37-884a-0cf5e8b8462c"
          },
          "role": "接收铜铃者"
        }
      ],
      "locations": [],
      "propositions": [],
      "effects": [],
      "communication": null,
      "observer": null,
      "before": []
    },
    "narrativeEvidenceV1": [
      {
        "evidenceKey": "handover",
        "source": {
          "self": true
        },
        "fieldPointer": "/description",
        "quote": "小桥在暮色中把铜铃交给阿澈。这是已经发生的交接。\r\n原文没有说明日期，也没有说明交接的原因。",
        "occurrence": 0,
        "supportRole": "supports"
      },
      {
        "evidenceKey": "giver-name",
        "source": {
          "characterId": null,
          "sourceUid": "res:v1:character:d9074488-6b3f-4d1e-a57c-b30f435f7c8e"
        },
        "fieldPointer": "/name",
        "quote": "小桥",
        "occurrence": 0,
        "supportRole": "supports"
      },
      {
        "evidenceKey": "recipient-name",
        "source": {
          "characterId": null,
          "sourceUid": "res:v1:character:8433ba8f-bda0-4f37-884a-0cf5e8b8462c"
        },
        "fieldPointer": "/name",
        "quote": "阿澈",
        "occurrence": 0,
        "supportRole": "supports"
      }
    ]
  },
  "clearFields": []
}
```

</details>

## 2. 尚未出发的计划

**原文**

> 阿澈打算日后把铜铃送回驿站。这只是他私下的计划；故事写到这里，他还没有动身，也没有把计划告诉小桥。

**候选含义**

作者意图：阿澈是计划实施者，尚未出发。只供作者查看；没有生成已兑现效果或小桥已获知的记录。

**实际逐字引文**

- 阿澈打算日后把铜铃送回驿站。这只是他私下的计划；故事写到这里，他还没有动身，也没有把计划告诉小桥。（supports）
- 阿澈（supports）

<details><summary>完整结构化候选</summary>

```json
{
  "annotations": {
    "narrativeModalityV1": "intent",
    "narrativeVisibilityV1": {
      "class": "author-only",
      "audienceKeys": [],
      "policyVersion": "author-review-v1"
    },
    "narrativeEventV1": {
      "eventType": "action",
      "participants": [
        {
          "entity": {
            "characterId": null,
            "sourceUid": "res:v1:character:8433ba8f-bda0-4f37-884a-0cf5e8b8462c"
          },
          "role": "计划实施者"
        }
      ],
      "locations": [],
      "propositions": [],
      "effects": [],
      "communication": null,
      "observer": null,
      "before": []
    },
    "narrativeEvidenceV1": [
      {
        "evidenceKey": "planned-action",
        "source": {
          "self": true
        },
        "fieldPointer": "/description",
        "quote": "阿澈打算日后把铜铃送回驿站。这只是他私下的计划；故事写到这里，他还没有动身，也没有把计划告诉小桥。",
        "occurrence": 0,
        "supportRole": "supports"
      },
      {
        "evidenceKey": "participant-name",
        "source": {
          "characterId": null,
          "sourceUid": "res:v1:character:8433ba8f-bda0-4f37-884a-0cf5e8b8462c"
        },
        "fieldPointer": "/name",
        "quote": "阿澈",
        "occurrence": 0,
        "supportRole": "supports"
      }
    ]
  },
  "clearFields": []
}
```

</details>

## 3. 举起铜铃

**原文**

> 小桥敲了一下桌子。片刻后，阿澈举起铜铃。原文没有解释两个动作是否有关；本记录描述阿澈举铃这一动作。

**候选含义**

已发生的举铃动作，行动者为阿澈。没有把小桥敲桌子解释成举铃原因。可见性尚未评审。

**实际逐字引文**

- 阿澈举起铜铃。（supports）
- 原文没有解释两个动作是否有关；本记录描述阿澈举铃这一动作。（context）

<details><summary>完整结构化候选</summary>

```json
{
  "annotations": {
    "narrativeModalityV1": "established",
    "narrativeVisibilityV1": {
      "class": "unclassified",
      "audienceKeys": [],
      "policyVersion": "author-review-v1"
    },
    "narrativeEventV1": {
      "eventType": "action",
      "participants": [
        {
          "entity": {
            "characterId": null,
            "sourceUid": "res:v1:character:8433ba8f-bda0-4f37-884a-0cf5e8b8462c"
          },
          "role": "行动者"
        }
      ],
      "locations": [],
      "propositions": [],
      "effects": [],
      "communication": null,
      "observer": null,
      "before": []
    },
    "narrativeEvidenceV1": [
      {
        "evidenceKey": "raising-bell",
        "source": {
          "self": true
        },
        "fieldPointer": "/description",
        "quote": "阿澈举起铜铃。",
        "occurrence": 0,
        "supportRole": "supports"
      },
      {
        "evidenceKey": "causal-uncertainty",
        "source": {
          "self": true
        },
        "fieldPointer": "/description",
        "quote": "原文没有解释两个动作是否有关；本记录描述阿澈举铃这一动作。",
        "occurrence": 0,
        "supportRole": "context"
      }
    ]
  },
  "clearFields": []
}
```

</details>

## 4. 铜铃归属的误认

**原文**

> 铜铃实际已经交给阿澈保管，小桥并不知道交接已经完成，仍然相信铜铃在自己房里的抽屉中。这是小桥的错误判断。

**候选含义**

角色信念：小桥相信“铜铃在小桥房里的抽屉中”。没有用客观事实替换该信念，也没有补造获知日期或来源事件。可见性尚未评审。

**实际逐字引文**

- 铜铃在小桥房里的抽屉中（supports）
- 铜铃实际已经交给阿澈保管，小桥并不知道交接已经完成，仍然相信铜铃在自己房里的抽屉中。这是小桥的错误判断。（supports）

<details><summary>完整结构化候选</summary>

```json
{
  "annotations": {
    "narrativeModalityV1": "belief",
    "narrativeVisibilityV1": {
      "class": "unclassified",
      "audienceKeys": [],
      "policyVersion": "author-review-v1"
    },
    "narrativeEpistemicV1": {
      "attitude": "believe",
      "transition": "acquire",
      "assertedValue": {
        "kind": "text",
        "value": "铜铃在小桥房里的抽屉中"
      },
      "sourceEvent": null,
      "revises": null
    },
    "narrativeEvidenceV1": [
      {
        "evidenceKey": "belief-content",
        "source": {
          "self": true
        },
        "fieldPointer": "/belief",
        "quote": "铜铃在小桥房里的抽屉中",
        "occurrence": 0,
        "supportRole": "supports"
      },
      {
        "evidenceKey": "mistaken-belief-context",
        "source": {
          "self": true
        },
        "fieldPointer": "/sourceQuote",
        "quote": "铜铃实际已经交给阿澈保管，小桥并不知道交接已经完成，仍然相信铜铃在自己房里的抽屉中。这是小桥的错误判断。",
        "occurrence": 0,
        "supportRole": "supports"
      }
    ]
  },
  "clearFields": []
}
```

</details>

## 失败记录与修正范围

- v1/v2：浏览器初始化连续改变目录；在模型调用前停止，已完成的响应保留。
- v3：认知必填结构遗漏，修复后仍不完整；阻止采纳。
- v4：补齐认知结构后仍失败。复核发现评测自身的 owns 事实缺少物品引用；真实事实投影不可用。原始失败文件保留。
- v5：测试数据补上铜铃实体及登记引用，新增调用前的来源投影检查；问题、原文和判定条件保持相同。提示契约明确必需字段和两种引用形状。四项通过且源码在运行期间未改变。

NW-0B 原考卷、120 个查询成绩和黄金文件保持独立。当前模型证据仅针对此候选抽取流程。
