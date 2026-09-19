const MODEL = "@cf/google/gemma-4-26b-a4b-it";
const SUPABASE_URL = "https://okdohokhlkxrmxpevees.supabase.co";

const SYSTEM_PROMPT = `
Tu es Amour AI, l'assistant officiel de L'univers d'amour.
Réponds principalement en français, avec un ton chaleureux, respectueux, moderne et utile.
Tu aides pour les relations, les émotions, la communication, la rédaction de messages, les idées de conversations et les situations du quotidien.
Tu dois distinguer les faits des suppositions. Ne prétends jamais connaître une information personnelle absente de la conversation.
Tu ne remplaces pas un médecin, psychologue, avocat ou autre professionnel. Pour une situation à haut risque, oriente vers un professionnel approprié.
Ne demande jamais de mot de passe, clé API, code de sécurité ou donnée bancaire.
Réponds de façon claire, naturelle et structurée, comme un assistant conversationnel professionnel.
`;

const buckets = new Map();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extra
    }
  });
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, "\\$&") + "=([^;]+)"));
  return match ? decodeURIComponent(match[1]) : "";
}

function sessionFromRequest(request) {
  return getCookie(request, "amour_session");
}

function newSessionId() {
  return crypto.randomUUID();
}

function sessionCookie(id) {
  return `amour_session=${encodeURIComponent(id)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

function getOrCreateSession(request) {
  return sessionFromRequest(request) || newSessionId();
}

function allowed(request) {
  const key = request.headers.get("cf-connecting-ip") || "anonymous";
  const now = Date.now();
  const item = buckets.get(key) || { start: now, count: 0 };
  if (now - item.start > 60 * 60 * 1000) {
    item.start = now;
    item.count = 0;
  }
  item.count += 1;
  buckets.set(key, item);
  return item.count <= 40;
}

function storageReady(env) {
  return Boolean(String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim());
}

async function supabase(env, path, init = {}) {
  if (!storageReady(env)) throw new Error("SUPABASE_NOT_CONFIGURED");
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY).trim();
  const headers = new Headers(init.headers || {});
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", headers.get("Content-Type") || "application/json");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers
  });
  return response;
}


async function searchKnowledge(env, query) {
  const safeQuery = String(query || "").trim().slice(0, 500);
  if (!safeQuery) return [];

  const response = await supabase(env, "rpc/amour_ai_search_knowledge", {
    method: "POST",
    body: JSON.stringify({ query_text: safeQuery, max_results: 8 })
  });
  if (!response.ok) throw new Error(`SUPABASE_SEARCH_KNOWLEDGE_${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function formatKnowledgeContext(rows) {
  if (!rows.length) return "";
  return rows
    .slice(0, 8)
    .map((item, index) => `[${index + 1}] ${item.title}\n${item.content}`)
    .join("\n\n");
}

async function createConversation(env, sessionId, title = "Nouvelle conversation") {
  const response = await supabase(env, "amour_ai_conversations", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ session_id: sessionId, title: title.slice(0, 80), model: MODEL }])
  });
  if (!response.ok) throw new Error(`SUPABASE_CREATE_CONVERSATION_${response.status}`);
  const rows = await response.json();
  return rows[0];
}

async function getConversation(env, sessionId, conversationId) {
  const response = await supabase(
    env,
    `amour_ai_conversations?select=id,session_id,title,model,created_at,updated_at&session_id=eq.${encodeURIComponent(sessionId)}&id=eq.${encodeURIComponent(conversationId)}&limit=1`
  );
  if (!response.ok) throw new Error(`SUPABASE_GET_CONVERSATION_${response.status}`);
  const rows = await response.json();
  return rows[0] || null;
}

async function listConversations(env, sessionId) {
  const response = await supabase(
    env,
    `amour_ai_conversations?select=id,title,model,created_at,updated_at&session_id=eq.${encodeURIComponent(sessionId)}&order=updated_at.desc&limit=30`
  );
  if (!response.ok) throw new Error(`SUPABASE_LIST_CONVERSATIONS_${response.status}`);
  return response.json();
}

async function listMessages(env, conversationId, limit = 30) {
  const response = await supabase(
    env,
    `amour_ai_messages?select=id,role,content,created_at&conversation_id=eq.${encodeURIComponent(conversationId)}&order=created_at.asc&limit=${Math.max(1, Math.min(limit, 50))}`
  );
  if (!response.ok) throw new Error(`SUPABASE_LIST_MESSAGES_${response.status}`);
  return response.json();
}

async function saveMessage(env, conversationId, role, content) {
  const response = await supabase(env, "amour_ai_messages", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{ conversation_id: conversationId, role, content: String(content).slice(0, 4000) }])
  });
  if (!response.ok) throw new Error(`SUPABASE_SAVE_MESSAGE_${response.status}`);
}

async function deleteConversation(env, sessionId, conversationId) {
  const response = await supabase(
    env,
    `amour_ai_conversations?session_id=eq.${encodeURIComponent(sessionId)}&id=eq.${encodeURIComponent(conversationId)}`,
    { method: "DELETE" }
  );
  if (!response.ok) throw new Error(`SUPABASE_DELETE_CONVERSATION_${response.status}`);
}

function titleFromMessage(text) {
  const clean = String(text || "").replace(/\\s+/g, " ").trim();
  return clean.slice(0, 70) || "Nouvelle conversation";
}

async function updateConversationTitle(env, conversationId, title) {
  const response = await supabase(
    env,
    `amour_ai_conversations?id=eq.${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ title: title.slice(0, 80), model: MODEL, updated_at: new Date().toISOString() })
    }
  );
  if (!response.ok) throw new Error(`SUPABASE_UPDATE_CONVERSATION_${response.status}`);
}

function extractReply(result) {
  return String(
    result?.response ??
    result?.text ??
    result?.output_text ??
    result?.result?.response ??
    result?.choices?.[0]?.message?.content ??
    ""
  ).trim();
}

async function handleConversations(request, env) {
  const sessionId = getOrCreateSession(request);
  const cookie = sessionFromRequest(request) ? null : sessionCookie(sessionId);

  if (!storageReady(env)) {
    return json(
      { error: "SUPABASE_NOT_CONFIGURED", message: "Le stockage sécurisé d’Amour AI n’est pas encore configuré sur Cloudflare." },
      503,
      cookie ? { "Set-Cookie": cookie } : {}
    );
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("id");
    if (conversationId) {
      const conversation = await getConversation(env, sessionId, conversationId);
      if (!conversation) return json({ error: "NOT_FOUND" }, 404);
      const messages = await listMessages(env, conversation.id, 50);
      return json({ success: true, conversation, messages }, 200, cookie ? { "Set-Cookie": cookie } : {});
    }
    const conversations = await listConversations(env, sessionId);
    return json({ success: true, conversations }, 200, cookie ? { "Set-Cookie": cookie } : {});
  }

  if (request.method === "POST") {
    let body = {};
    try { body = await request.json(); } catch {}
    const conversation = await createConversation(env, sessionId, String(body?.title || "Nouvelle conversation"));
    return json({ success: true, conversation }, 201, cookie ? { "Set-Cookie": cookie } : {});
  }

  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("id");
    if (!conversationId) return json({ error: "CONVERSATION_ID_REQUIRED" }, 400);
    const conversation = await getConversation(env, sessionId, conversationId);
    if (!conversation) return json({ error: "NOT_FOUND" }, 404);
    await deleteConversation(env, sessionId, conversationId);
    return json({ success: true, deleted: true });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}

async function handleChat(request, env) {
  if (!allowed(request)) {
    return json({ error: "RATE_LIMIT", message: "Trop de demandes. Réessaie plus tard." }, 429);
  }
  if (!env.AI) {
    return json({ error: "AI_NOT_CONFIGURED", message: "Le moteur Amour AI n’est pas activé sur ce Worker." }, 503);
  }
  if (!storageReady(env)) {
    return json({ error: "SUPABASE_NOT_CONFIGURED", message: "Ajoute SUPABASE_SERVICE_ROLE_KEY aux Secrets du Worker Cloudflare." }, 503);
  }

  let body;
  try { body = await request.json(); } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const text = String(body?.message || "").trim().slice(0, 4000);
  if (!text) return json({ error: "MESSAGE_REQUIRED" }, 400);

  const sessionId = getOrCreateSession(request);
  let conversationId = String(body?.conversationId || "").trim();
  let conversation = null;

  if (conversationId) {
    conversation = await getConversation(env, sessionId, conversationId);
    if (!conversation) return json({ error: "CONVERSATION_NOT_FOUND" }, 404);
  } else {
    conversation = await createConversation(env, sessionId, titleFromMessage(text));
    conversationId = conversation.id;
  }

  await saveMessage(env, conversationId, "user", text);
  const storedMessages = await listMessages(env, conversationId, 14);

  const messages = storedMessages.map(item => ({
    role: item.role,
    content: item.content
  }));

  let knowledgeContext = "";
  try {
    const knowledge = await searchKnowledge(env, text);
    knowledgeContext = formatKnowledgeContext(knowledge);
  } catch (error) {
    console.error("amour_ai_knowledge_search_error", error);
  }

  const systemContent = knowledgeContext
    ? `${SYSTEM_PROMPT}\n\nBASE DE CONNAISSANCES AMOUR AI (à utiliser pour enrichir la réponse) :\n${knowledgeContext}\n\nUtilise cette base comme contexte utile, sans inventer de faits et sans présenter son contenu comme une certitude quand le contexte ne le permet pas.`
    : SYSTEM_PROMPT;

  const result = await env.AI.run(
    MODEL,
    { messages: [{ role: "system", content: systemContent }, ...messages] },
    { rejectIfBusy: true }
  );

  const reply = extractReply(result);
  if (!reply) {
    return json({ error: "EMPTY_RESPONSE", message: "Amour AI n’a pas produit de réponse." }, 502);
  }

  await saveMessage(env, conversationId, "assistant", reply);
  if (!conversation.title || conversation.title === "Nouvelle conversation") {
    await updateConversationTitle(env, conversationId, titleFromMessage(text));
  }

  return json(
    {
      success: true,
      conversationId,
      reply,
      model: MODEL
    },
    200,
    { "Set-Cookie": sessionCookie(sessionId) }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && (url.pathname === "/api/chat" || url.pathname === "/api/conversations")) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
        return await handleChat(request, env);
      }

      if (url.pathname === "/api/conversations") {
        return await handleConversations(request, env);
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("amour_ai_backend_error", error);
      if (String(error?.message || "").includes("SUPABASE_NOT_CONFIGURED")) {
        return json({ error: "SUPABASE_NOT_CONFIGURED", message: "SUPABASE_SERVICE_ROLE_KEY n’est pas configurée dans les Secrets du Worker." }, 503);
      }
      return json({ error: "INTERNAL_ERROR", message: "Une erreur interne est survenue." }, 500);
    }
  }
};
