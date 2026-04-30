const DISCORD_API_BASE = 'https://discord.com/api/v10';

type DiscordMessagePayload = {
  content: string;
};

export async function postChannelMessage(
  channelId: string,
  botToken: string,
  payload: DiscordMessagePayload,
): Promise<unknown> {
  if (!channelId) throw new Error('Discord channel id is required');
  if (!botToken) throw new Error('Discord bot token is required');

  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord message post failed: ${response.status} ${body}`);
  }

  return response.json();
}
