# HuggingFace Proxy Server

这是一个用Deno实现的HuggingFace API代理服务器，支持OpenAI格式的API调用。

## 部署步骤

1. 确保已安装Deno
2. 克隆此仓库
3. 配置环境变量：
   - 复制`.env.example`为`.env`
   - 填入你的HuggingFace API token
4. 运行服务器：
   ```bash
   deno task start
   ```

## API使用示例

```javascript
const response = await fetch('http://your-server:8000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: "google/gemma-2-2b-it",
    messages: [
      { role: "user", content: "Hello!" }
    ],
    stream: false
  })
});

const data = await response.json();
console.log(data);
```

## Deno Deploy 部署

1. 在Deno Deploy创建新项目
2. 选择从GitHub部署
3. 设置环境变量：
   - `HF_TOKEN`: 你的HuggingFace API token
   - `PORT`: 8000（可选）
4. 部署完成后即可使用

## 特性

- ✅ OpenAI兼容的API格式
- ✅ 支持流式响应
- ✅ CORS已配置
- ✅ 错误处理
- ✅ 健康检查端点
- ✅ 环境变量配置
- ✅ TypeScript支持
