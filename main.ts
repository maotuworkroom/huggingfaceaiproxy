import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// 替换为你的 Hugging Face API Key
const HF_API_KEY = "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";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

    // 限制 max_tokens 避免请求过大
    const safe_max_tokens = Math.min(max_tokens ?? 1024, 2048);

    const hfResponse = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: messages,
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

serve(handleRequest);
console.log("Server running on Deno Deploy...");
