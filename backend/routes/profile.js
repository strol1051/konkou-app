import db from '../db.js';

export function getProfile(userId) {
  const user = db.prepare('SELECT id, phone, name, points, referral_code, bonus_plays, created_at FROM users WHERE id = ?').get(userId);
  if (!user) return { status: 404, data: { error: 'Utilisateur introuvable' } };

  const referralsCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE referred_by = ?').get(user.referral_code).c;
  const gamesPlayed = db.prepare('SELECT COUNT(*) as c FROM game_sessions WHERE user_id = ?').get(user.id).c;

  return {
    status: 200,
    data: {
      id: user.id,
      phone: user.phone,
      name: user.name,
      points: user.points,
      referralCode: user.referral_code,
      referralsCount,
      gamesPlayed,
      bonusPlays: user.bonus_plays,
      memberSince: user.created_at
    }
  };
}
