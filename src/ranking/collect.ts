import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
// @ts-ignore
import sqlJsWasmAssetPath from 'sql.js/dist/sql-wasm.wasm';

export type PlayerRankingRow = {
  Name: string;
  Level: number;
  XP: number;
  KillCount: number;
  DeathCount: number;
  GameCount: number;
  PlayTime: number;
};

let sqlJsPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) => path.join(__dirname, path.basename(sqlJsWasmAssetPath ?? file)),
    });
  }

  return sqlJsPromise;
}

export async function collectTopPlayers(dbPath: string, limit: number): Promise<PlayerRankingRow[]> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  try {
    const result = db.exec(
      `
      SELECT
          Name,
          Level,
          XP,
          KillCount,
          DeathCount,
          GameCount,
          PlayTime
      FROM "Character"
      WHERE COALESCE(DeleteFlag, 0) = 0
        AND Name IS NOT NULL
        AND Name != ''
      ORDER BY Level DESC, XP DESC, KillCount DESC
      LIMIT ?
      `,
      [limit],
    );

    if (result.length === 0) return [];

    const rows = result[0];
    return rows.values.map((values: unknown[]) => ({
      Name: String(values[0] ?? ''),
      Level: Number(values[1] ?? 0),
      XP: Number(values[2] ?? 0),
      KillCount: Number(values[3] ?? 0),
      DeathCount: Number(values[4] ?? 0),
      GameCount: Number(values[5] ?? 0),
      PlayTime: Number(values[6] ?? 0),
    }));
  } finally {
    db.close();
  }
}
