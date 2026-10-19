# 跑团旁白试听素材

`narration-preview.wav` 是固定原创示例文本的中文合成音频，仅用于进入游戏前选择本机收听语速。未使用真人录音或音色克隆，不包含作品、玩家或世界私有内容；不作为任何团局的已采用音轨。

原文：雨停以后，你们沿着石阶走到旧码头。守夜人抬起灯，仔细看了看每个人的脸，却没有立刻开口。远处传来两下缓慢的钟声，一只小船正从黑暗里靠近。你可以先问清来人的身份，再决定是否登船。

原 WAV：单声道 PCM16 / 44100 Hz / 13.560454 秒；SHA-256 `315c6c8c0db734b5f03237f1e8c4cccfe57d78f689cf065b279afcc5286a49d9`。实际试听默认 0.90 倍速并保持音高；文件字节保持原样。

生成来源：仓库 `scripts/ttrpg-local-tts/selection.json` 固定的 [MeloTTS](https://github.com/myshell-ai/MeloTTS/tree/209145371cff8fc3bd60d7be902ea69cbdb7965a) 和 [中文语音模型](https://huggingface.co/myshell-ai/MeloTTS-Chinese/tree/af5d207a364ea4208c6f589c89f57f88414bdd16)（MIT）；生成时使用的 [BERT 文本编码模型](https://huggingface.co/google-bert/bert-base-multilingual-uncased/tree/7cbf9a625e29989f6b9c6c2fa68234c304f7e38f) 标注 Apache-2.0。仅分发这段生成样本，不把模型、权重或 Python 依赖打入前端。原始生成记录、WAV 与评测回执留存本地。
