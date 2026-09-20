/* TSO Holocron Network — client
 * Content comes from /api/board (the Worker's live Trello feed) and is re-checked
 * on a timer, so edits on the Trello board appear here without a reload.
 * window.__NETWORK_PREVIEW__ = { board } switches to hash routing with bundled
 * sample data; it is only set by the standalone design preview, never in production. */

const PREVIEW = window.__NETWORK_PREVIEW__ || null;
const POLL_MS = 60_000;

const fallback = {
  ok: true,
  preview: true,
  name: "TSO Holocron Network",
  description: "The holocron network of the Sith Order: every vault, every record, every keeper.",
  lists: [
    { id: "vault-council", name: "Vault of the Dark Council", cards: [
      { id: "council-charter", name: "Charter of the Dark Council", description: "## Purpose\n\nThe Council governs the Order in the Emperor's name.\n\n- Twelve seats, each a sphere of influence.\n- Decisions bind every Sith below the Council.", labels: [{ name: "Doctrine", color: "red" }], attachments: [], members: [{ id: "m1", name: "Darth Sample", initials: "DS" }], checklists: [{ id: "c1", name: "Ratification", items: [{ name: "Read before the Council", complete: true }, { name: "Sealed by the Emperor", complete: false }] }] }
    ]},
    { id: "vault-training", name: "Vault of Training", cards: [
      { id: "trials", name: "The Trials of the Acolyte", description: "## The Trials\n\nEvery acolyte faces the trials before an overseer.", labels: [], attachments: [], members: [], checklists: [] }
    ]}
  ]
};

const state = { board: null, signature: "", lastSync: 0, live: false, searchIndex: 0, searchMatches: [] };
const app = document.getElementById("app");
const byId = (id) => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const LABEL_COLORS = { green: "#1f9d5a", yellow: "#c99a12", orange: "#e0731a", red: "#c8102e", purple: "#7b5cf0", blue: "#2f6fe0", sky: "#1ea5c8", lime: "#7cb518", pink: "#e0489a", black: "#4a3f52" };

/* ───────── Data + live sync ───────── */
async function loadBoard() {
  if (PREVIEW) return prepareBoard({ ...PREVIEW.board, preview: true });
  const response = await fetch("/api/board", { cache: "no-store" });
  if (!response.ok) throw new Error("Board unavailable");
  const board = await response.json();
  if (!board.ok || !Array.isArray(board.lists)) throw new Error("Board unavailable");
  return prepareBoard(board);
}
const signatureOf = (board) => JSON.stringify([board.name, board.description, board.lists]);

/* Trello boards are written by people, not for a website, so a little interpretation
 * happens here before anything renders:
 *  - cards named "---" (or similar) are visual dividers on the board and are dropped;
 *  - a list whose first card has no description is using that card as a heading for
 *    the list ("Imperial Crimes", "Special Locations"…). It becomes the section's
 *    tagline (and artwork, if it carries an image) instead of an empty record;
 *  - names like "A-01 | Trespassing" are split into a code and a title;
 *  - a leading heading or bold line that just repeats the card's name is removed
 *    from the description, since the page already shows the title. */
function prepareBoard(board) {
  const lists = board.lists.map((list) => {
    const cards = list.cards
      .map((card) => ({ ...card, name: cleanText(card.name).replace(/^[•·▪●*-]+\s*/, ""), description: cleanText(card.description) }))
      .filter((card) => card.name && !/^[-—–_=*.\s]+$/.test(card.name));
    let tagline = "", art = null;
    if (cards.length > 1 && !cards[0].description) {
      const heading = cards.shift();
      tagline = titleCase(heading.name);
      art = primaryImage(heading);
    }
    return { ...list, name: cleanText(list.name), tagline, art, cards: cards.map(prepareRecord) };
  });
  return { ...board, name: cleanText(board.name), description: cleanText(board.description), lists };
}
function prepareRecord(card) {
  const coded = card.name.match(/^([A-Z]{1,3}-\d{1,3})\s*[|:–—-]\s*(.+)$/);
  const code = coded ? coded[1] : "";
  const title = coded ? coded[2].trim() : card.name;
  const description = stripTitleLine(card.description, [card.name, title]);
  const titleOnly = !description && !(card.attachments || []).length;
  return { ...card, code, title, description, titleOnly };
}
function stripTitleLine(description, titles) {
  const lines = description.split("\n");
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return "";
  const heading = lines[first].trim().replace(/^#{1,6}\s*/, "").replace(/^>\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1").replace(/^__(.+)__$/, "$1").trim();
  const wanted = titles.map(normalise);
  if (heading && wanted.includes(normalise(heading))) return lines.slice(first + 1).join("\n").trim();
  return description;
}
const normalise = (value = "") => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
function cleanText(value = "") { return String(value).replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\r/g, "").replace(/[ \t]+$/gm, "").trim(); }
function titleCase(value = "") {
  if (value !== value.toUpperCase() || !/[A-Z]/.test(value)) return value;
  const small = new Set(["of", "the", "and", "or", "in", "on", "at", "to", "for", "by", "a", "an"]);
  return value.toLowerCase().split(" ").map((word, i) => (i && small.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

async function start() {
  try {
    state.board = await loadBoard();
    state.live = !state.board.preview;
  } catch {
    state.board = prepareBoard(fallback);
    state.live = false;
  }
  state.signature = signatureOf(state.board);
  state.lastSync = Date.now();
  await startLeadership();
  renderMenus();
  route();
  updateSyncLabel();
  if (!PREVIEW) {
    setInterval(refresh, POLL_MS);
    setInterval(refreshLeadership, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - state.lastSync > 20_000) refresh(); });
  }
  setInterval(updateSyncLabel, 10_000);
}

async function refresh() {
  if (document.hidden) return;
  try {
    const next = await loadBoard();
    const signature = signatureOf(next);
    state.lastSync = Date.now();
    const changed = signature !== state.signature;
    const wasOffline = !state.live;
    state.live = true;
    if (changed) {
      state.board = next;
      state.signature = signature;
      renderMenus();
      route({ preserveScroll: true, instant: true });
      if (!byId("searchPanel").hidden) renderSearch(byId("globalSearch").value);
      toast(wasOffline ? "Connection restored — network synced" : "Network updated from Trello");
    }
  } catch {
    state.live = false;
  }
  updateSyncLabel();
}

function updateSyncLabel() {
  const pill = byId("syncPill");
  if (!state.board) return;
  if (state.board.preview) {
    pill.dataset.state = "preview";
    byId("syncStatus").textContent = "Preview data";
    byId("footerSync").textContent = "Preview network · sample content";
    byId("droid").dataset.state = "preview";
    return;
  }
  pill.dataset.state = state.live ? "live" : "offline";
  byId("droid").dataset.state = pill.dataset.state;
  const seconds = Math.round((Date.now() - state.lastSync) / 1000);
  const ago = seconds < 45 ? "just now" : seconds < 3600 ? `${Math.round(seconds / 60)} min ago` : `${Math.round(seconds / 3600)} h ago`;
  byId("syncStatus").textContent = state.live ? "Live" : "Reconnecting";
  byId("footerSync").textContent = state.live ? `Synced with Trello · ${ago}` : `Trello unreachable · last synced ${ago}`;
}

/* ───────── Helpers ───────── */
function slug(value = "") {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
}
const link = (path) => (PREVIEW ? `#${path}` : path);
function currentPath() { return PREVIEW ? (location.hash.replace(/^#/, "") || "/") : location.pathname; }
function sectionHref(section) { return link(`/vault/${slug(section.name)}`); }
function recordHref(record) { return link(`/record/${encodeURIComponent(record.id)}/${slug(record.name)}`); }
function allRecords() { return state.board.lists.flatMap((section, sectionIndex) => section.cards.map((record, recordIndex) => ({ ...record, section, sectionIndex, recordIndex }))); }
function searchableRecords() { return allRecords().filter((record) => !record.titleOnly); }
function imageAttachments(record) { return (record.attachments || []).filter((item) => item.isImage && item.imageUrl); }
function primaryImage(record) {
  const images = imageAttachments(record);
  return images.find((item) => item.id === record.coverAttachmentId) || images[0] || null;
}
const pad = (number) => String(number).padStart(2, "0");
function roman(number) {
  const map = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = ""; for (const [value, numeral] of map) while (number >= value) { out += numeral; number -= value; }
  return out;
}
function readingTime(source = "") { return Math.max(1, Math.round(stripMarkdown(source).split(/\s+/).filter(Boolean).length / 220)); }
function chips(record) {
  const labels = (record.labels || []).filter((label) => label.name);
  if (!labels.length) return "";
  return `<span class="chips">${labels.map((label) => `<span class="chip" style="--chip:${LABEL_COLORS[(label.color || "").split("_")[0]] || "#d4ad68"}">${escapeHtml(label.name)}</span>`).join("")}</span>`;
}
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
function recordLabel(record) { return record.code ? `<span class="record-code">${escapeHtml(record.code)}</span>${escapeHtml(record.title)}` : escapeHtml(record.title); }

/* One-shot seeded PRNG (same FNV-1a + integer-mix technique as glyph() below),
 * returning a single float in [0, 1) for a given string seed. */
function seededRandom(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  h |= 0; h = (h + 0x6d2b79f5) | 0;
  let t = Math.imul(h ^ (h >>> 15), 1 | h);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/* "Holocron of the day": the same record for every visitor, all day (UTC),
 * with no storage anywhere — each record is scored by hashing today's date
 * together with its own id (a rendezvous/highest-random-weight hash), and the
 * highest score wins. Stable if the board changes elsewhere: adding or
 * removing an unrelated card never perturbs today's pick, only removing the
 * pick itself would (in which case a new highest score just takes over). */
function holocronOfTheDay(records) {
  if (!records.length) return null;
  const dayKey = new Date().toISOString().slice(0, 10);
  let best = null, bestScore = -1;
  for (const record of records) {
    const score = seededRandom(`${dayKey}:${record.id}`);
    if (score > bestScore) { bestScore = score; best = record; }
  }
  return best;
}

/* A deterministic sigil per section/record, so entries without artwork still have a face. */
function glyph(seed = "") {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rand = () => { h |= 0; h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const point = (radius, angle) => `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  const polygon = (sides, radius, rotation) => Array.from({ length: sides }, (_, i) => point(radius, rotation + (i / sides) * Math.PI * 2)).join(" ");
  const sides = 3 + Math.floor(rand() * 4);
  const inner = 3 + Math.floor(rand() * 3);
  const rotation = -Math.PI / 2;
  const twist = rotation + (rand() > .5 ? Math.PI / sides : 0);
  const ticks = [12, 18, 24, 36][Math.floor(rand() * 4)];
  const spokes = rand() > .4;
  const tickMarks = Array.from({ length: ticks }, (_, i) => {
    const angle = (i / ticks) * Math.PI * 2; const long = i % 3 === 0;
    return `<path d="M${point(long ? 41 : 43, angle)} L${point(46, angle)}"/>`;
  }).join("");
  const spokeMarks = spokes ? Array.from({ length: sides }, (_, i) => `<path d="M${point(7, rotation + (i / sides) * Math.PI * 2)} L${point(34, rotation + (i / sides) * Math.PI * 2)}"/>`).join("") : "";
  return `<svg class="glyph" viewBox="-50 -50 100 100" aria-hidden="true"><g class="glyph-ring"><circle r="48"/>${tickMarks}<circle r="38" stroke-dasharray="${(2 + rand() * 6).toFixed(1)} ${(2 + rand() * 5).toFixed(1)}"/></g><g class="glyph-core"><polygon points="${polygon(sides, 34, rotation)}"/><polygon points="${polygon(inner, 18, twist)}"/>${spokeMarks}<circle r="7"/><circle class="glyph-dot" r="2.2"/></g></svg>`;
}

/* ───────── Routing ───────── */
function route(options = {}) {
  const render = () => {
    const parts = currentPath().split("/").filter(Boolean);
    if (!parts.length) return renderHome(options);
    if (parts[0] === "vault") {
      const section = state.board.lists.find((item) => slug(item.name) === parts[1]);
      return section ? renderSection(section, options) : renderNotFound();
    }
    if (parts[0] === "record") {
      const record = allRecords().find((item) => item.id === decodeURIComponent(parts[1] || ""));
      return record ? renderRecord(record, options) : renderNotFound();
    }
    if (parts[0] === "awards") return renderAwards(options);
    if (parts[0] === "leadership") {
      if (!leadershipState.board) return renderNotFound();
      if (parts.length === 1) return renderLeadershipHome(options);
      if (parts[1] === "group") {
        const section = leadershipState.board.lists.find((item) => slug(item.name) === parts[2]);
        return section ? renderLeadershipGroup(section, options) : renderNotFound();
      }
      if (parts[1] === "record") {
        const record = allLeadershipRecords().find((item) => item.id === decodeURIComponent(parts[2] || ""));
        return record ? renderRecord(record, options, LEADERSHIP_NAV) : renderNotFound();
      }
      return renderNotFound();
    }
    renderNotFound();
  };
  if (document.startViewTransition && !reducedMotion.matches && !options.instant && !document.hidden) {
    const transition = document.startViewTransition(render);
    transition.ready.catch(() => {}); transition.finished.catch(() => {}); // a skipped transition still renders
  } else render();
}
function navigate(href) {
  const path = href.replace(/^#/, "") || "/";
  closeSearch(); closeMenus();
  if (path === currentPath()) { scrollTo({ top: 0, behavior: "smooth" }); return; }
  const perform = () => { if (PREVIEW) location.hash = path; else { history.pushState({}, "", path); route({ instant: true }); } };
  if (isRecordPath(path) && !reducedMotion.matches && !warping) hyperspaceJump(perform);
  else perform();
}
const isRecordPath = (path) => { const parts = path.split("/").filter(Boolean); return parts[0] === "record" || (parts[0] === "leadership" && parts[1] === "record"); };

/* A Star Wars-flavoured way to arrive at a holocron, hand-timed in beats rather
 * than one automatic cross-fade:
 *   1. A brief, purely-timed beat — the page holds exactly as it looked before
 *      the click, no fade or filter, so the click itself reads as the trigger.
 *   2. A canvas-drawn field of streaks accelerates outward from a point into a
 *      bright converging tunnel. The actual page swap happens the instant it
 *      reaches full coverage, hidden completely behind it.
 *   3. The streaks keep rushing outward while fading out, and the arriving
 *      record expands from that same point to fill the screen (#app.warp-arrive)
 *      underneath them — "bursting out of hyperspace" into the record. */
const hyperspaceCanvas = byId("hyperspace");
const hctx = hyperspaceCanvas.getContext("2d");
let hyperspaceField = [];
function resizeHyperspaceCanvas() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  hyperspaceCanvas.width = innerWidth * ratio;
  hyperspaceCanvas.height = innerHeight * ratio;
  hctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
resizeHyperspaceCanvas();
window.addEventListener("resize", resizeHyperspaceCanvas, { passive: true });

const makeHyperspaceField = (count) => Array.from({ length: count }, () => ({
  angle: Math.random() * Math.PI * 2,
  dist: Math.random() * 60,          // staggered starting offsets, so streaks don't all begin in lockstep
  speed: .55 + Math.random() * 1.65, // per-streak speed multiplier
  width: 1 + Math.random() * 1.8,
  hue: Math.random(),                // picks the streak's tint below
}));
/* motion (0 → ~1.6) drives position/length and can run past 1 to keep streaks
 * flying outward during the recede phase; alpha (1 → 0) fades everything out
 * independently, so the tunnel can keep moving while it dissolves. */
function drawHyperspaceFrame(motion, alpha) {
  const w = innerWidth, h = innerHeight, cx = w / 2, cy = h / 2;
  const maxR = Math.hypot(cx, cy);
  hctx.clearRect(0, 0, w, h);
  const bgAlpha = Math.min(1, motion / .3) * alpha;
  if (bgAlpha > .003) { hctx.fillStyle = `rgba(11,10,15,${bgAlpha.toFixed(3)})`; hctx.fillRect(0, 0, w, h); }
  if (motion < .02 || alpha <= 0) return;
  const accel = Math.pow(Math.min(motion, 1.6), 1.5);
  const accelClamped = Math.min(accel, 1);
  hctx.lineCap = "round";
  for (const p of hyperspaceField) {
    const dist = accel * maxR * .5 + p.dist * (.3 + accel * 2.2) * p.speed;
    const len = 6 + accel * maxR * 1.2 * p.speed * (.5 + p.hue * .4);
    const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
    const streakAlpha = Math.min(1, accel * 1.8) * (.55 + p.hue * .45) * alpha;
    if (streakAlpha <= .01) continue;
    const color = p.hue > .82 ? "201,162,77" : p.hue > .5 ? "155,89,182" : "225,222,245";
    hctx.strokeStyle = `rgba(${color},${streakAlpha.toFixed(3)})`;
    hctx.lineWidth = p.width * (.5 + accelClamped * 1.4);
    hctx.beginPath();
    hctx.moveTo(cx + cos * dist, cy + sin * dist);
    hctx.lineTo(cx + cos * (dist + len), cy + sin * (dist + len));
    hctx.stroke();
  }
  const coreAlpha = Math.min(1, accel * 1.5) * alpha;
  if (coreAlpha > .01) {
    const coreR = 4 + accelClamped * 60;
    const core = hctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    core.addColorStop(0, `rgba(255,255,255,${coreAlpha.toFixed(3)})`);
    core.addColorStop(1, "rgba(255,255,255,0)");
    hctx.fillStyle = core;
    hctx.beginPath(); hctx.arc(cx, cy, coreR, 0, Math.PI * 2); hctx.fill();
  }
}

const HYPERSPACE_STOP_MS = 90;
const HYPERSPACE_JUMP_MS = 620;   // streak field accelerating to full screen coverage
const HYPERSPACE_ARRIVE_MS = 560; // streaks receding + #app expanding, together
let warping = false;
function hyperspaceJump(swap) {
  warping = true;
  hyperspaceField = makeHyperspaceField(Math.round(Math.min(380, Math.max(140, innerWidth / 4))));
  resizeHyperspaceCanvas();
  hyperspaceCanvas.classList.add("visible");
  // A short, purely-timed beat with no visual change of its own — the page holds
  // for a moment exactly as it looked before the click, so the cut into the
  // streak field feels like the click itself triggered the jump, not a fade.
  setTimeout(() => {
    const jumpStart = performance.now();
    const tickJump = (now) => {
      const t = Math.min(1, (now - jumpStart) / HYPERSPACE_JUMP_MS);
      drawHyperspaceFrame(t, 1);
      if (t < 1) requestAnimationFrame(tickJump);
      else onJumpComplete();
    };
    requestAnimationFrame(tickJump);
    function onJumpComplete() {
      swap(); // hidden behind the now fully-opaque canvas
      app.classList.remove("warp-arrive");
      void app.offsetWidth; // restart the animation even on rapid re-clicks
      app.classList.add("warp-arrive");
      const arriveStart = performance.now();
      const tickArrive = (now) => {
        const t = Math.min(1, (now - arriveStart) / HYPERSPACE_ARRIVE_MS);
        drawHyperspaceFrame(1 + t * .6, 1 - t);
        if (t < 1) requestAnimationFrame(tickArrive);
        else {
          hyperspaceCanvas.classList.remove("visible");
          app.classList.remove("warp-arrive");
          warping = false;
        }
      };
      requestAnimationFrame(tickArrive);
    }
  }, HYPERSPACE_STOP_MS);
}
function afterRender(options = {}) {
  bindImageFallbacks(app); bindMotion(app); observeReveals(app);
  if (!options.preserveScroll) { scrollTo({ top: 0, behavior: "auto" }); app.focus({ preventScroll: true }); }
  updateProgress();
}

/* ───────── Views ───────── */
function renderMenus() {
  byId("sectionsPopover").innerHTML = state.board.lists.map((section, index) => `<a href="${sectionHref(section)}" data-link><em>${roman(index + 1)}</em><span>${escapeHtml(section.name)}</span><small>${section.cards.length}</small></a>`).join("");
}

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`;
const RANDOM_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`;
/* Shared by the header's persistent Random button and the hero's copy of it. */
function jumpToRandomRecord() {
  const records = searchableRecords();
  if (!records.length) return;
  let pick = records[Math.floor(Math.random() * records.length)];
  const current = currentPath();
  for (let guard = 0; guard < 8 && records.length > 1 && recordHref(pick) === current; guard += 1) {
    pick = records[Math.floor(Math.random() * records.length)];
  }
  droidReact("Locating a record at random.");
  navigate(recordHref(pick));
}

/* ───────── Probe droid ─────────
 * A small mascot, not tied to any page's own render cycle, so it's wired once
 * here rather than in afterRender(). Its eye colour is driven by updateSyncLabel()
 * (see state.live handling above). On larger screens it quietly patrols the
 * viewport perimeter; pointer events make it draggable with mouse or touch. */
const DROID_QUIPS = [
  "Scanning for rebel activity.",
  "This signal originates from a Sith temple.",
  "Beep. Boop. Holocron located.",
  "No lifeforms detected. Only records.",
  "Transmitting coordinates to the Emperor.",
  "Careful. Some holocrons bite back.",
  "I have catalogued worse archives than this.",
  "Do not touch the artefacts. I am watching.",
];
let droidBubbleTimer;
const droidMotion = { x: 0, y: 0, pointerId: null, offsetX: 0, offsetY: 0, startX: 0, startY: 0, dragged: false, suppressClick: false, patrolIndex: 0, patrolTimer: 0, resumeTimer: 0 };
function showDroidBubble(text) {
  const bubble = byId("droidBubble");
  bubble.textContent = text;
  bubble.classList.add("show");
  clearTimeout(droidBubbleTimer);
  droidBubbleTimer = setTimeout(() => bubble.classList.remove("show"), 2600);
}
function droidReact(line) {
  const droid = byId("droid");
  droid.classList.remove("startled");
  void droid.offsetWidth; // restart the animation even on rapid re-triggers
  droid.classList.add("startled");
  showDroidBubble(line || DROID_QUIPS[Math.floor(Math.random() * DROID_QUIPS.length)]);
}
function droidLimits() {
  const droid = byId("droid");
  const margin = innerWidth <= 760 ? 10 : 18;
  const headerBottom = byId("siteHeader")?.getBoundingClientRect().bottom || 0;
  return { minX: margin, maxX: Math.max(margin, innerWidth - droid.offsetWidth - margin), minY: Math.max(margin, headerBottom + 12), maxY: Math.max(margin, innerHeight - droid.offsetHeight - margin) };
}
function clampDroid(x, y) {
  const limits = droidLimits();
  return { x: Math.min(limits.maxX, Math.max(limits.minX, x)), y: Math.min(limits.maxY, Math.max(Math.min(limits.minY, limits.maxY), y)) };
}
function placeDroid(x, y, duration = 0) {
  const droid = byId("droid");
  const next = clampDroid(x, y);
  droidMotion.x = next.x; droidMotion.y = next.y;
  droid.style.setProperty("--droid-travel", `${duration}s`);
  droid.style.setProperty("--droid-x", `${next.x}px`);
  droid.style.setProperty("--droid-y", `${next.y}px`);
  droid.dataset.side = next.x + droid.offsetWidth / 2 < innerWidth / 2 ? "left" : "right";
  droid.dataset.vertical = next.y + droid.offsetHeight / 2 < innerHeight / 2 ? "top" : "bottom";
}
function droidWaypoints() {
  const { minX, maxX, minY, maxY } = droidLimits();
  const span = Math.max(0, maxY - minY);
  return [
    { x: maxX, y: maxY },
    { x: maxX, y: minY + span * .48 },
    { x: maxX, y: minY },
    { x: minX, y: minY },
    { x: minX, y: minY + span * .52 },
    { x: minX, y: maxY },
  ];
}
function stopDroidPatrol() {
  clearTimeout(droidMotion.patrolTimer); clearTimeout(droidMotion.resumeTimer);
}
function scheduleDroidPatrol(delay = 4200) {
  clearTimeout(droidMotion.patrolTimer);
  if (reducedMotion.matches || innerWidth <= 760 || droidMotion.pointerId !== null || document.hidden) return;
  droidMotion.patrolTimer = setTimeout(() => {
    const points = droidWaypoints();
    droidMotion.patrolIndex = (droidMotion.patrolIndex + 1) % points.length;
    const next = points[droidMotion.patrolIndex];
    const distance = Math.hypot(next.x - droidMotion.x, next.y - droidMotion.y);
    const duration = Math.min(10, Math.max(5, distance / 82));
    placeDroid(next.x, next.y, duration);
    scheduleDroidPatrol(duration * 1000 + 2600 + Math.random() * 2200);
  }, delay);
}
function resumeDroidPatrol(delay = 14000) {
  clearTimeout(droidMotion.resumeTimer);
  droidMotion.resumeTimer = setTimeout(() => scheduleDroidPatrol(0), delay);
}
function persistDroidPosition() {
  const limits = droidLimits();
  const width = Math.max(1, limits.maxX - limits.minX); const height = Math.max(1, limits.maxY - limits.minY);
  try { localStorage.setItem("tso-droid-position-v1", JSON.stringify({ x: (droidMotion.x - limits.minX) / width, y: (droidMotion.y - limits.minY) / height })); } catch {}
}
function initDroid() {
  const droid = byId("droid");
  const limits = droidLimits();
  let initial = { x: limits.maxX, y: limits.maxY };
  try {
    const saved = JSON.parse(localStorage.getItem("tso-droid-position-v1") || "null");
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) initial = { x: limits.minX + (limits.maxX - limits.minX) * saved.x, y: limits.minY + (limits.maxY - limits.minY) * saved.y };
  } catch {}
  placeDroid(initial.x, initial.y);
  droid.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const box = droid.getBoundingClientRect();
    stopDroidPatrol();
    droidMotion.pointerId = event.pointerId; droidMotion.dragged = false;
    droidMotion.startX = event.clientX; droidMotion.startY = event.clientY;
    droidMotion.offsetX = event.clientX - box.left; droidMotion.offsetY = event.clientY - box.top;
    droid.classList.add("is-dragging");
    droid.setPointerCapture(event.pointerId);
    placeDroid(box.left, box.top);
  });
  droid.addEventListener("pointermove", (event) => {
    if (event.pointerId !== droidMotion.pointerId) return;
    if (Math.hypot(event.clientX - droidMotion.startX, event.clientY - droidMotion.startY) > 5) droidMotion.dragged = true;
    placeDroid(event.clientX - droidMotion.offsetX, event.clientY - droidMotion.offsetY);
  });
  const release = (event) => {
    if (event.pointerId !== droidMotion.pointerId) return;
    if (droid.hasPointerCapture(event.pointerId)) droid.releasePointerCapture(event.pointerId);
    droid.classList.remove("is-dragging");
    droidMotion.pointerId = null;
    if (droidMotion.dragged) {
      droidMotion.suppressClick = true;
      persistDroidPosition();
      showDroidBubble("Position logged. Patrol resuming shortly.");
      setTimeout(() => { droidMotion.suppressClick = false; }, 500);
    }
    resumeDroidPatrol();
  };
  droid.addEventListener("pointerup", release);
  droid.addEventListener("pointercancel", release);
  droid.addEventListener("click", () => { if (!droidMotion.suppressClick) droidReact(); });
  window.addEventListener("resize", () => { placeDroid(droidMotion.x, droidMotion.y); scheduleDroidPatrol(2400); }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopDroidPatrol(); else scheduleDroidPatrol(2200); });
  scheduleDroidPatrol();
}
const HERO_SIGIL = `<svg viewBox="-100 -100 200 200" aria-hidden="true">
  <g class="ring r1" stroke-width=".6"><circle r="96"/>${Array.from({ length: 72 }, (_, i) => { const a = (i / 72) * Math.PI * 2, r = i % 6 === 0 ? 86 : 91; return `<path d="M${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)} L${(Math.cos(a) * 96).toFixed(1)},${(Math.sin(a) * 96).toFixed(1)}"/>`; }).join("")}</g>
  <g class="ring r2" stroke-width=".7"><circle r="78" stroke-dasharray="2 7"/><circle r="72" stroke-dasharray="40 14 6 14"/><circle class="orb" cx="78" cy="0" r="2.4"/><circle class="orb" cx="-78" cy="0" r="1.5"/></g>
  <g class="ring r3" stroke-width=".8"><circle r="60" stroke-dasharray="1 5"/><circle class="spark" cx="0" cy="-60" r="2"/><circle class="spark" cx="0" cy="60" r="2"/></g>
  <g class="holocron">
    <polygon class="facet warm" points="0,-50 42,32 0,10"/><polygon class="facet" points="0,-50 -42,32 0,10"/><polygon class="facet warm" points="-42,32 42,32 0,10"/>
    <path class="edge" pathLength="100" stroke-width="1.6" stroke-linejoin="round" d="M0,-50 L42,32 L-42,32 Z"/>
    <path class="edge inner" pathLength="100" stroke-width="1.1" d="M0,-50 L0,10 M-42,32 L0,10 L42,32"/>
    <circle class="core" cx="0" cy="8" r="4"/>
  </g>
</svg>`;

function renderHome(options) {
  document.title = `${state.board.name || "TSO"} — Holocron Network`;
  const records = searchableRecords();
  const tickerItems = records.map((record) => `<a href="${recordHref(record)}" data-link tabindex="-1">${escapeHtml(record.name)}</a>`).join("");
  const spotlight = holocronOfTheDay(records);
  const spotlightImage = spotlight ? primaryImage(spotlight) : null;
  app.innerHTML = `<div class="page">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">The Sith Order</div>
        <h1 class="hero-title"><span>Holocron</span><span>Network</span></h1>
        <p class="hero-lead">${escapeHtml(state.board.description || "The holocron network of the Sith Order: every vault, every record, every keeper.")}</p>
        <div class="hero-search-row">
          <form class="hero-search" role="search" id="heroSearch">
            ${SEARCH_ICON}
            <input type="search" placeholder="Search holocrons, vaults, keepers…" autocomplete="off" aria-label="Search the network" />
            <kbd aria-hidden="true">/</kbd>
          </form>
          <button type="button" class="hero-random" id="heroRandomButton" title="Jump to a random holocron">${RANDOM_ICON}<span>Random</span></button>
        </div>
        <div class="hero-actions"><a class="btn" href="#sections" data-scroll>Enter the vaults <span aria-hidden="true">↓</span></a></div>
      </div>
      <div class="hero-sigil" id="heroSigil">${HERO_SIGIL}</div>
    </section>
    ${records.length > 3 ? `<div class="ticker" aria-hidden="true"><div class="ticker-track" style="--ticker-time:${Math.max(30, records.length * 4)}s">${tickerItems}${tickerItems}</div></div>` : ""}
    ${spotlight ? `<div class="rule"><i></i>Holocron of the day<i></i></div>
    <a class="spotlight" href="${recordHref(spotlight)}" data-link data-reveal data-seed="${escapeAttr(spotlight.id)}">
      <div class="spotlight-art">${spotlightImage ? `<img src="${escapeAttr(spotlightImage.imageUrl)}" alt="" loading="lazy" />` : glyph(spotlight.id)}</div>
      <div class="spotlight-body">
        <div class="spotlight-top"><span class="eyebrow">${escapeHtml(spotlight.section.name)}</span><span class="spotlight-date">${escapeHtml(formatDate(new Date()))}</span></div>
        <h2>${recordLabel(spotlight)}</h2>
        <p>${escapeHtml(excerpt(spotlight))}</p>
        ${chips(spotlight)}
        <span class="spotlight-cta">Open this record <span aria-hidden="true">→</span></span>
      </div>
    </a>` : ""}
    <div class="rule" id="sections"><i></i>Vaults of the network<i></i></div>
    <section class="section-index" aria-label="Network vaults">
      ${state.board.lists.map((section, index) => `<a class="holo" href="${sectionHref(section)}" data-link data-reveal style="--d:${Math.min(index * 70, 420)}ms">
        ${glyph(section.id + section.name)}
        <div class="holo-top"><span>Vault ${roman(index + 1)}</span><span>${plural(section.cards.length, "record")}</span></div>
        <h2>${escapeHtml(section.name)}</h2>
        ${section.tagline ? `<p class="holo-tagline">${escapeHtml(section.tagline)}</p>` : ""}
        ${section.cards.length ? `<ul>${section.cards.slice(0, 3).map((record) => `<li>${recordLabel(record)}</li>`).join("")}</ul>` : `<ul><li>Awaiting records</li></ul>`}
        <span class="holo-arrow" aria-hidden="true">→</span>
      </a>`).join("")}
    </section>
  </div>`;
  const search = byId("heroSearch");
  search.addEventListener("submit", (event) => { event.preventDefault(); openSearch(search.querySelector("input").value); });
  search.querySelector("input").addEventListener("focus", () => openSearch(search.querySelector("input").value));
  byId("heroRandomButton").addEventListener("click", jumpToRandomRecord);
  afterRender(options);
}

function renderSection(section, options) {
  document.title = `${section.name} — TSO Holocron Network`;
  const index = state.board.lists.indexOf(section);
  const filterable = section.cards.filter((record) => !record.titleOnly).length > 3;
  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Network</a><span aria-hidden="true">◆</span><span>${escapeHtml(section.name)}</span></nav>
    <header class="section-header${section.art ? " has-art" : ""}">
      ${section.art ? `<img class="section-art" src="${escapeAttr(section.art.imageUrl)}" alt="" />` : glyph(section.id + section.name)}
      <div class="eyebrow">Vault ${roman(index + 1)}</div>
      <h1>${escapeHtml(section.name)}</h1>
      ${section.tagline ? `<p class="section-tagline">${escapeHtml(section.tagline)}</p>` : ""}
      <div class="section-tools">
        <span id="sectionCount">${plural(section.cards.length, "record")} on file</span>
        ${filterable ? `<label class="filter">${SEARCH_ICON}<input id="sectionFilter" type="search" placeholder="Filter this vault…" autocomplete="off" aria-label="Filter records in this vault" /></label>` : ""}
      </div>
    </header>
    <section class="record-list" id="recordList" aria-label="Records in ${escapeAttr(section.name)}">
      ${section.cards.length ? section.cards.map((record, i) => recordRow(record, i)).join("") : `<p class="no-match">No records are currently filed in this vault.</p>`}
      <p class="no-match" id="noMatch" hidden>No records in this vault match that filter.</p>
    </section>
  </div>`;
  byId("sectionFilter")?.addEventListener("input", (event) => {
    const value = event.target.value.trim().toLowerCase(); let shown = 0;
    app.querySelectorAll(".record-row").forEach((row) => { const hit = !value || row.dataset.text.includes(value); row.hidden = !hit; if (hit) shown += 1; });
    byId("noMatch").hidden = shown > 0;
    byId("sectionCount").textContent = value ? `${shown} of ${plural(section.cards.length, "record")}` : `${plural(section.cards.length, "record")} on file`;
  });
  afterRender(options);
}

function recordRow(record, index = 0, hrefFn = recordHref) {
  const image = primaryImage(record);
  const text = escapeAttr(`${record.name} ${stripMarkdown(record.description)}`.toLowerCase());
  const number = record.code ? `<span class="record-num is-code">${escapeHtml(record.code)}</span>` : `<span class="record-num">${pad(index + 1)}</span>`;
  if (record.titleOnly) {
    return `<div class="record-row is-static" data-reveal data-text="${text}" style="--d:${Math.min(index * 50, 300)}ms">
      ${number}<div><h2>${escapeHtml(record.title)}</h2>${chips(record)}</div>
    </div>`;
  }
  return `<a class="record-row" href="${hrefFn(record)}" data-link data-reveal data-seed="${escapeAttr(record.id)}" data-text="${text}" style="--d:${Math.min(index * 50, 300)}ms">
    ${number}
    <div><h2>${escapeHtml(record.title)}</h2><p>${escapeHtml(excerpt(record))}</p>${chips(record)}</div>
    ${image ? `<div class="record-image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(image.name || record.name)}" loading="lazy" /></div>` : `<div class="record-image is-glyph">${glyph(record.id)}</div>`}
    <span class="record-arrow" aria-hidden="true">→</span>
  </a>`;
}

/* Some leadership cards are a running succession record — a bold "**First
 * Lord Commandant:**"-style heading followed by a flat "Key: Value" bullet
 * list, repeated once per office-holder — rather than ordinary prose. Two or
 * more of those headings is treated as a succession list and drawn as a
 * timeline (see successionTimeline); anything else still goes through the
 * regular markdown() renderer. Real Trello formatting is messy (a stray line
 * that isn't a proper bullet, an accidentally-escaped "\-"), so a field with
 * no value collects whatever non-field lines follow it as a sub-list rather
 * than requiring clean bullets. */
/* Shared by both succession shapes below: a flat "Key: Value" bullet list.
 * A field with no value (e.g. "Positions Held:") starts collecting whatever
 * non-field lines follow it as a sub-list, so a stray line that isn't a
 * clean bullet (an accidentally-escaped "\- Prefect") still lands in the
 * right place instead of breaking the layout. */
function parseFieldLines(lines) {
  const fields = [];
  let listField = null;
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const text = trimmed.replace(/^[-*+]\s+/, "").replace(/^\\+-\s*/, "").trim();
    const field = text.match(/^([A-Za-z][A-Za-z ]{0,40}):\s*(.*)$/);
    if (field) {
      const parsed = { key: field[1].trim(), value: field[2].trim(), items: null };
      if (!parsed.value) parsed.items = [];
      fields.push(parsed);
      listField = parsed.items ? parsed : null;
    } else if (listField) {
      listField.items.push(text);
    }
  }
  return fields;
}
function pullField(fields, key) {
  const at = fields.findIndex((f) => f.key.toLowerCase() === key);
  return at < 0 ? null : fields.splice(at, 1)[0];
}
const ORDINAL_WORDS = ["Zeroth", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"];
function ordinalWord(n) {
  if (n < ORDINAL_WORDS.length) return ORDINAL_WORDS[n];
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`;
}

/* Some leadership cards are a running succession record — a bold "**First
 * Lord Commandant:**"-style heading followed by a flat "Key: Value" bullet
 * list, repeated once per office-holder — rather than ordinary prose. Two or
 * more of those headings is treated as a succession list and drawn as a
 * timeline (see successionTimeline); anything else still goes through the
 * regular markdown() renderer. */
function parseSuccession(description = "") {
  const lines = cleanText(description).split("\n");
  const headingEra = (line) => {
    const match = line.trim().match(/^\*\*(.+?)\*\*:?\s*$/);
    return match ? match[1].replace(/:\s*$/, "").trim() : null;
  };
  const headings = [];
  lines.forEach((line, index) => { const era = headingEra(line); if (era) headings.push({ era, index }); });
  if (headings.length < 2) return null;

  const preamble = markdown(lines.slice(0, headings[0].index).join("\n"));
  const entries = headings.map((heading, i) => {
    const end = i + 1 < headings.length ? headings[i + 1].index : lines.length;
    const fields = parseFieldLines(lines.slice(heading.index + 1, end));
    const name = pullField(fields, "username");
    const status = pullField(fields, "status");
    return { era: heading.era, name: name?.value || "", status: status?.value || "", fields };
  });
  return { preamble, entries };
}

/* Some offices (Wrath, Hand, Voice, Regent, Emperor…) keep each holder as its
 * own separate Trello card instead of one card with multiple "**First X:**"
 * sections — the group's roster is turned into the same timeline instead, one
 * entry per card, ordered as the board already orders them. Requires at least
 * two cards to actually parse into fields, so a group that merely shares a
 * name with an office but holds ordinary prose records falls back to the
 * normal flat roster untouched. */
const OFFICE_KEYWORDS = ["wrath", "hand", "voice", "regent", "emperor"];
function isOfficeGroup(name = "") {
  const normalised = name.toLowerCase();
  return OFFICE_KEYWORDS.some((word) => new RegExp(`\\b${word}\\b`).test(normalised));
}
function successionFromGroup(section) {
  if (!isOfficeGroup(section.name)) return null;
  const records = section.cards.filter((record) => !record.titleOnly);
  if (records.length < 2) return null;
  let matched = 0;
  const entries = records.map((record, index) => {
    const fields = parseFieldLines(cleanText(record.description).split("\n"));
    if (fields.length) matched += 1;
    const name = pullField(fields, "username");
    const status = pullField(fields, "status");
    return {
      era: `${ordinalWord(index + 1)} ${section.name}`,
      name: name?.value || record.title,
      status: status?.value || "",
      fields,
      image: primaryImage(record),
      href: leadershipRecordHref(record)
    };
  });
  return matched >= 2 ? entries : null;
}

function successionTimeline(entries) {
  return `<div class="succession-timeline">${entries.map((entry, index) => {
    const tag = entry.href ? "a" : "div";
    const linkAttrs = entry.href ? ` href="${escapeAttr(entry.href)}" data-link` : "";
    return `
    <div class="succession-entry" data-reveal style="--d:${Math.min(index * 90, 480)}ms">
      <span class="succession-dot" aria-hidden="true"></span>
      <${tag} class="succession-card"${linkAttrs}>
        <div class="succession-top">
          <span class="succession-era">${escapeHtml(entry.era)}</span>
          ${entry.status ? `<span class="succession-status${/active|current|serving/i.test(entry.status) ? " is-active" : ""}">${escapeHtml(entry.status)}</span>` : ""}
        </div>
        ${entry.name || entry.image ? `<div class="succession-name-row">${entry.image ? `<img class="succession-portrait" src="${escapeAttr(entry.image.imageUrl)}" alt="" loading="lazy" />` : ""}${entry.name ? `<h3>${inline(entry.name)}</h3>` : ""}</div>` : ""}
        ${entry.fields.length ? `<dl class="succession-fields">${entry.fields.map((field) => `<div><dt>${escapeHtml(field.key)}</dt><dd>${field.items ? (field.items.length > 1 ? `<ul>${field.items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>` : inline(field.items[0] || "")) : inline(field.value)}</dd></div>`).join("")}</dl>` : ""}
      </${tag}>
    </div>`;
  }).join("")}
  </div>`;
}

function renderRecord(record, options, nav = {}) {
  const crumb = nav.crumb || [{ href: link("/"), label: "Network" }];
  const groupHref = nav.groupHref || sectionHref;
  const recordHrefFn = nav.recordHrefFn || recordHref;
  document.title = `${record.name} — TSO Holocron Network`;
  const images = imageAttachments(record);
  const hero = primaryImage(record);
  const documents = (record.attachments || []).filter((item) => !item.isImage);
  const siblings = record.section.cards;
  const current = siblings.findIndex((item) => item.id === record.id);
  const previous = current > 0 ? siblings[current - 1] : null;
  const next = current < siblings.length - 1 ? siblings[current + 1] : null;
  const headings = extractHeadings(record.description);
  const figure = (image, lazy) => `<figure><button data-zoom="${escapeAttr(image.imageUrl)}" aria-label="Enlarge image"><img src="${escapeAttr(image.imageUrl)}" alt="${escapeAttr(captionOf(record))}" ${lazy ? 'loading="lazy"' : ""} /></button></figure>`;

  // Images referenced inline in the description are rendered where they appear; anything
  // left over (plus the cover, if it was not referenced inline) is shown as the gallery.
  const inlineIds = new Set();
  const succession = nav.succession ? parseSuccession(record.description) : null;
  const body = succession
    ? `${succession.preamble}${successionTimeline(succession.entries)}`
    : record.description ? markdown(record.description, { record, shown: inlineIds, hero }) : "";
  const gallery = images.filter((image) => image.id !== hero?.id && !inlineIds.has(image.id));
  const contents = !succession && headings.length > 1;
  const meta = [record.code ? `Ref ${record.code}` : `Record ${pad(current + 1)} of ${pad(siblings.length)}`, record.description ? `${readingTime(record.description)} min read` : "", dateBadge(record)].filter(Boolean);

  app.innerHTML = `<article class="page article-page">
    <nav class="breadcrumb" aria-label="Breadcrumb">${crumb.map((item) => `<a href="${item.href}" data-link>${escapeHtml(item.label)}</a><span aria-hidden="true">◆</span>`).join("")}<a href="${groupHref(record.section)}" data-link>${escapeHtml(record.section.name)}</a><span aria-hidden="true">◆</span><span>${escapeHtml(record.title)}</span></nav>
    <header class="article-header">
      <div class="eyebrow">${escapeHtml(record.section.name)}</div>
      <h1>${escapeHtml(record.title)}</h1>
      <div class="article-meta">${meta.map((item) => `<span>${item}</span>`).join("")}${chips(record)}${keepers(record)}</div>
    </header>
    ${hero ? `<div class="hero-media">${figure(hero, false)}</div>` : ""}
    <div class="article-layout${contents ? " has-contents" : ""}">
      <div class="prose">${body || `<p class="notice">${images.length ? "This holocron is illustrated only; no written record has been filed with it." : "No written record has been filed under this holocron yet."}</p>`}</div>
      ${contents ? `<aside class="article-aside" aria-label="In this record"><strong>In this record</strong>${headings.map((heading) => `<a href="#${heading.id}" data-scroll class="${heading.level === 3 ? "sub" : ""}">${escapeHtml(heading.text)}</a>`).join("")}</aside>` : ""}
    </div>
    ${ledger(record)}
    ${gallery.length ? `<div class="rule"><i></i>Holocron imagery<i></i></div><section class="gallery" aria-label="Record images">${gallery.map((image) => figure(image, true)).join("")}</section>` : ""}
    ${documents.length || record.url ? `<div class="rule"><i></i>References<i></i></div><section class="attachments"><div class="attachment-links">${documents.map((item) => `<a href="${safeUrl(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name || "Attachment")} ↗</a>`).join("")}${record.url ? `<a href="${safeUrl(record.url)}" target="_blank" rel="noopener">View source card ↗</a>` : ""}</div></section>` : ""}
    ${(previous || next) ? `<nav class="next-record" aria-label="Adjacent records">${previous ? `<a href="${recordHrefFn(previous)}" data-link><small>← Previous</small><span>${recordLabel(previous)}</span></a>` : ""}${next ? `<a class="next" href="${recordHrefFn(next)}" data-link><small>Next →</small><span>${recordLabel(next)}</span></a>` : ""}</nav>` : ""}
  </article>`;
  afterRender(options);
  if (contents) spyHeadings();
}
function dateBadge(record) {
  if (!record.due) return "";
  const done = record.dueComplete;
  return `<span class="${done ? "is-done" : "is-due"}">${done ? "Completed" : "Due"} ${escapeHtml(formatDate(record.due))}</span>`;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function keepers(record) {
  const members = (record.members || []).filter((member) => member.name);
  if (!members.length) return "";
  const initialsOf = (member) => (member.initials || member.name.split(/\s+/).map((part) => part[0]).join("")).slice(0, 2).toUpperCase();
  return `<span class="chips" aria-label="Keepers">${members.map((member) => `<span class="keeper"><i>${escapeHtml(initialsOf(member))}</i>${escapeHtml(member.name)}</span>`).join("")}</span>`;
}
/* Trello checklists on a card become a ledger: progress plus every item, ticked or not. */
function ledger(record) {
  const lists = (record.checklists || []).filter((list) => list.items?.length);
  if (!lists.length) return "";
  return `<section class="ledger" aria-label="Checklists">${lists.map((list) => {
    const done = list.items.filter((item) => item.complete).length;
    return `<div class="ledger-block"><h3>${escapeHtml(list.name || "Checklist")}<small>${done} / ${list.items.length}</small></h3><div class="ledger-bar"><i style="width:${Math.round((done / list.items.length) * 100)}%"></i></div><ul>${list.items.map((item) => `<li class="${item.complete ? "done" : ""}"><span>${inline(item.name)}</span></li>`).join("")}</ul></div>`;
  }).join("")}</section>`;
}
/* Accessible alt text for a plain attachment image (hero/gallery, not one placed
 * inline in the description). A Trello attachment's filename (e.g. "IMG_2384",
 * "holocron.png") is metadata, not a caption anyone wrote on purpose, so it is
 * never shown on the page — this is only read by screen readers. */
function captionOf(record) { return record.title; }

/* The award ceremony page reads a flat, hand-maintained AWARDS_DATA (see
 * awards-data.js) rather than the live Trello board — it's a placeholder until
 * a live sheet replaces it, per the source spreadsheet. */
function renderAwards(options) {
  document.title = "Award Ceremony — TSO Holocron Network";
  const awards = typeof AWARDS_DATA !== "undefined" ? AWARDS_DATA : [];
  const latestKey = awards.reduce((latest, award) => {
    const hit = award.history.filter((h) => h.status === "awarded").at(-1);
    return hit && hit.key > latest ? hit.key : latest;
  }, "");
  const latestLabel = latestKey && awards.flatMap((a) => a.history).find((h) => h.key === latestKey)?.label;
  const ceremony = latestKey
    ? awards.map((award) => ({ award, entry: award.history.find((h) => h.key === latestKey && h.status === "awarded") })).filter((x) => x.entry)
    : [];

  const chips = (names) => `<div class="winner-chips">${names.map((name) => `<span class="winner-chip">${escapeHtml(name)}</span>`).join("")}</div>`;

  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Network</a><span aria-hidden="true">◆</span><span>Award Ceremony</span></nav>
    <div class="eyebrow">The Sith Order</div>
    <h1 class="awards-title">Award Ceremony</h1>
    <p class="awards-lead">A record of every ceremony held by the Order, and who was named at each one.</p>
    <p class="awards-static-note">◆ Static data from an uploaded ceremony log — a live sheet will replace it once it's ready.</p>

    ${ceremony.length ? `<div class="rule"><i></i>Most recent ceremony<i></i></div>
    <div class="ceremony-spotlight" data-reveal>
      <div class="eyebrow">${escapeHtml(latestLabel)}</div>
      <div class="ceremony-grid">
        ${ceremony.map(({ award, entry }) => `<div class="ceremony-item"><h3>${escapeHtml(award.name)}</h3>${chips(entry.winners)}</div>`).join("")}
      </div>
    </div>` : ""}

    <div class="rule"><i></i>Awards of the order<i></i></div>
    <section class="awards-grid">
      ${awards.map((award, index) => {
        const wins = award.history.filter((h) => h.status === "awarded");
        const recipients = wins.reduce((sum, h) => sum + h.winners.length, 0);
        const rows = [...award.history].reverse().filter((h) => h.status !== "did-not-exist");
        return `<div class="award-card" data-reveal style="--d:${Math.min(index * 60, 400)}ms">
          <div class="award-card-top"><h2>${escapeHtml(award.name)}</h2><span>${recipients} recipient${recipients === 1 ? "" : "s"}</span></div>
          <div class="award-history">
            ${rows.map((h) => h.status === "awarded"
              ? `<div class="award-row"><span class="award-row-date">${escapeHtml(h.label)}</span>${chips(h.winners)}</div>`
              : `<div class="award-row is-empty"><span class="award-row-date">${escapeHtml(h.label)}</span><span class="award-row-empty">Not awarded</span></div>`
            ).join("")}
          </div>
        </div>`;
      }).join("")}
    </section>
  </div>`;
  afterRender(options);
}

/* ───────── Leadership (a second, independently-live Trello board) ─────────
 * Same shape as the network board (lists of cards), fetched from its own
 * endpoint and polled on its own cycle, but browsed under /leadership so it
 * never collides with the main network's /vault and /record routes. */
const leadershipFallback = {
  ok: true,
  name: "TSO Leadership Records",
  description: "The ranking officers of the Sith Order, and the seats they hold.",
  lists: [
    { id: "ldr-council", name: "The Dark Council", cards: [
      { id: "ldr-sample", name: "Seat of the Sword", description: "Held by the Order's foremost warrior.", labels: [], attachments: [], members: [], checklists: [] }
    ]}
  ]
};
const leadershipState = { board: null, signature: "", lastSync: 0, live: false };
const LEADERSHIP_NAV = { crumb: [{ href: link("/"), label: "Network" }, { href: link("/leadership"), label: "Leadership" }], groupHref: (section) => leadershipGroupHref(section), recordHrefFn: (record) => leadershipRecordHref(record), succession: true };

/* The Order's ruling seats should always lead the Leadership page, ahead of
 * the Dark Council's various spheres (Sphere of Galactic Influence, Sphere
 * of Ancient Knowledge…) further down the board. Trello's own list order
 * (list.pos) still decides everything else — this only promotes whichever
 * groups match these names, in this order, and leaves the rest exactly
 * where the board already has them. */
/* Titles like "Hand of the Emperor" and "Voice of the Emperor" contain the
 * word "emperor" too, so the more specific offices are matched first —
 * otherwise they'd all collapse onto the Emperor's own rank. The numbers
 * are the desired DISPLAY order, independent of match order. */
const LEADERSHIP_OFFICES = [
  { match: "hand", rank: 2 },
  { match: "voice", rank: 3 },
  { match: "wrath", rank: 4 },
  { match: "regent", rank: 1 },
  { match: "emperor", rank: 0 },
  { match: "dark honor guard", rank: 5 }
];
function leadershipPriorityRank(name = "") {
  const normalised = name.toLowerCase();
  const office = LEADERSHIP_OFFICES.find(({ match }) => new RegExp(`\\b${match.replace(/ /g, "\\s+")}\\b`).test(normalised));
  return office ? office.rank : LEADERSHIP_OFFICES.length;
}
function orderLeadershipLists(board) {
  const ordered = board.lists
    .map((list, index) => ({ list, index }))
    .sort((a, b) => leadershipPriorityRank(a.list.name) - leadershipPriorityRank(b.list.name) || a.index - b.index)
    .map((entry) => entry.list);
  return { ...board, lists: ordered };
}

async function loadLeadershipBoard() {
  if (PREVIEW) return orderLeadershipLists(prepareBoard({ ...leadershipFallback, preview: true }));
  const response = await fetch("/api/board?board=leadership", { cache: "no-store" });
  if (!response.ok) throw new Error("Leadership board unavailable");
  const board = await response.json();
  if (!board.ok || !Array.isArray(board.lists)) throw new Error("Leadership board unavailable");
  return orderLeadershipLists(prepareBoard(board));
}
async function startLeadership() {
  try {
    leadershipState.board = await loadLeadershipBoard();
    leadershipState.live = !leadershipState.board.preview;
  } catch {
    leadershipState.board = orderLeadershipLists(prepareBoard(leadershipFallback));
    leadershipState.live = false;
  }
  leadershipState.signature = signatureOf(leadershipState.board);
  leadershipState.lastSync = Date.now();
}
async function refreshLeadership() {
  if (document.hidden || PREVIEW) return;
  try {
    const next = await loadLeadershipBoard();
    const signature = signatureOf(next);
    leadershipState.lastSync = Date.now();
    const changed = signature !== leadershipState.signature;
    leadershipState.live = true;
    if (changed) {
      leadershipState.board = next;
      leadershipState.signature = signature;
      if (currentPath().split("/").filter(Boolean)[0] === "leadership") route({ preserveScroll: true, instant: true });
    }
  } catch {
    leadershipState.live = false;
  }
}
function allLeadershipRecords() {
  return (leadershipState.board?.lists || []).flatMap((section, sectionIndex) => section.cards.map((record, recordIndex) => ({ ...record, section, sectionIndex, recordIndex })));
}
function leadershipGroupHref(section) { return link(`/leadership/group/${slug(section.name)}`); }
function leadershipRecordHref(record) { return link(`/leadership/record/${encodeURIComponent(record.id)}/${slug(record.name)}`); }

function renderLeadershipHome(options) {
  const board = leadershipState.board;
  document.title = `${board.name || "Leadership"} — TSO Holocron Network`;
  const groups = board.lists;
  const singleGroup = groups.length === 1 ? groups[0] : null;
  const singleGroupTimeline = singleGroup ? successionFromGroup(singleGroup) : null;
  const singleGroupBody = singleGroup
    ? singleGroupTimeline
      ? successionTimeline(singleGroupTimeline)
      : singleGroup.cards.length ? singleGroup.cards.map((record, i) => recordRow(record, i, leadershipRecordHref)).join("") : `<p class="no-match">No leaders are currently filed here.</p>`
    : "";
  app.innerHTML = `<div class="page leadership-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Network</a><span aria-hidden="true">◆</span><span>Leadership</span></nav>
    <div class="leadership-hero">
      <img class="leadership-guard is-left" src="/leadership-sentinel.webp" alt="" aria-hidden="true" />
      <img class="leadership-guard is-right" src="/leadership-sentinel.webp" alt="" aria-hidden="true" />
      <div class="leadership-hero-copy">
        <h1 class="eyebrow">The Sith Order</h1>
        <p class="awards-lead">${escapeHtml(board.description || "The ranking officers of the Order, and the seats they hold.")}</p>
        <p class="awards-static-note">◆ ${leadershipState.live ? "Live · synced with Trello" : "Reconnecting to Trello…"}</p>
      </div>
    </div>
    ${singleGroup ? `
    <div class="rule"><i></i>${escapeHtml(singleGroup.name)}<i></i></div>
    <section class="${singleGroupTimeline ? "succession-section" : "record-list"}" aria-label="${escapeAttr(singleGroup.name)}">
      ${singleGroupBody}
    </section>` : `
    <div class="rule"><i></i>Seats of the order<i></i></div>
    <section class="section-index" aria-label="Leadership groups">
      ${groups.map((section, index) => `<a class="holo" href="${leadershipGroupHref(section)}" data-link data-reveal style="--d:${Math.min(index * 70, 420)}ms">
        ${glyph(section.id + section.name)}
        <div class="holo-top"><span>Seat ${roman(index + 1)}</span><span>${plural(section.cards.length, "record")}</span></div>
        <h2>${escapeHtml(section.name)}</h2>
        ${section.tagline ? `<p class="holo-tagline">${escapeHtml(section.tagline)}</p>` : ""}
        ${section.cards.length ? `<ul>${section.cards.slice(0, 3).map((record) => `<li>${recordLabel(record)}</li>`).join("")}</ul>` : `<ul><li>Awaiting records</li></ul>`}
        <span class="holo-arrow" aria-hidden="true">→</span>
      </a>`).join("")}
    </section>`}
  </div>`;
  afterRender(options);
}

function renderLeadershipGroup(section, options) {
  document.title = `${section.name} — TSO Holocron Network`;
  const index = leadershipState.board.lists.indexOf(section);
  const timeline = successionFromGroup(section);
  const filterable = !timeline && section.cards.filter((record) => !record.titleOnly).length > 3;
  app.innerHTML = `<div class="page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${link("/")}" data-link>Network</a><span aria-hidden="true">◆</span><a href="${link("/leadership")}" data-link>Leadership</a><span aria-hidden="true">◆</span><span>${escapeHtml(section.name)}</span></nav>
    <header class="section-header${section.art ? " has-art" : ""}">
      ${section.art ? `<img class="section-art" src="${escapeAttr(section.art.imageUrl)}" alt="" />` : glyph(section.id + section.name)}
      <div class="eyebrow">Seat ${roman(index + 1)}</div>
      <h1>${escapeHtml(section.name)}</h1>
      ${section.tagline ? `<p class="section-tagline">${escapeHtml(section.tagline)}</p>` : ""}
      <div class="section-tools">
        <span id="sectionCount">${plural(section.cards.length, "record")} on file</span>
        ${filterable ? `<label class="filter">${SEARCH_ICON}<input id="sectionFilter" type="search" placeholder="Filter this seat…" autocomplete="off" aria-label="Filter records in this seat" /></label>` : ""}
      </div>
    </header>
    ${timeline
      ? `<section class="succession-section" aria-label="Succession of ${escapeAttr(section.name)}">${successionTimeline(timeline)}</section>`
      : `<section class="record-list" id="recordList" aria-label="Records in ${escapeAttr(section.name)}">
      ${section.cards.length ? section.cards.map((record, i) => recordRow(record, i, leadershipRecordHref)).join("") : `<p class="no-match">No records are currently filed in this seat.</p>`}
      <p class="no-match" id="noMatch" hidden>No records in this seat match that filter.</p>
    </section>`}
  </div>`;
  byId("sectionFilter")?.addEventListener("input", (event) => {
    const value = event.target.value.trim().toLowerCase(); let shown = 0;
    app.querySelectorAll(".record-row").forEach((row) => { const hit = !value || row.dataset.text.includes(value); row.hidden = !hit; if (hit) shown += 1; });
    byId("noMatch").hidden = shown > 0;
    byId("sectionCount").textContent = value ? `${shown} of ${plural(section.cards.length, "record")}` : `${plural(section.cards.length, "record")} on file`;
  });
  afterRender(options);
}

function renderNotFound() {
  document.title = "Record not found — TSO Holocron Network";
  app.innerHTML = `<div class="empty-page">${glyph("void")}<h1>Holocron not found</h1><p>This reference does not exist in the network, or it has been struck from the record.</p><a class="btn" href="${link("/")}" data-link>Return to the network</a></div>`;
  afterRender();
}

/* ───────── Search ───────── */
function openSearch(prefill) {
  closeMenus();
  const input = byId("globalSearch");
  if (typeof prefill === "string") input.value = prefill;
  byId("searchPanel").hidden = false; document.body.style.overflow = "hidden";
  input.focus(); input.setSelectionRange(input.value.length, input.value.length);
  renderSearch(input.value);
}
function closeSearch() {
  if (byId("searchPanel").hidden) return;
  byId("searchPanel").hidden = true; document.body.style.overflow = ""; byId("globalSearch").value = "";
  const hero = byId("heroSearch")?.querySelector("input");
  if (hero) { hero.value = ""; hero.blur(); }
}
function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const at = text.toLowerCase().indexOf(query);
  if (at < 0) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, at))}<mark>${escapeHtml(text.slice(at, at + query.length))}</mark>${escapeHtml(text.slice(at + query.length))}`;
}
function snippet(record, query) {
  const text = stripMarkdown(record.description.replace(/^\s*#{1,6}\s+.*$/gm, ""));
  if (!text) return "";
  const at = query ? text.toLowerCase().indexOf(query) : -1;
  const from = at > 40 ? text.lastIndexOf(" ", at - 40) + 1 : 0;
  return `${from ? "…" : ""}${text.slice(from, from + 140)}`;
}
function renderSearch(query) {
  const value = query.trim().toLowerCase();
  const records = searchableRecords();
  const rank = (record) => (record.name.toLowerCase().includes(value) ? 0 : record.section.name.toLowerCase().includes(value) ? 1 : 2);
  const matches = records.filter((record) => !value || `${record.name} ${record.description} ${record.section.name}`.toLowerCase().includes(value)).sort((a, b) => (value ? rank(a) - rank(b) : 0)).slice(0, 30);
  state.searchMatches = matches; state.searchIndex = 0;
  byId("searchCount").textContent = value ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : plural(records.length, "record");
  byId("searchResults").innerHTML = matches.length ? matches.map((record, index) => {
    const image = primaryImage(record);
    return `<a class="search-result${index === 0 ? " active" : ""}" href="${recordHref(record)}" data-link data-index="${index}"><span class="search-thumb">${image ? `<img src="${escapeAttr(image.imageUrl)}" alt="" loading="lazy" />` : glyph(record.id)}</span><span><small>${escapeHtml(record.section.name)}${record.code ? ` · ${escapeHtml(record.code)}` : ""}</small><strong>${highlight(record.title, value)}</strong><p>${highlight(snippet(record, value), value)}</p></span><b aria-hidden="true">→</b></a>`;
  }).join("") : `<div class="search-empty">No records match “${escapeHtml(query)}”.</div>`;
  bindImageFallbacks(byId("searchResults"));
}
function moveSearch(step) {
  const items = byId("searchResults").querySelectorAll(".search-result");
  if (!items.length) return;
  state.searchIndex = (state.searchIndex + step + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle("active", index === state.searchIndex));
  items[state.searchIndex].scrollIntoView({ block: "nearest" });
}

/* ───────── Interaction ───────── */
function closeMenus() {
  byId("mainNav").classList.remove("open"); byId("menuToggle").setAttribute("aria-expanded", "false");
  byId("sectionsPopover").classList.remove("open"); byId("sectionsButton").setAttribute("aria-expanded", "false");
}
function bindImageFallbacks(root) {
  root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
    const thumb = image.closest(".record-image, .search-thumb, .spotlight-art");
    if (thumb) { thumb.classList.add("is-glyph"); thumb.innerHTML = glyph(thumb.closest("[data-seed]")?.dataset.seed || image.alt || "record"); return; }
    (image.closest("figure, .hero-media") || image).remove();
  }, { once: true }));
}
function toast(message) {
  const node = byId("toast");
  node.textContent = message; node.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 4200);
}
function openLightbox(src, caption) { byId("lightboxImage").src = src; byId("lightboxImage").alt = caption; byId("lightboxCaption").textContent = caption; byId("lightboxCaption").hidden = !caption; byId("lightbox").hidden = false; }
function closeLightbox() { byId("lightbox").hidden = true; byId("lightboxImage").removeAttribute("src"); }

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-link]");
  if (anchor) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(anchor.getAttribute("href")); return;
  }
  const scroller = event.target.closest("a[data-scroll]");
  if (scroller) { event.preventDefault(); byId(scroller.getAttribute("href").slice(1))?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" }); return; }
  if (event.target.closest("[data-open-search]")) { openSearch(); return; }
  const zoom = event.target.closest("[data-zoom]");
  if (zoom) { openLightbox(zoom.dataset.zoom, zoom.dataset.caption || ""); return; }
  if (event.target.closest("#lightbox")) { closeLightbox(); return; }
  if (event.target === byId("searchPanel")) { closeSearch(); return; }
  if (!event.target.closest(".sections-menu")) { byId("sectionsPopover").classList.remove("open"); byId("sectionsButton").setAttribute("aria-expanded", "false"); }
});

let revealObserver = null;
function observeReveals(root) {
  const items = root.querySelectorAll("[data-reveal]");
  if (!("IntersectionObserver" in window) || reducedMotion.matches) { items.forEach((item) => item.classList.add("in")); return; }
  document.documentElement.classList.add("reveal-ready");
  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("in"); revealObserver.unobserve(entry.target); } }), { rootMargin: "0px 0px -6% 0px" });
  items.forEach((item) => revealObserver.observe(item));
  clearTimeout(observeReveals.timer);
  observeReveals.timer = setTimeout(() => items.forEach((item) => item.classList.add("in")), 1500); // never leave content hidden
}

let headingObserver = null;
function spyHeadings() {
  headingObserver?.disconnect();
  const links = [...app.querySelectorAll(".article-aside a[data-scroll]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const activate = (id) => links.forEach((item) => item.classList.toggle("active", item.getAttribute("href") === `#${id}`));
  links[0].classList.add("active");
  headingObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) activate(entry.target.id); }), { rootMargin: "-15% 0px -70% 0px" });
  app.querySelectorAll(".prose h2[id], .prose h3[id]").forEach((heading) => headingObserver.observe(heading));
}

function bindMotion(root) {
  if (reducedMotion.matches || !matchMedia("(hover: hover)").matches) return;
  root.querySelectorAll(".holo").forEach((tile) => {
    tile.addEventListener("pointermove", (event) => {
      const box = tile.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width; const y = (event.clientY - box.top) / box.height;
      tile.style.setProperty("--card-x", `${x * 100}%`); tile.style.setProperty("--card-y", `${y * 100}%`);
      tile.style.setProperty("--tilt-x", `${(x - .5) * 5}deg`); tile.style.setProperty("--tilt-y", `${(.5 - y) * 5}deg`);
    });
    tile.addEventListener("pointerleave", () => { tile.style.setProperty("--tilt-x", "0deg"); tile.style.setProperty("--tilt-y", "0deg"); });
  });
}

function createAtmosphere() {
  if (reducedMotion.matches) return;
  let frame = 0;
  window.addEventListener("pointermove", (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      const root = document.documentElement.style;
      root.setProperty("--pointer-x", `${event.clientX}px`); root.setProperty("--pointer-y", `${event.clientY}px`);
      const sigil = byId("heroSigil");
      if (sigil) { sigil.style.setProperty("--sx", `${(event.clientX / innerWidth - .5) * 16}deg`); sigil.style.setProperty("--sy", `${(.5 - event.clientY / innerHeight) * 12}deg`); }
      frame = 0;
    });
  }, { passive: true });

  const canvas = byId("motes"); const context = canvas?.getContext("2d");
  if (!context) return;
  const colors = ["155,89,182", "111,63,160", "201,162,77", "232,225,213", "91,42,130"];
  let width = 0, height = 0, motes = [], running = true;
  const spawn = (anywhere) => ({ x: Math.random() * width, y: anywhere ? Math.random() * height : height + 10, size: .7 + Math.random() * 1.9, speed: .1 + Math.random() * .4, sway: Math.random() * Math.PI * 2, swaySpeed: .003 + Math.random() * .01, alpha: .18 + Math.random() * .42, color: colors[Math.floor(Math.random() * colors.length)] });
  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth; height = innerHeight;
    canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio, 0, 0, ratio, 0, 0);
    motes = Array.from({ length: Math.round(Math.min(64, Math.max(22, width / 24))) }, () => spawn(true));
  };
  const draw = () => {
    if (!running) return;
    context.clearRect(0, 0, width, height);
    for (const mote of motes) {
      mote.y -= mote.speed; mote.sway += mote.swaySpeed; mote.x += Math.sin(mote.sway) * .3;
      if (mote.y < -12) Object.assign(mote, spawn(false));
      const fade = Math.min(1, mote.y / (height * .3)) * mote.alpha * (.7 + Math.sin(mote.sway * 3) * .3);
      const halo = context.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, mote.size * 4);
      halo.addColorStop(0, `rgba(${mote.color},${(fade * .35).toFixed(3)})`); halo.addColorStop(1, `rgba(${mote.color},0)`);
      context.fillStyle = halo;
      context.beginPath(); context.arc(mote.x, mote.y, mote.size * 4, 0, Math.PI * 2); context.fill();
      context.fillStyle = `rgba(${mote.color},${fade.toFixed(3)})`;
      context.beginPath(); context.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2); context.fill();
    }
    requestAnimationFrame(draw);
  };
  resize(); draw();
  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", () => { const wasRunning = running; running = !document.hidden; if (running && !wasRunning) draw(); });
}

document.addEventListener("pointerdown", (event) => {
  if (reducedMotion.matches || event.button !== 0) return;
  const target = event.target.closest(".btn, .search-trigger, .holo, a.record-row, .attachment-links a, .next-record a");
  if (!target) return;
  target.classList.add("ripple-host");
  const box = target.getBoundingClientRect();
  const ripple = document.createElement("span");
  ripple.className = "click-ripple";
  ripple.style.left = `${event.clientX - box.left}px`; ripple.style.top = `${event.clientY - box.top}px`;
  target.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

function updateProgress() {
  const max = document.documentElement.scrollHeight - innerHeight;
  byId("readingProgress").style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  byId("siteHeader").classList.toggle("scrolled", scrollY > 12);
}
window.addEventListener("scroll", updateProgress, { passive: true });

/* ───────── Markdown ─────────
 * A small renderer for the flavour of Markdown Trello produces. It understands
 * headings, paragraphs (single newlines become line breaks, as on Trello), bullet and
 * numbered lists, multi-line blockquotes (a bare ">" is a paragraph break inside the
 * quote), horizontal rules, inline images and links, bold, italic and code.
 * A line that is nothing but a code span is treated as a worked example. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/;
function markdown(source = "", context = {}) {
  const lines = cleanText(source).split("\n");
  const out = [];
  let list = null, paragraph = [], quote = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    if (paragraph.length === 1 && /^`[^`]+`$/.test(paragraph[0])) out.push(`<p class="example">${inline(paragraph[0].slice(1, -1))}</p>`);
    else out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushQuote = () => { if (quote) { out.push(`<blockquote>${markdown(quote.join("\n"), context)}</blockquote>`); quote = null; } };
  const flushAll = () => { flushParagraph(); closeList(); flushQuote(); };
  for (const raw of lines) {
    const line = raw.trim();
    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) { flushParagraph(); closeList(); (quote ||= []).push(quoted[1]); continue; }
    if (quote) flushQuote();
    if (!line) { flushParagraph(); closeList(); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) { flushAll(); out.push("<hr>"); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) { flushAll(); const level = Math.min(3, Math.max(2, heading[1].length)); const text = stripMarkdown(heading[2]); out.push(`<h${level} id="${slug(text)}">${inline(heading[2])}</h${level}>`); continue; }
    const image = line.match(IMAGE_LINE);
    if (image) { flushAll(); const html = figureFor(image[2], image[1], context); if (html) out.push(html); continue; }
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) { flushParagraph(); flushQuote(); if (list !== "ul") { closeList(); list = "ul"; out.push("<ul>"); } out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    const number = line.match(/^\d+[.)]\s+(.+)$/);
    if (number) { flushParagraph(); flushQuote(); if (list !== "ol") { closeList(); list = "ol"; out.push("<ol>"); } out.push(`<li>${inline(number[1])}</li>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushAll();
  return out.join("");
}
/* Trello attachment URLs need a login, so an inline image is only rendered when it maps
 * to an attachment the Worker can proxy. The cover image is already shown above the text. */
function figureFor(url, alt, context) {
  const attachment = (context.record?.attachments || []).find((item) => item.isImage && (url.includes(item.id) || url === item.url));
  if (!attachment) return "";
  if (context.hero && attachment.id === context.hero.id) return "";
  context.shown?.add(attachment.id);
  // No visible caption for inline images either — even a deliberately-typed alt
  // is often really just the filename an author never meant to publish (e.g.
  // "diagram", "IMG_2384"). It's still used as the accessible alt attribute.
  const isMeaningful = alt && !/^(image|img|screenshot)?[\s_-]*\d*(\.\w+)?$/i.test(alt);
  const altText = isMeaningful ? alt : captionOf(context.record || {});
  return `<figure><button data-zoom="${escapeAttr(attachment.imageUrl)}" aria-label="Enlarge image"><img src="${escapeAttr(attachment.imageUrl)}" alt="${escapeAttr(altText)}" loading="lazy" /></button></figure>`;
}
function inline(value = "") {
  const tokens = [];
  const keep = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let text = value;
  text = text.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt) => alt || "");
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => keep(anchor(url, label)));
  text = text.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>)]+)/g, (_, lead, url) => `${lead}${keep(anchor(url, url))}`);
  text = escapeHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/__(.+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>").replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}
function anchor(url, label) {
  const href = safeUrl(url);
  if (href === "#") return escapeHtml(label);
  const bare = label.trim() === url.trim();
  let text = label;
  if (bare) { try { const parsed = new URL(url); text = parsed.hostname.replace(/^www\./, "") + (parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "").split("/").slice(0, 3).join("/") + (parsed.pathname.split("/").length > 4 ? "/…" : "") : ""); } catch { text = url; } }
  return `<a href="${href}" target="_blank" rel="noopener"${bare ? ' class="bare-link"' : ""}>${escapeHtml(text)}${bare ? " ↗" : ""}</a>`;
}
function extractHeadings(source = "") {
  return cleanText(source).split("\n").map((line) => line.trim().match(/^(#{1,6})\s+(.+?)\s*#*$/)).filter(Boolean).map((match) => {
    const text = stripMarkdown(match[2]);
    return { level: Math.min(3, Math.max(2, match[1].length)), text, id: slug(text) };
  });
}
function excerpt(record) {
  const text = stripMarkdown(record.description.replace(/^\s*#{1,6}\s.*$/gm, ""));
  if (text) return text.length > 180 ? `${text.slice(0, 177).replace(/\s+\S*$/, "")}…` : text;
  const images = imageAttachments(record).length;
  return images ? `Illustrated record · ${plural(images, "image")}` : "Open this record.";
}
function stripMarkdown(value = "") {
  return cleanText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "") // drop inline images outright — their alt text is a caption, not prose
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*([^*]+?)\*/g, "$1$2")
    .replace(/(^|[^\w_])_([^_]+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[char])); }
function escapeAttr(value = "") { return escapeHtml(value); }
function safeUrl(value = "") { try { const url = new URL(value); return ["http:","https:"].includes(url.protocol) ? escapeAttr(url.href) : "#"; } catch { return "#"; } }

/* ───────── Boot ───────── */
byId("menuToggle").addEventListener("click", () => { const open = byId("mainNav").classList.toggle("open"); byId("menuToggle").setAttribute("aria-expanded", String(open)); });
byId("sectionsButton").addEventListener("click", () => { const open = byId("sectionsPopover").classList.toggle("open"); byId("sectionsButton").setAttribute("aria-expanded", String(open)); });
byId("searchTrigger").addEventListener("click", () => openSearch());
byId("randomButton").addEventListener("click", jumpToRandomRecord);
byId("closeSearch").addEventListener("click", closeSearch);
byId("globalSearch").addEventListener("input", (event) => renderSearch(event.target.value));
byId("globalSearch").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") { event.preventDefault(); moveSearch(1); }
  if (event.key === "ArrowUp") { event.preventDefault(); moveSearch(-1); }
  if (event.key === "Enter") { const record = state.searchMatches[state.searchIndex]; if (record) { event.preventDefault(); navigate(recordHref(record)); } }
});
document.addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
  if ((event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) || (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey))) { event.preventDefault(); openSearch(); }
  if (event.key === "Escape") { closeLightbox(); closeSearch(); closeMenus(); }
});
window.addEventListener(PREVIEW ? "hashchange" : "popstate", () => route());
createAtmosphere();
initDroid();
start();
