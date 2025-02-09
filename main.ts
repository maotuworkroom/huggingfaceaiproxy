import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Hugging Face API Key
const HF_API_KEY = "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";

// 允许跨域请求的 Headers
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 处理请求
async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const { model, messages, max_tokens, temperature } = await req.json();

    if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Invalid request format" }), { status: 400, headers });
    }

    // 转换 OpenAI 格式的 messages 为 Hugging Face 支持的输入格式
    const inputText = messages.map(msg => `${msg.role}: ${msg.content}`).join("\n");

    // 限制 max_tokens 避免 Hugging Face 拒绝请求
    const safe_max_tokens = Math.min(max_tokens ?? 1024, 2048);

    const hfResponse = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: inputText, // 关键修改：用文本传入，而不是 messages
        parameters: {
          max_new_tokens: safe_max_tokens,
          temperature: temperature ?? 0.7,
        },
      }),
    });

    if (!hfResponse.ok) {
      const errorData = await hfResponse.json();
      return new Response(JSON.stringify({ error: `Hugging Face API error: ${errorData.error}` }), { status: 500, headers });
    }

    const hfData = await hfResponse.json();

    return new Response(JSON.stringify(hfData), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

// 启动服务器
serve(handleRequest);
console.log("Server running on Deno Deploy...");
