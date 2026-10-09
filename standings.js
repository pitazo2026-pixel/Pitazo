import { LEAGUES, json, apiFootball, seasonFor } from "../_shared.js";

// GET /api/standings?league=128
export async function onRequestGet({ request, env, ctx }) {
  const id = Number(new URL(request.url).searchParams.get("league"));
  if (!LEAGUES[id]) return json({ error: "Torneo no disponible." }, 400);

  const season = seasonFor(id, new Date(), env.SEASON);
  const r = await apiFootball(env, ctx, "/standings?league=" + id + "&season=" + season, 600);
  if (r.error) return json({ error: r.error }, r.status);

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
