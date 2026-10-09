import { LEAGUES, json, apiFootball } from "../_shared.js";

const TZ = "America/Argentina/Buenos_Aires";
const LIVE = new Set(["1H", "2H", "ET", "BT", "P", "LIVE", "INT"]);
const DONE = new Set(["FT", "AET", "PEN"]);

// GET /api/fixtures?date=2026-10-08
export async function onRequestGet({ request, env, ctx }) {
  const date = new URL(request.url).searchParams.get("date") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Fecha inválida." }, 400);

  // Hoy se renueva cada minuto (hay partidos en vivo); otros días, cada 10 minutos.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const ttl = date === today ? 60 : 600;

  const r = await apiFootball(env, ctx, "/fixtures?date=" + date + "&timezone=" + TZ, ttl);
  if (r.error) return json({ error: r.error }, r.status);

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
