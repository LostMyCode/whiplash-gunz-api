import type { PlayerRankingRow } from './collect';

function formatNumber(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('en-US');
}

export function formatRankingMessage(
  players: PlayerRankingRow[],
  backupKey: string,
  generatedAt = new Date(),
): string {
  const lines = [
    '**Whiplash GunZ Player Rankings**',
    `Source: ${backupKey}`,
    `Generated: ${generatedAt.toISOString()}`,
    '',
  ];

  if (players.length === 0) {
    lines.push('No ranked players found.');
    return lines.join('\n');
  }

  players.forEach((player, index) => {
    const kills = Number(player.KillCount ?? 0);
    const deaths = Number(player.DeathCount ?? 0);
    const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills > 0 ? 'Perfect' : '0.00';

    lines.push(
      `${index + 1}. ${player.Name} - Lv ${formatNumber(player.Level)} | XP ${formatNumber(player.XP)} | K/D ${formatNumber(kills)}/${formatNumber(deaths)} (${kd}) | Games ${formatNumber(player.GameCount)}`,
    );
  });

  return lines.join('\n').slice(0, 1900);
}
