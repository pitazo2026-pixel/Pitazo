// Pitazo: sitio completo en un solo archivo para Cloudflare Workers.
// Sirve la página en "/" y los datos en /api/fixtures, /api/standings y /api/config.

// Torneos que muestra Pitazo (IDs de API-Football).
// Para agregar o quitar torneos, editá esta lista y la del archivo index.html.
const LEAGUES = {
  128: "Liga Profesional",
  130: "Copa Argentina",
  13: "Copa Libertadores",
  11: "Copa Sudamericana",
  2: "Champions League",
  39: "Premier League",
  140: "LaLiga"
};

// Torneos europeos: la temporada se nombra por el año en que empieza (julio en adelante).
const EUROPEAN = new Set([2, 39, 140]);

function seasonFor(leagueId, now = new Date(), override) {
  if (override) return Number(override);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return EUROPEAN.has(Number(leagueId)) && m < 7 ? y - 1 : y;
}

function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge ? "public, max-age=" + maxAge : "no-store"
    }
  });
}

// Pide datos a API-Football. La clave sale de la variable secreta API_FOOTBALL_KEY
// y nunca llega al navegador. El resultado se guarda en caché para ahorrar consultas.
async function apiFootball(env, ctx, path, ttl) {
  if (!env.API_FOOTBALL_KEY) {
    return { error: "Falta configurar API_FOOTBALL_KEY en el servidor.", status: 500 };
  }
  const url = "https://v3.football.api-sports.io" + path;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(url);

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return { data: await hit.json() };
  }

  let res;
  try {
    res = await fetch(url, { headers: { "x-apisports-key": env.API_FOOTBALL_KEY } });
  } catch (e) {
    return { error: "No se pudo conectar con API-Football.", status: 502 };
  }
  if (!res.ok) return { error: "API-Football respondió con error " + res.status + ".", status: 502 };

  const data = await res.json();
  const hasErrors = data.errors && (Array.isArray(data.errors) ? data.errors.length : Object.keys(data.errors).length);
  if (hasErrors) {
    const e = data.errors;
    const code = e.plan ? "plan" : e.rateLimit ? "rate" : "other";
    const status = code === "plan" ? 403 : code === "rate" ? 429 : 502;
    return { error: "API-Football rechazó la consulta: " + JSON.stringify(e), status, code };
  }

  if (cache) {
    const copy = new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=" + ttl }
    });
    const put = cache.put(cacheKey, copy);
    if (ctx && ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return { data };
}


const TZ = "America/Argentina/Buenos_Aires";
const LIVE = new Set(["1H", "2H", "ET", "BT", "P", "LIVE", "INT"]);
const DONE = new Set(["FT", "AET", "PEN"]);

// GET /api/fixtures?date=2026-10-08
async function getFixtures({ request, env, ctx }) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Fecha inválida." }, 400);

  // Hoy se renueva cada minuto (hay partidos en vivo); otros días, cada 10 minutos.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const ttl = date === today ? 60 : 600;

  const r = await apiFootball(env, ctx, "/fixtures?date=" + date + "&timezone=" + TZ, ttl);
  if (r.error) return json({ error: r.error, code: r.code }, r.status);

  const matches = (r.data.response || [])
    .filter((f) => LEAGUES[f.league.id])
    .map((f) => {
      const s = f.fixture.status.short;
      return {
        lg: f.league.id,
        time: f.fixture.date,
        state: DONE.has(s) ? "done" : LIVE.has(s) ? "live" : s === "HT" ? "ht" : ["NS", "TBD"].includes(s) ? "next" : "other",
        code: s,
        min: f.fixture.status.elapsed,
        home: f.teams.home.name,
        away: f.teams.away.name,
        hs: f.goals.home,
        as: f.goals.away
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));

  return json({ date, matches }, 200, ttl);
}


// GET /api/standings?league=128
async function getStandings({ request, env, ctx }) {
  const id = Number(new URL(request.url).searchParams.get("league"));
  if (!LEAGUES[id]) return json({ error: "Torneo no disponible." }, 400);

  const season = seasonFor(id, new Date(), env.SEASON);
  const r = await apiFootball(env, ctx, "/standings?league=" + id + "&season=" + season, 600);
  if (r.error) return json({ error: r.error, code: r.code }, r.status);

  const league = r.data.response && r.data.response[0] && r.data.response[0].league;
  const groups = ((league && league.standings) || []).map((g) =>
    g.map((t) => ({
      rank: t.rank,
      team: t.team.name,
      played: t.all.played,
      gd: t.goalsDiff,
      pts: t.points,
      group: t.group || ""
    }))
  );

  return json({ league: id, name: LEAGUES[id], season, groups }, 200, 600);
}

const PAGE = "<!doctype html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<meta name=\"description\" content=\"Resultados de fútbol en vivo, fixture y tabla de posiciones de la Liga Profesional, Copa Libertadores, Champions League y más.\">\n<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n<title>Pitazo - Resultados de fútbol en vivo</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&display=swap\">\n<style>\n/* Layout: sticky scoreboard header, day tabs, league chips; matches column left, standings + ad right; stacks on phones */\n:root {\n  --bg: #f4f3fb;\n  --surface: #ffffff;\n  --fg: #17163a;\n  --muted: #625f86;\n  --line: #dcdaf0;\n  --pitch: #4630e0;\n  --pitch-soft: #e9e6fb;\n  --on-pitch: #ffffff;\n  --brand: #4630e0;\n  --mark: #ffc61a;\n  --live: #e5174f;\n  --ad-bg: #ecebf6;\n  --font-display: \"Barlow Condensed\", \"Arial Narrow\", Impact, sans-serif;\n  --font-body: \"Barlow\", system-ui, -apple-system, \"Segoe UI\", sans-serif;\n}\n@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {\n    --bg: #0e0d24; --surface: #17163a; --fg: #ecebff; --muted: #9a98c4;\n    --line: #2a2858; --pitch: #a79dff; --pitch-soft: #211f4d; --on-pitch: #0e0d24; --brand: #5a45f0; --mark: #ffc61a; --live: #ff5c85; --ad-bg: #1a1941;\n    color-scheme: dark;\n  }\n}\n:root[data-theme=\"dark\"] {\n  --bg: #0e0d24; --surface: #17163a; --fg: #ecebff; --muted: #9a98c4;\n  --line: #2a2858; --pitch: #a79dff; --pitch-soft: #211f4d; --on-pitch: #0e0d24; --brand: #5a45f0; --mark: #ffc61a; --live: #ff5c85; --ad-bg: #1a1941;\n  color-scheme: dark;\n}\n* { box-sizing: border-box; }\nbody { background: var(--bg); color: var(--fg); font-family: var(--font-body); font-size: 15px; line-height: 1.4; padding-inline: 16px; padding-block: 0 32px; }\n.wrap { max-width: 1100px; margin-inline: auto; }\nheader.top { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 2px solid var(--fg); padding-block: 10px; margin-inline: -16px; padding-inline: 16px; }\n.top .wrap { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }\n.logo { font-family: var(--font-display); font-weight: 800; font-size: 34px; letter-spacing: .01em; text-transform: uppercase; line-height: 1; }\n.logo span { color: var(--pitch); }\n.brand { display: flex; align-items: center; gap: 10px; }\n.brand svg { width: 42px; height: 42px; flex: 0 0 auto; }\n.tag { font-size: 13px; color: var(--muted); }\n.notice { margin-block: 12px; padding: 8px 12px; border: 1px dashed var(--line); background: var(--surface); font-size: 13px; color: var(--muted); }\n.ad { background: var(--ad-bg); border: 1px dashed var(--line); color: var(--muted); display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }\n.ad.leader { min-height: 90px; margin-block: 12px; }\n.ad.rect { min-height: 250px; }\n.ad.inline { min-height: 90px; margin-block: 10px; }\n.days { display: flex; gap: 6px; overflow-x: auto; padding-block: 4px; }\n.day { flex: 0 0 auto; min-width: 74px; padding: 8px 12px; border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: inherit; text-align: center; cursor: pointer; border-radius: 4px; }\n.day b { display: block; font-family: var(--font-display); font-size: 20px; line-height: 1.1; }\n.day small { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }\n.day[aria-pressed=\"true\"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }\n.day[aria-pressed=\"true\"] small { color: var(--bg); opacity: .75; }\n.chips { display: flex; gap: 6px; overflow-x: auto; padding-block: 10px 4px; }\n.chip { flex: 0 0 auto; padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--fg); font: inherit; font-size: 13px; cursor: pointer; }\n.chip[aria-pressed=\"true\"] { background: var(--pitch); border-color: var(--pitch); color: var(--on-pitch); }\nbutton:focus-visible { outline: 2px solid var(--pitch); outline-offset: 2px; }\n.grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; margin-top: 12px; }\n@media (max-width: 820px) { .grid { grid-template-columns: minmax(0, 1fr); } }\n.league { background: var(--surface); border: 1px solid var(--line); margin-bottom: 14px; }\n.league h2 { margin: 0; padding: 8px 12px; font-family: var(--font-display); font-size: 18px; letter-spacing: .06em; text-transform: uppercase; background: var(--pitch-soft); border-bottom: 1px solid var(--line); }\n.match { display: grid; grid-template-columns: 62px minmax(0, 1fr) 34px; align-items: center; column-gap: 8px; padding: 9px 12px; border-top: 1px solid var(--line); }\n.match:first-of-type { border-top: 0; }\n.st { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }\n.st.live { color: var(--live); display: flex; align-items: center; gap: 5px; }\n.st.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--live); animation: pulse 1.4s infinite; }\n@keyframes pulse { 50% { opacity: .25; } }\n@media (prefers-reduced-motion: reduce) { .st.live i { animation: none; } }\n.teams, .scores { display: flex; flex-direction: column; gap: 3px; min-width: 0; }\n.teams span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }\n.scores { text-align: right; font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }\n.scores .w, .teams .w { font-weight: 700; }\n.empty { padding: 24px 12px; text-align: center; color: var(--muted); background: var(--surface); border: 1px solid var(--line); }\n.side h2 { margin: 0 0 8px; font-family: var(--font-display); font-size: 22px; text-transform: uppercase; letter-spacing: .05em; }\n.tablewrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); }\ntable { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }\nth, td { padding: 6px 7px; text-align: right; white-space: nowrap; }\nth { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); }\nth:nth-child(2), td:nth-child(2) { text-align: left; width: 100%; }\ntd:first-child, th:first-child { text-align: center; color: var(--muted); }\ntbody tr { border-top: 1px solid var(--line); }\ntbody tr:nth-child(-n+4) td:first-child { color: var(--pitch); font-weight: 700; }\ntd.pts { font-weight: 700; }\n.side .ad { margin-top: 16px; }\nfooter { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }\n</style>\n</head>\n<body>\n\n<header class=\"top\">\n  <div class=\"wrap\">\n    <div class=\"brand\">\n      <svg viewBox=\"0 0 48 48\" role=\"img\" aria-label=\"Logo de Pitazo\">\n        <rect width=\"48\" height=\"48\" rx=\"11\" fill=\"var(--brand)\"/>\n        <rect x=\"7\" y=\"19\" width=\"17\" height=\"8\" rx=\"4\" fill=\"var(--mark)\"/>\n        <circle cx=\"29\" cy=\"28\" r=\"11\" fill=\"var(--mark)\"/>\n        <circle cx=\"29\" cy=\"28\" r=\"4\" fill=\"var(--brand)\"/>\n        <circle cx=\"29\" cy=\"14\" r=\"3\" fill=\"none\" stroke=\"var(--mark)\" stroke-width=\"2.5\"/>\n        <path d=\"M36 12l3-3M40 17l4-1M38 8l1-4\" stroke=\"var(--mark)\" stroke-width=\"2.2\" stroke-linecap=\"round\" fill=\"none\"/>\n      </svg>\n      <div class=\"logo\">Pita<span>zo</span></div>\n    </div>\n    <div class=\"tag\">Resultados de fútbol en vivo</div>\n  </div>\n</header>\n\n<main class=\"wrap\">\n  <div class=\"notice\" id=\"status\" role=\"status\" hidden></div>\n\n  <div class=\"ad leader\">Espacio publicitario 728×90</div>\n\n  <div class=\"days\" id=\"days\" role=\"group\" aria-label=\"Elegir día\"></div>\n  <div class=\"chips\" id=\"chips\" role=\"group\" aria-label=\"Filtrar por torneo\"></div>\n\n  <div class=\"grid\">\n    <section id=\"matches\" aria-label=\"Partidos\"></section>\n\n    <aside class=\"side\">\n      <div id=\"standingsBox\">\n      <h2 id=\"tableTitle\">Posiciones</h2>\n      <div class=\"tablewrap\">\n        <table>\n          <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>DG</th><th>Pts</th></tr></thead>\n          <tbody id=\"table\"></tbody>\n        </table>\n      </div>\n      </div>\n      <div class=\"ad rect\">Espacio publicitario 300×250</div>\n    </aside>\n  </div>\n\n  <footer>Pitazo · Zona horaria de Buenos Aires · Datos de API-Football.</footer>\n</main>\n\n<script>\n/* Mismos torneos que functions/_shared.js */\nvar LEAGUES = {\n  128: \"Liga Profesional\",\n  130: \"Copa Argentina\",\n  13: \"Copa Libertadores\",\n  11: \"Copa Sudamericana\",\n  2: \"Champions League\",\n  39: \"Premier League\",\n  140: \"LaLiga\"\n};\nvar ORDER = [\"128\", \"130\", \"13\", \"11\", \"2\", \"39\", \"140\"];\nvar TZ = \"America/Argentina/Buenos_Aires\";\nvar DAYNAMES = [\"dom\", \"lun\", \"mar\", \"mié\", \"jue\", \"vie\", \"sáb\"];\nvar cfg = { days: [0, 1], standings: false };\nvar state = { day: 0, lg: \"all\", matches: [], loading: true, error: \"\" };\nvar reqId = 0;\nvar refreshTimer = null;\n\nfunction ymd(off) {\n  var d = new Date();\n  d.setDate(d.getDate() + off);\n  return d.toLocaleDateString(\"en-CA\", { timeZone: TZ });\n}\n\nfunction dayLabel(off) {\n  var d = new Date();\n  d.setDate(d.getDate() + off);\n  var n = new Date(d.toLocaleString(\"en-US\", { timeZone: TZ }));\n  return { name: off === 0 ? \"hoy\" : DAYNAMES[n.getDay()], num: n.getDate() };\n}\n\nfunction fmtTime(iso) {\n  return new Date(iso).toLocaleTimeString(\"es-AR\", { timeZone: TZ, hour: \"2-digit\", minute: \"2-digit\", hour12: false });\n}\n\nfunction showStatus(msg) {\n  var el = document.getElementById(\"status\");\n  el.hidden = !msg;\n  el.textContent = msg || \"\";\n}\n\nfunction buildDays() {\n  var box = document.getElementById(\"days\");\n  box.innerHTML = \"\";\n  cfg.days.forEach(function (off) {\n    var l = dayLabel(off);\n    var b = document.createElement(\"button\");\n    b.className = \"day\";\n    b.setAttribute(\"aria-pressed\", String(state.day === off));\n    b.innerHTML = \"<small>\" + l.name + \"</small><b>\" + l.num + \"</b>\";\n    b.onclick = function () { state.day = off; render(); loadMatches(); };\n    box.appendChild(b);\n  });\n}\n\nfunction buildChips() {\n  var box = document.getElementById(\"chips\");\n  box.innerHTML = \"\";\n  [\"all\"].concat(ORDER).forEach(function (k) {\n    var b = document.createElement(\"button\");\n    b.className = \"chip\";\n    b.textContent = k === \"all\" ? \"Todos\" : LEAGUES[k];\n    b.setAttribute(\"aria-pressed\", String(state.lg === k));\n    b.onclick = function () { state.lg = k; render(); loadTable(); };\n    box.appendChild(b);\n  });\n}\n\nfunction matchRow(m) {\n  var row = document.createElement(\"div\");\n  row.className = \"match\";\n  var st = document.createElement(\"div\");\n  var live = m.state === \"live\";\n  st.className = \"st\" + (live ? \" live\" : \"\");\n  if (live) st.innerHTML = \"<i></i>\" + (m.min ? m.min + \"'\" : \"En vivo\");\n  else if (m.state === \"ht\") st.textContent = \"Ent.\";\n  else if (m.state === \"done\") st.textContent = m.code === \"PEN\" ? \"Pen.\" : \"Final\";\n  else if (m.state === \"next\") st.textContent = fmtTime(m.time);\n  else st.textContent = m.code;\n  var played = m.hs !== null && m.hs !== undefined;\n  var hw = played && m.hs > m.as ? \"w\" : \"\";\n  var aw = played && m.as > m.hs ? \"w\" : \"\";\n  var teams = document.createElement(\"div\");\n  teams.className = \"teams\";\n  var s1 = document.createElement(\"span\"); s1.textContent = m.home; s1.className = hw;\n  var s2 = document.createElement(\"span\"); s2.textContent = m.away; s2.className = aw;\n  teams.appendChild(s1); teams.appendChild(s2);\n  var sc = document.createElement(\"div\");\n  sc.className = \"scores\";\n  var c1 = document.createElement(\"span\"); c1.textContent = played ? m.hs : \"-\"; c1.className = hw;\n  var c2 = document.createElement(\"span\"); c2.textContent = played ? m.as : \"-\"; c2.className = aw;\n  sc.appendChild(c1); sc.appendChild(c2);\n  row.appendChild(st); row.appendChild(teams); row.appendChild(sc);\n  return row;\n}\n\nfunction buildMatches() {\n  var box = document.getElementById(\"matches\");\n  box.innerHTML = \"\";\n  function msg(t) {\n    var e = document.createElement(\"div\");\n    e.className = \"empty\";\n    e.textContent = t;\n    box.appendChild(e);\n  }\n  if (state.loading) { msg(\"Cargando partidos…\"); return; }\n  if (state.error === \"plan\") { msg(\"Los partidos de este día todavía no están disponibles.\"); return; }\n  if (state.error === \"rate\") { msg(\"Hay muchas consultas en este momento. Probá de nuevo en un minuto.\"); return; }\n  if (state.error) { msg(\"No se pudieron cargar los partidos. Probá de nuevo en un momento.\"); return; }\n  var list = state.matches.filter(function (m) { return state.lg === \"all\" || String(m.lg) === state.lg; });\n  if (!list.length) { msg(\"No hay partidos de este torneo para el día elegido.\"); return; }\n  var groups = {}, order = [];\n  list.forEach(function (m) {\n    if (!groups[m.lg]) { groups[m.lg] = []; order.push(m.lg); }\n    groups[m.lg].push(m);\n  });\n  order.sort(function (a, b) { return ORDER.indexOf(String(a)) - ORDER.indexOf(String(b)); });\n  order.forEach(function (k, i) {\n    var sec = document.createElement(\"div\");\n    sec.className = \"league\";\n    var h = document.createElement(\"h2\");\n    h.textContent = LEAGUES[k];\n    sec.appendChild(h);\n    groups[k].forEach(function (m) { sec.appendChild(matchRow(m)); });\n    box.appendChild(sec);\n    if (i === 0 && order.length > 1) {\n      var ad = document.createElement(\"div\");\n      ad.className = \"ad inline\";\n      ad.textContent = \"Espacio publicitario en el listado\";\n      box.appendChild(ad);\n    }\n  });\n}\n\nfunction render() {\n  buildDays();\n  buildChips();\n  buildMatches();\n}\n\nfunction loadMatches(silent) {\n  var id = ++reqId;\n  if (!silent) {\n    state.loading = true;\n    state.error = \"\";\n    buildMatches();\n  }\n  fetch(\"/api/fixtures?date=\" + ymd(state.day))\n    .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var er = new Error(j.error || \"error\"); er.code = j.code; throw er; } return j; }); })\n    .then(function (j) {\n      if (id !== reqId) return;\n      state.matches = j.matches || [];\n      state.loading = false;\n      showStatus(\"\");\n      buildMatches();\n    })\n    .catch(function (e) {\n      if (id !== reqId) return;\n      state.loading = false;\n      state.error = e.code === \"plan\" || e.code === \"rate\" ? e.code : \"other\";\n      showStatus(state.error === \"other\" ? \"Hubo un problema al consultar los datos. Si sos el dueño del sitio, revisá la clave de API-Football.\" : \"\");\n      buildMatches();\n    });\n}\n\nfunction loadTable() {\n  document.getElementById(\"standingsBox\").hidden = !cfg.standings;\n  if (!cfg.standings) return;\n  var lg = state.lg === \"all\" ? \"128\" : state.lg;\n  var tb = document.getElementById(\"table\");\n  var title = document.getElementById(\"tableTitle\");\n  title.textContent = \"Posiciones · \" + LEAGUES[lg];\n  tb.innerHTML = \"<tr><td colspan=\\\"5\\\" style=\\\"text-align:center;color:var(--muted)\\\">Cargando…</td></tr>\";\n  fetch(\"/api/standings?league=\" + lg)\n    .then(function (r) { return r.json().then(function (j) { if (!r.ok) { var er = new Error(j.error || \"error\"); er.code = j.code; throw er; } return j; }); })\n    .then(function (j) {\n      if (lg !== (state.lg === \"all\" ? \"128\" : state.lg)) return;\n      var g = j.groups && j.groups[0];\n      tb.innerHTML = \"\";\n      if (!g || !g.length) {\n        tb.innerHTML = \"<tr><td colspan=\\\"5\\\" style=\\\"text-align:center;color:var(--muted)\\\">Este torneo no tiene tabla.</td></tr>\";\n        return;\n      }\n      if (g[0].group) title.textContent = \"Posiciones · \" + g[0].group;\n      g.forEach(function (r) {\n        var tr = document.createElement(\"tr\");\n        tr.innerHTML = \"<td></td><td></td><td></td><td></td><td class=\\\"pts\\\"></td>\";\n        tr.children[0].textContent = r.rank;\n        tr.children[1].textContent = r.team;\n        tr.children[2].textContent = r.played;\n        tr.children[3].textContent = (r.gd > 0 ? \"+\" : \"\") + r.gd;\n        tr.children[4].textContent = r.pts;\n        tb.appendChild(tr);\n      });\n    })\n    .catch(function () {\n      tb.innerHTML = \"<tr><td colspan=\\\"5\\\" style=\\\"text-align:center;color:var(--muted)\\\">No se pudo cargar la tabla.</td></tr>\";\n    });\n}\n\nfetch(\"/api/config\")\n  .then(function (r) { return r.json(); })\n  .then(function (c) { if (c && c.days) cfg = c; })\n  .catch(function () {})\n  .then(function () { render(); loadMatches(); loadTable(); });\n/* Renueva los resultados cada minuto mientras la pestaña está abierta. */\nsetInterval(function () { if (!document.hidden && state.day === 0) loadMatches(true); }, 60000);\n</script>\n\n</body>\n</html>\n";

// Con el plan gratuito de API-Football solo se muestran hoy y mañana, sin tabla.
// Al pasar a un plan pago, agregá la variable PLAN = pro en Cloudflare para activar todo.
function getConfig(env) {
  const pro = env.PLAN === "pro";
  return json({ days: pro ? [-1, 0, 1, 2] : [0, 1], standings: pro }, 200, 60);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/api/config") return getConfig(env);
    if (request.method === "GET" && pathname === "/api/fixtures") return getFixtures({ request, env, ctx });
    if (request.method === "GET" && pathname === "/api/standings") return getStandings({ request, env, ctx });
    if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    return new Response("No encontrado", { status: 404 });
  }
};
