# 本机免费音乐候选：实验安装基础

本目录目前仅提供固定来源安装器，尚无推理服务、浏览器选项或正式BGM/SFX生产入口。后续须接回现有AVG需求、durable Harness、原始响应/音频Blob、作者审听采用及typed channel绑定，不能用安装完成代表声音生产闭环。

候选为官方[ACE-Step 1.5代码](https://github.com/ace-step/ACE-Step-1.5)和[原发布者模型包](https://huggingface.co/ACE-Step/Ace-Step1.5)，准确revision、17个文件及hash保存在`model-source.json`；所选字节共6336686268。只安装turbo DiT、官方VAE及文本编码器，暂不安装额外LM，也不选择社区微调、艺术家/翻唱或参考音频路径。首轮计划为短片段纯器乐校准，音乐/环境/SFX的适用范围与效果仍须各自验证。

组件分开登记：代码/DiT/官方VAE由发布者标注MIT；[VAE独立模型卡](https://huggingface.co/ACE-Step/ace-step-v1.5-1d-vae-stable-audio-format)单独标明MIT，[固定代码的VAE文档](https://github.com/ace-step/ACE-Step-1.5/blob/ca1e85fe9430179831e6bc6be790c332190a3866/docs/en/ALT_VAE.md)区分官方包与可选社区替换。[Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)另按Apache-2.0记录。运行时代码和全部依赖须在安装/接线前继续核查；发布者的训练数据说明不等于独立审计或输出原创性验收。

只把公开固定文件写入明确的实验模型目录，无凭据、推理或自动下载回退：

```sh
python3 scripts/avg-local-music/download_model.py /absolute/evaluation/model-directory
```

如明确选择`--weight-host modelscope`，仅SHA-256文件使用该公开镜像，其余文件仍来自原始完整revision；镜像始终不能改变冻结来源和内容hash。坏字节、余额/权限错误或连接失败不会隐藏重试。安装器至少预留8 GiB；不删除已有模型、作品媒资、失败回执或备份。
