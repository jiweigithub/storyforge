# AVG 本机固定音色服务

该服务只把显式请求中的准确台词和演法转换为 PCM16 WAV，不读取 StoryForge 数据库，不创建候选、不代替作者采用。正式生产仍由现有 `avg.media-request.v1`、登记的 AVG 单任务上下文、Production/Build、durable Harness、审听与选音命令执行。世界只读，媒资由 AVG Work 持有；没有新表、迁移或第二套作品存储。

## 模型选择与许可核查（2026-10-18）

| 项目 | 官方依据 | 本次决定 |
| --- | --- | --- |
| Qwen3-TTS | [官方代码及 Apache-2.0](https://github.com/QwenLM/Qwen3-TTS)、[1.7B CustomVoice 官方权重](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)、[官方 tokenizer](https://huggingface.co/Qwen/Qwen3-TTS-Tokenizer-12Hz)分别标注 Apache-2.0；官方列出固定音色和中文支持 | 首轮选 1.7B 固定音色，仅开放五种中文音色，不开放 Base 克隆或任意音色参考上传；固定完整模型 revision、权重 hash 和参数边界 |
| Qwen3-TTS 0.6B | 模型页有演法宣传，但[官方推理代码](https://github.com/QwenLM/Qwen3-TTS/blob/main/qwen_tts/inference/qwen3_tts_model.py)会忽略 0.6B 的 `instruct` | 不作为支持情绪/演法的模型；不能保存要求后静默丢弃 |
| Kokoro v1.1-zh | [官方模型卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh)标注 Apache-2.0，披露获授权中文数据及众包合成英语数据；其合成数据条款论证仍由发布者陈述 | 本轮不引入，未把许可标签当作全部训练数据权利结论 |
| MeloTTS | [官方仓库](https://github.com/myshell-ai/MeloTTS)标注 MIT，但[依赖](https://github.com/myshell-ai/MeloTTS/blob/main/requirements.txt)覆盖多语种 G2P、词典及其它不同许可项目 | 本轮不引入，避免仅凭仓库 MIT 就把全部模型与依赖当作 MIT |

Qwen 的固定音色与权重按发布者的 Apache-2.0 声明使用；没有取得每位原始训练说话人的独立合同副本，不将其表述为零争议保证。需要保留发布者许可、版权和依赖通知，不使用第三方演员名称、克隆样本或未经核实的社区音色包。模型效果比较尚待本机真实语音测量和审听，不把发布者 benchmark 当作本产品效果。

Python 推理运行时独立安装于用户本机，当前不随网页/桌面客户端打包。Qwen、Transformers、Accelerate 为 Apache-2.0，PyTorch/torchaudio、librosa、Python SoundFile、pysox 等须保留各自许可证；SoundFile 所带 **libsndfile** 及 librosa 的 **soxr** 存在 LGPL 条款，不能把整套依赖称为 MIT/Apache。动态库与其通知保留在独立环境中，未复制源码到闭源模块、未静态链接分发。后续如打包运行时，必须随包提供对应通知、可替换动态库及适用源代码获取方式；尚未完成这种发行验收。[SoundFile 许可](https://github.com/bastibe/python-soundfile/blob/master/LICENSE)、[libsndfile 条款](https://github.com/libsndfile/libsndfile/blob/master/COPYING)、[soxr 条款](https://github.com/dofuuz/python-soxr/blob/main/LICENSE.txt)。不安装 SoX 命令行、eSpeak、ffmpeg 或 Gradio 演示服务；Python pysox 的导入警告不表示本流程要调用 SoX 二进制。

## 安装与运行

使用专用 Python 3.12 虚拟环境；不要在系统 Python 或其他产品的环境内安装。以下路径由部署者在本机选择，模型不进入仓库、浏览器备份或云端。模型总大小约 4.52 GB，下载器额外保留 8 GiB 磁盘余量，不创建重复 Hub 缓存。

```sh
python3.12 -m venv /absolute/local/avg-voice/runtime
/absolute/local/avg-voice/runtime/bin/python -m pip install -r scripts/avg-local-voice/runtime-pins.txt
/absolute/local/avg-voice/runtime/bin/python -m pip install --no-deps qwen-tts==0.1.1
python3 scripts/avg-local-voice/download_model.py /absolute/local/avg-voice/model
/absolute/local/avg-voice/runtime/bin/python scripts/avg-local-voice/server.py --model-dir /absolute/local/avg-voice/model --device cpu
```

`requirements.txt`记录直接推理依赖，`runtime-pins.txt`固定首次可导入环境的完整 Python 包版本；Qwen 包单独 `--no-deps`，因为官方包还声明了本服务不使用的 Gradio 演示依赖。`license_inventory.py`导出实际安装版本、许可元数据与通知清单，发行不能只审查直接依赖列表。推理导入已验证；真实模型下载、推理速度、发音、情绪和连续对白仍须分别验收。

中国大陆可明确添加 `--weight-host modelscope`，只从 Qwen 官方 ModelScope 仓库续传大权重；仍须通过同一固定版本的完整 SHA-256 和大小校验，否则停止。下载无自动重试；失败保留 `.part`，人工或上层明确续传同一文件后才继续。推理启动完全离线，逐文件检查模型锁，禁止启动时自动拉取模型或远程代码。已支持 `--device mps` 和 `cuda:0` 的显式选择，但不声明设备已实测，不自动改为另一设备。

默认地址 `http://127.0.0.1:5297/v1`，仅绑定 `127.0.0.1`，严格核对 Host；浏览器只允许明确的 StoryForge 本机 origin，默认 5196 与 1111。其他开发端口需在启动参数中显式重复 `--origin http://127.0.0.1:PORT`。服务不接收 Agnes/OpenAI Key，也不访问这些服务；浏览器外本机客户端可调用，故不要把它暴露到局域网或用反向代理公开。

## 执行与验收边界

- `/v1/capabilities` 只返回固定模型、revision、音色和能力；它不等于权利或音质审查。浏览器在每次生成前限时、限字节核对，变化时零生成拒绝。
- `/v1/audio/speech` 只接收准确 `model/input/voice/response_format` 和可选完整 `instructions`，拒绝速度、克隆参考、额外参数、重复 JSON 字段与超界输入。保留 UTF-16 字符计数和原文，不截断、不改字、不拆句。
- 单次最多 256 UTF-16 字符、2048 指令字符、1536 个新 codec token、120 秒输出，单模型执行槽，单进程最多 256 个请求身份。未知结果或重复身份不自动重发；进程内防重不代替浏览器 durable ledger，重启不授予重发权限。
- 输出明确转换为单声道 24 kHz PCM16 WAV，不做变速、裁切或响度修复；非有限、超时长或将削波的样本拒绝。客户端继续验证真实字节、浏览器解码和音频测量，然后单独审听、选择、采用、逐句绑定。
- 返回调用费用 `0` 仅表示本机无供应商调用收费，不包括硬件、用电和人工；模型失败保留请求身份。服务不记录台词或指令日志、不保存音频，作者作品与音频仍由浏览器现有生命周期保存。
- 独立环境导入、原创 PCM/受控 HTTP、真实模型音频、人工审听、商业作品验收分别记录。测试不能证明真人声效果，未开放正式默认生产开关。

接口边界检查：`python3 -m unittest discover -s scripts/avg-local-voice -p test_server.py`。该命令使用原创 PCM 测试引擎，不加载或下载模型。
