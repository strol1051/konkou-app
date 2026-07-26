import db from '../db.js';

export function getLeaderboard(userId, period) {
  const p = period === 'week' ? 'week' : period === 'all' ? 'all' : 'today';
  let dateFilter = "date(gs.played_at) = date('now')";
  if (p === 'week') dateFilter = "date(gs.played_at) >= date('now', '-7 days')";
  if (p === 'all') dateFilter = '1=1';

  const rows = db.prepare(`
    SELECT u.id, u.name, SUM(gs.points_earned) as total_points
    FROM game_sessions gs
    JOIN users u ON u.id = gs.user_id
    WHERE ${dateFilter}
    GROUP BY u.id
    ORDER BY total_points DESC
    LIMIT 20
  `).all();

  const myRank = rows.findIndex(r => r.id === userId) + 1;

  return {
    status: 200,
    data: {
      period: p,
      leaderboard: rows.map((r, i) => ({ rank: i + 1, name: r.name, points: r.total_points, isMe: r.id === userId })),
      myRank: myRank || null
    }
  };
}
