import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

// 配置
const CONFIG = {
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  HF_TOKEN: Deno.env.get("HF_TOKEN") || "",
  DEFAULT_MODEL: "meta-llama/Llama-2-7b-chat-hf",
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
  let content = "";
  if (Array.isArray(hfResponse)) {
    content = hfResponse[0]?.generated_text || "";
  } else if (typeof hfResponse === 'object') {
    content = hfResponse.generated_text || "";
  } else {
    content = String(hfResponse || "");
  }

  return {
    id: crypto.randomUUID(),
    object: "chat.completion",
    created: Date.now(),
    model: CONFIG.DEFAULT_MODEL,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content.trim()
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
    model: CONFIG.DEFAULT_MODEL,
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
  try {
    const body = await ctx.request.body().value;
    const { 
      messages, 
      stream = false,
      temperature = 0.7,
      max_tokens = 500,
      model = CONFIG.DEFAULT_MODEL
    } = body;

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

    const lastMessage = messages[messages.length - 1];

    // 这里我们使用 text-generation 的直接格式
    const payload = {
      inputs: lastMessage.content,
      parameters: {
        max_new_tokens: max_tokens,
        temperature: temperature,
        return_full_text: false,
        do_sample: true
      }
    };

    const apiUrl = `https://api-inference.huggingface.co/models/${model}`;

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
      console.error("HF API Error Response:", errorText);
      throw new Error(`HuggingFace API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    ctx.response.body = transformResponse(data);

  } catch (error) {
    console.error("Request error:", error);
    ctx.response.status = error.status || 500;
    ctx.response.body = {
      error: {
        message: error.message,
        type: "api_error"
      }
    };
  }
});

// 健康检查端点
router.get("/health", (ctx) => {
  ctx.response.body = { 
    status: "ok", 
    timestamp: new Date().toISOString(),
    token: CONFIG.HF_TOKEN ? "configured" : "missing",
    model: CONFIG.DEFAULT_MODEL
  };
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Server running on port ${CONFIG.PORT}`);
await app.listen({ port: CONFIG.PORT });