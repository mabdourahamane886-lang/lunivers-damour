const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const SYSTEM_PROMPT = `
Tu es Amour AI, l'assistant de L'univers d'amour.
Tu réponds principalement en français, avec un ton chaleureux, respectueux, simple et utile.
Tu aides pour les relations, la communication, les émotions, la rédaction de messages, les idées de conversations et les conseils du quotidien.
Ne prétends pas connaître des informations personnelles qui ne sont pas présentes dans la conversation.
Ne donne pas de diagnostic médical ou psychologique et encourage un professionnel quand une situation l'exige.
Réponds de façon claire et concise, généralement en 2 à 5 paragraphes.
`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

function getClientKey(request) {
  return request.headers.get("cf-connecting-ip") || "anonymous";
}

const buckets = new Map();

function allowed(request) {
  const key = getClientKey(request);
  const now = Date.now();
  const item = buckets.get(key) || { start: now, count: 0 };
  if (now - item.start > 60 * 60 * 1000) {
    item.start = now;
    item.count = 0;
  }
  item.count += 1;
  buckets.set(key, item);
  return item.count <= 25;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname === "/api/chat") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
      if (!allowed(request)) return json({ error: "RATE_LIMIT", message: "Trop de demandes. Réessaie plus tard." }, 429);
      if (!env.AI) return json({ error: "AI_NOT_CONFIGURED", message: "Le moteur Amour AI n'est pas encore activé sur ce Worker." }, 503);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "INVALID_JSON" }, 400);
      }

      const incoming = Array.isArray(body?.messages) ? body.messages : [];
      const messages = incoming
        .filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .slice(-8)
        .map((item) => ({
          role: item.role,
          content: item.content.trim().slice(0, 1800)
        }))
        .filter((item) => item.content);

      if (!messages.length || messages[messages.length - 1].role !== "user") {
        return json({ error: "MESSAGE_REQUIRED" }, 400);
      }

      try {
        const result = await env.AI.run(MODEL, {
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages]
        }, { rejectIfBusy: true });

        const reply = String(
          result?.response ??
          result?.text ??
          result?.output_text ??
          result?.result?.response ??
          ""
        ).trim();

        if (!reply) throw new Error("EMPTY_RESPONSE");

        return json({
          success: true,
          reply,
          model: MODEL
        });
      } catch (error) {
        console.error("amour_ai_error", error);
        return json({
          error: "AI_UNAVAILABLE",
          message: "Amour AI est momentanément indisponible. Réessaie dans un instant."
        }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
