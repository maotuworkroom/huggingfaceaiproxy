// deps.ts
export { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";
export { SSEStream } from "https://deno.land/x/oak_sse@v0.2.0/mod.ts";
export { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

// config.ts
import { config } from "./deps.ts";

await config({ export: true, allowEmptyValues: true });

export const CONFIG = {
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  HF_TOKEN: Deno.env.get("HF_TOKEN") || "",
  DEFAULT_MODEL: "google/gemma-2-2b-it",
};

// utils/response.ts
export function transformResponse(hfResponse: any) {
  return {
    id: crypto.randomUUID(),
    object: "chat.completion",
    created: Date.now(),
    model: hfResponse.model || "unknown",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: hfResponse.generated_text || hfResponse[0]?.generated_text || ""
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

export function transformStreamResponse(chunk: any) {
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

// middleware/cors.ts
import { Application } from "../deps.ts";

export function setupCors(app: Application) {
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
}

// middleware/error.ts
import { Application } from "../deps.ts";

export function setupErrorHandler(app: Application) {
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
}

// routes/chat.ts
import { Router, SSEStream } from "../deps.ts";
import { CONFIG } from "../config.ts";
import { transformResponse, transformStreamResponse } from "../utils/response.ts";

const router = new Router();

router.post("/v1/chat/completions", async (ctx) => {
  const body = await ctx.request.body().value;
  const { 
    messages, 
    stream = false, 
    model = CONFIG.DEFAULT_MODEL 
  } = body;
  
  const lastMessage = messages[messages.length - 1];
  const payload = {
    inputs: lastMessage.content,
    stream: stream,
    parameters: {
      max_new_tokens: body.max_tokens || 500,
      temperature: body.temperature || 0.7,
      top_p: body.top_p || 1,
      repetition_penalty: body.frequency_penalty ? 1 + body.frequency_penalty : 1,
    }
  };

  const apiUrl = `https://api-inference.huggingface.co/models/${model}`;

  if (stream) {
    const sse = new SSEStream(ctx);
    
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
        throw new Error(`HuggingFace API error: ${response.statusText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value);
        const transformedChunk = transformStreamResponse(chunk);
        await sse.send(transformedChunk);
      }

      await sse.send("[DONE]");
    } catch (error) {
      await sse.send({ error: error.message });
    } finally {
      await sse.close();
    }
  } else {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CONFIG.HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HuggingFace API error: ${response.statusText}`);
    }

    const data = await response.json();
    ctx.response.body = transformResponse(data);
  }
});

export default router;

// main.ts
import { Application } from "./deps.ts";
import { CONFIG } from "./config.ts";
import { setupCors } from "./middleware/cors.ts";
import { setupErrorHandler } from "./middleware/error.ts";
import chatRouter from "./routes/chat.ts";

const app = new Application();

// 设置中间件
setupCors(app);
setupErrorHandler(app);

// 设置路由
app.use(chatRouter.routes());
app.use(chatRouter.allowedMethods());

// 健康检查端点
app.use((ctx) => {
  if (ctx.request.url.pathname === "/health") {
    ctx.response.body = { status: "ok", timestamp: new Date().toISOString() };
  }
});

// 启动服务器
console.log(`Server running on port ${CONFIG.PORT}`);
await app.listen({ port: CONFIG.PORT });
