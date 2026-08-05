export const config = {
  runtime: 'edge',
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: headersWithCors(corsHeaders) });
  }

  try {
    const requestUrl = new URL(req.url);
    const targetUrl = requestUrl.searchParams.get("url");

    if (targetUrl) {
      const targetRes = await fetch(targetUrl, {
        headers: { "User-Agent": req.headers.get("User-Agent") || "Mozilla/5.0" },
      });

      const newHeaders = new Headers(targetRes.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(targetRes.body, {
        status: targetRes.status,
        headers: newHeaders,
      });
    }

    return new Response(JSON.stringify({ status: "Vercel Proxy Online", usage: "/api/proxy?url=YOUR_HLS_URL" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

function headersWithCors(headers: Record<string, string>) {
  return headers;
}