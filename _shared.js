// Torneos que muestra Pitazo (IDs de API-Football).
// Para agregar o quitar torneos, editá esta lista y la del archivo index.html.
export const LEAGUES = {
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

export function seasonFor(leagueId, now = new Date(), override) {
  if (override) return Number(override);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return EUROPEAN.has(Number(leagueId)) && m < 7 ? y - 1 : y;
}

export function json(data, status = 200, maxAge = 0) {
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
export async function apiFootball(env, ctx, path, ttl) {
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
    return { error: "API-Football rechazó la consulta: " + JSON.stringify(data.errors), status: 502 };
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
