const BOARD_SHORTLINK = "GtiwT003";
const TRELLO_EXPORT = `https://trello.com/b/${BOARD_SHORTLINK}.json`;
const USER_AGENT = "TSO-Holocron-Network/1.0";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/board") {
      try {
        const board = await fetchBoard(env);
        return Response.json(normaliseBoard(board), {
          headers: { "Cache-Control": "public, max-age=60, s-maxage=90" }
        });
      } catch (error) {
        return Response.json({
          ok: false,
          error: "The Holocron Network is temporarily unavailable.",
          detail: error instanceof Error ? error.message : "Unknown upstream error"
        }, { status: 503 });
      }
    }

    if (url.pathname === "/api/media") {
      try {
        const cardId = url.searchParams.get("card");
        const attachmentId = url.searchParams.get("attachment");
        if (!cardId || !attachmentId) return new Response("Missing media reference", { status: 400 });

        const board = await fetchBoard(env);
        const card = (board.cards || []).find((item) => item.id === cardId && !item.closed);
        const attachment = card?.attachments?.find((item) => item.id === attachmentId);
        if (!attachment || !isImage(attachment)) return new Response("Image not found", { status: 404 });

        const media = await fetch(attachment.url, {
          headers: { "User-Agent": USER_AGENT },
          redirect: "follow",
          cf: { cacheTtl: 86400, cacheEverything: true }
        });
        const type = media.headers.get("content-type") || attachment.mimeType || "";
        if (!media.ok || !type.toLowerCase().startsWith("image/")) {
          return new Response("Image unavailable", { status: 404 });
        }
        return new Response(media.body, {
          headers: {
            "Content-Type": type,
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
            "X-Content-Type-Options": "nosniff"
          }
        });
      } catch {
        return new Response("Image unavailable", { status: 404 });
      }
    }

    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404 || url.pathname.includes(".")) return asset;
      const home = new URL("/index.html", url);
      return env.ASSETS.fetch(new Request(home, request));
    }
    return new Response("Not found", { status: 404 });
  }
};

/* TRELLO_EXPORT_URL is only for local development: it lets `wrangler dev` read a saved
 * copy of the board from any URL. Production always reads the live Trello export. */
async function fetchBoard(env = {}) {
  const source = env.TRELLO_EXPORT_URL || TRELLO_EXPORT;
  const response = await fetch(source, {
    headers: { "User-Agent": USER_AGENT },
    cf: { cacheTtl: 90, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Trello returned ${response.status}`);
  return response.json();
}

function isImage(attachment) {
  const type = (attachment.mimeType || "").toLowerCase();
  const name = (attachment.name || attachment.url || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)(\?|$)/.test(name);
}

const byPos = (a, b) => (a.pos || 0) - (b.pos || 0);

function normaliseBoard(board) {
  const members = new Map((board.members || []).map((member) => [member.id, {
    id: member.id,
    name: member.fullName || member.username || "",
    username: member.username || "",
    initials: member.initials || ""
  }]));
  const checklists = new Map();
  for (const checklist of board.checklists || []) {
    const items = (checklist.checkItems || []).slice().sort(byPos).map((item) => ({
      name: item.name || "",
      complete: item.state === "complete"
    }));
    const entry = { id: checklist.id, name: checklist.name || "", pos: checklist.pos || 0, items };
    if (!checklists.has(checklist.idCard)) checklists.set(checklist.idCard, []);
    checklists.get(checklist.idCard).push(entry);
  }

  const lists = (board.lists || [])
    .filter((list) => !list.closed)
    .sort(byPos)
    .map((list) => ({
      id: list.id,
      name: list.name,
      cards: (board.cards || [])
        .filter((card) => card.idList === list.id && !card.closed)
        .sort(byPos)
        .map((card) => ({
          id: card.id,
          name: card.name,
          description: card.desc || "",
          url: card.url || "",
          due: card.due || "",
          dueComplete: Boolean(card.dueComplete),
          start: card.start || "",
          lastActivity: card.dateLastActivity || "",
          labels: (card.labels || []).map((label) => ({
            name: label.name || label.color,
            color: label.color
          })),
          members: (card.idMembers || []).map((id) => members.get(id)).filter(Boolean),
          checklists: (checklists.get(card.id) || []).sort(byPos).map(({ pos, ...rest }) => rest),
          attachments: (card.attachments || []).map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            url: attachment.url,
            mimeType: attachment.mimeType,
            isImage: isImage(attachment),
            imageUrl: isImage(attachment)
              ? `/api/media?card=${encodeURIComponent(card.id)}&attachment=${encodeURIComponent(attachment.id)}`
              : ""
          })),
          coverAttachmentId: card.cover?.idAttachment || "",
          coverColor: card.cover?.color || ""
        }))
    }));

  return {
    ok: true,
    id: board.id,
    name: board.name || "TSO Holocron Network",
    description: board.desc || "",
    updatedAt: new Date().toISOString(),
    lists
  };
}
