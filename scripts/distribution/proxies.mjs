// Fixed provider routes shared by development and the local portable server.
export const providerProxies = {
      '/deepseek-proxy': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepseek-proxy/, ''),
        secure: true,
      },
      '/openai-proxy': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openai-proxy/, ''),
        secure: true,
      },
      '/kimi-proxy': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kimi-proxy/, ''),
        secure: true,
      },
      '/claude-proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/claude-proxy/, ''),
        secure: true,
      },
      '/nvidia-proxy': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nvidia-proxy/, ''),
        secure: true,
      },
      '/gemini-proxy': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/gemini-proxy/, ''),
        secure: true,
      },
      '/doubao-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/doubao-proxy/, ''),
        secure: true,
      },
      '/agnes-proxy': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agnes-proxy/, ''),
        secure: true,
      },
      '/longcat-proxy': {
        target: 'https://api.longcat.chat',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/longcat-proxy/, ''),
        secure: true,
      },
      '/opencode-proxy': {
        target: 'https://opencode.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode-proxy/, '/zen/go'),
        secure: true,
      },
      // NS-5 embedding：国内嵌入服务本地代理（绕浏览器 CORS）
      '/siliconflow-proxy': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/siliconflow-proxy/, ''),
        secure: true,
      },
      '/qwen-proxy': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/qwen-proxy/, ''),
        secure: true,
      },
      '/glm-proxy': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/glm-proxy/, ''),
        secure: true,
      },
}
