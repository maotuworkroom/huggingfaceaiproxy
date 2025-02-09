import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// 替换为你的 Hugging Face API Key
const HF_API_KEY = "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";

// 允许 CORS，支持浏览器直接请求
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

    if (!model || !messages) {
      return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers });
    }

    const hfResponse = await fetch("https://api-inference.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: max_tokens ?? 500,
        temperature: temperature ?? 0.7,
      }),
    });

    if (!hfResponse.ok) {
      return new Response(JSON.stringify({ error: "Hugging Face API request failed" }), { status: 500, headers });
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
