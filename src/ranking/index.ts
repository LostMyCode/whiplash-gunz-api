import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { postChannelMessage } from './channel';
import { collectTopPlayers } from './collect';
import { decompressZstdStreamToFile } from './decompress';
import { formatRankingMessage } from './format';

type S3EventRecord = {
  eventSource?: string;
  s3?: {
    bucket?: { name?: string };
    object?: { key?: string };
  };
};

type S3Event = {
  Records?: S3EventRecord[];
};

type BackupRecord = {
  bucket: string;
  key: string;
};

const s3 = new S3Client({});

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? '';
const DISCORD_RANKING_CHANNEL_ID = process.env.DISCORD_RANKING_CHANNEL_ID ?? '';
const RANKING_BACKUP_PREFIX = process.env.RANKING_BACKUP_PREFIX ?? 'gunzdb/';
const RANKING_TOP_N = parsePositiveInt(process.env.RANKING_TOP_N, 10);

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function decodeS3Key(rawKey: string): string {
  return decodeURIComponent(rawKey.replace(/\+/g, ' '));
}

function getBackupRecords(event: S3Event): BackupRecord[] {
  return (event.Records ?? [])
    .filter((record) => record.eventSource === 'aws:s3')
    .map((record) => ({
      bucket: record.s3?.bucket?.name ?? '',
      key: record.s3?.object?.key ? decodeS3Key(record.s3.object.key) : '',
    }))
    .filter((record): record is BackupRecord => Boolean(record.bucket && record.key));
}

async function processBackupObject(bucket: string, key: string) {
  if (!key.startsWith(RANKING_BACKUP_PREFIX) || !key.endsWith('.sq3.zst')) {
    console.log(`Skipping non-ranking backup object: s3://${bucket}/${key}`);
    return { skipped: true, bucket, key };
  }

  const dbPath = path.join(os.tmpdir(), `GunzDB-${Date.now()}.sq3`);
  console.log(`Downloading ranking source: s3://${bucket}/${key}`);

  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) {
      throw new Error(`S3 object has empty body: s3://${bucket}/${key}`);
    }

    await decompressZstdStreamToFile(response.Body as AsyncIterable<Uint8Array>, dbPath);

    const players = await collectTopPlayers(dbPath, RANKING_TOP_N);
    const content = formatRankingMessage(players, key);

    await postChannelMessage(DISCORD_RANKING_CHANNEL_ID, DISCORD_BOT_TOKEN, { content });
    console.log(`Posted ranking message for s3://${bucket}/${key}`);

    return { skipped: false, bucket, key, playerCount: players.length };
  } finally {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // Best-effort cleanup for Lambda /tmp.
    }
  }
}

export async function handler(event: S3Event) {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is required');
  if (!DISCORD_RANKING_CHANNEL_ID) throw new Error('DISCORD_RANKING_CHANNEL_ID is required');

  const records = getBackupRecords(event);
  if (records.length === 0) {
    console.warn('No S3 records found in ranking publisher event');
    return { processed: [] };
  }

  const processed = [];
  for (const record of records) {
    processed.push(await processBackupObject(record.bucket, record.key));
  }

  return { processed };
}
