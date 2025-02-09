import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

// 配置
const CONFIG = {
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  HF_TOKEN: Deno.env.get("HF_TOKEN") || "",
  DEFAULT_MODEL: "google/gemma-2-2b-it",
};

// SSE 工具类
class SSEWriter {
  private controller: ReadableStreamDefaultController<Uint8Array>;
  private encoder = new TextEncoder();

  constructor(private ctx: any) {
    const stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      }
    });

    ctx.response.headers.set("Content-Type", "text/event-stream");
    ctx.response.headers.set("Cache-Control", "no-cache");
    ctx.response.headers.set("Connection", "keep-alive");
    ctx.response.body = stream;
  }

  send(data: any) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this.controller.enqueue(this.encoder.encode(`data: ${message}\n\n`));
  }

  close() {
    this.controller.close();
  }
}

// 响应转换工具
function transformResponse(hfResponse: any) {
  return {
    id: crypto.randomUUID(),
    object: "chat.completion",
    created: Date.now(),
    model: hfResponse.model || "unknown",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: Array.isArray(hfResponse) ? hfResponse[0]?.generated_text : hfResponse.generated_text || ""
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: -1,
      completion_tokens: -1,
      total_tokens: -1
    }
  };
}

function transformStreamResponse(chunk: any) {
  return {
    id: crypto.randomUUID(),
    object: "chat.completion.chunk",
    created: Date.now(),
    model: "unknown",
    choices: [{
      index: 0,
      delta: {
        role: "assistant",
        content: chunk
      },
      finish_reason: null
    }]
  };
}

// 构造系统提示词
function constructPrompt(messages: any[]) {
  let prompt = "";
  
  for (const msg of messages) {
    if (msg.role === "system") {
      prompt += `System: ${msg.content}\n`;
    } else if (msg.role === "assistant") {
      prompt += `Assistant: ${msg.content}\n`;
    } else if (msg.role === "user") {
      prompt += `Human: ${msg.content}\n`;
    }
  }
  
  prompt += "Assistant:";
  return prompt;
}

const app = new Application();
const router = new Router();

// CORS 中间件
app.use(async (ctx, next) => {
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 200;
    return;
  }
  
  await next();
});

// 错误处理中间件
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Error:", err);
    ctx.response.status = 500;
    ctx.response.body = {
      error: {
        message: err.message,
        type: "internal_server_error"
      }
    };
  }
});

// Chat completion endpoint
router.post("/v1/chat/completions", async (ctx) => {
  const body = await ctx.request.body().value;
  const { 
    messages, 
    stream = false, 
    model = CONFIG.DEFAULT_MODEL,
    max_tokens,
    temperature,
    top_p,
    frequency_penalty
  } = body;

  // 检查必要参数
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    ctx.response.status = 400;
    ctx.response.body = {
      error: {
        message: "Invalid messages format",
        type: "invalid_request_error"
      }
    };
    return;
  }

  // 构造prompt
  const prompt = constructPrompt(messages);
  
  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: max_tokens || 500,
      temperature: temperature || 0.7,
      top_p: top_p || 1,
      repetition_penalty: frequency_penalty ? 1 + frequency_penalty : 1,
      return_full_text: false,
    }
  };

  console.log("Sending request to HF:", {
    model,
    payload: JSON.stringify(payload),
  });

  const apiUrl = `https://api-inference.huggingface.co/models/${model}`;

  if (stream) {
    const sse = new SSEWriter(ctx);
    
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CONFIG.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HuggingFace API error: ${response.statusText}. ${errorText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const transformedChunk = transformStreamResponse(chunk);
        sse.send(transformedChunk);
      }

      sse.send("[DONE]");
    } catch (error) {
      console.error("Stream error:", error);
      sse.send({ error: error.message });
    } finally {
      sse.close();
    }
  } else {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${CONFIG.HF_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HuggingFace API error: ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      ctx.response.body = transformResponse(data);
    } catch (error) {
      console.error("Request error:", error);
      throw error;
    }
  }
});

// 健康检查端点
router.get("/health", (ctx) => {
  ctx.response.body = { 
    status: "ok", 
    timestamp: new Date().toISOString(),
    token: CONFIG.HF_TOKEN ? "configured" : "missing"
  };
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Server running on port ${CONFIG.PORT}`);
await app.listen({ port: CONFIG.PORT });