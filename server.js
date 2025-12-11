const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- SECRET KEY ---
// Must match the client; default set to the shared key, but can be overridden by env.
const SECRET_KEY =
  process.env.SECRET_KEY || 'A7q#zP!t8*K$vB2@cM5nF&hW9gL^eR4u';

if (!SECRET_KEY || SECRET_KEY === 'default_dev_key_change_this_123') {
  console.warn(
    'WARNING: No SECRET_KEY env set or using insecure default. Override SECRET_KEY in the environment.'
  );
}

function encrypt(text, key) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const t = text.charCodeAt(i);
    const k = key.charCodeAt(i % key.length);
    result += String.fromCharCode((t + k) % 256);
  }
  return Buffer.from(result, 'binary').toString('hex');
}

function decryptPayload(hex, key) {
  if (typeof hex !== 'string' || typeof key !== 'string' || key.length === 0) {
    return null;
  }
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) return null;
  const buf = Buffer.from(clean, 'hex');
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    const k = key.charCodeAt(i % key.length);
    out += String.fromCharCode((buf[i] - k + 256) % 256);
  }
  return out;
}

const brainrots = new Map();
const activePlayers = new Map();

const BRAINROT_LIVETIME_MS = 500; // 0.5s
const PLAYER_TIMEOUT_MS = 5000; // 5s

function now() {
  return Date.now();
}

function cleanupInactivePlayers() {
  const cutoff = now() - PLAYER_TIMEOUT_MS;
  for (const [key, player] of activePlayers) {
    if (player.lastSeen < cutoff) {
      activePlayers.delete(key);
    }
  }
}

function cleanupOldBrainrots() {
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  for (const [key, br] of brainrots) {
    if (br.lastSeen < cutoff) {
      brainrots.delete(key);
    }
  }
}

app.post('/players/heartbeat', (req, res) => {
  const { username, serverId, jobId, placeId } = req.body;
  if (!username || !serverId || !jobId) {
    return res.status(400).json({ error: 'Missing username, serverId, or jobId' });
  }
  const key = `${username.toLowerCase()}_${serverId}_${jobId}`;
  activePlayers.set(key, {
    username,
    serverId,
    jobId,
    placeId: placeId || serverId,
    lastSeen: now(),
  });
  res.json({ success: true });
});

app.get('/players/active', (req, res) => {
  cleanupInactivePlayers();
  const allPlayers = Array.from(activePlayers.values()).map((p) => ({
    username: p.username,
    serverId: p.serverId,
    jobId: p.jobId,
    placeId: p.placeId,
    secondsSinceLastSeen: Math.floor((now() - p.lastSeen) / 1000),
  }));
  res.json(allPlayers);
});

app.post('/brainrots', (req, res) => {
  let data = req.body;

  // If encrypted payload provided, decrypt it first.
  if (data && typeof data.payload === 'string') {
    const decrypted = decryptPayload(data.payload, SECRET_KEY);
    if (!decrypted) {
      return res.status(400).json({ error: 'Bad encrypted payload' });
    }
    try {
      data = JSON.parse(decrypted);
    } catch (err) {
      return res.status(400).json({ error: 'Malformed decrypted JSON' });
    }
  }

  let name = typeof data.name === 'string' ? data.name.trim() : '';
  let serverId = typeof data.serverId === 'string' ? data.serverId.trim() : '';
  let jobId = typeof data.jobId === 'string' ? data.jobId.trim() : '';

  if (!name || !serverId || !jobId) {
    return res.status(400).json({ error: 'Missing name, serverId, or jobId' });
  }

  const source =
    (req.ip && req.ip.includes('railway')) ||
    (req.headers['x-forwarded-for'] || '').toString().includes('railway')
      ? 'bot'
      : 'lua';
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;

  brainrots.set(key, {
    name,
    serverId,
    jobId,
    players: data.players,
    moneyPerSec: data.moneyPerSec,
    lastSeen: now(),
    active: true,
    source,
  });

  res.json({ success: true });
});

app.get('/brainrots', (req, res) => {
  cleanupOldBrainrots();
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  const activeList = [];
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
      activeList.push({
        name: br.name,
        serverId: br.serverId,
        jobId: br.jobId,
        players: br.players,
        moneyPerSec: br.moneyPerSec,
        lastSeen: br.lastSeen,
        source: br.source,
      });
    }
  }
  activeList.sort((a, b) => b.lastSeen - a.lastSeen);
  const encryptedData = encrypt(JSON.stringify(activeList), SECRET_KEY);
  res.json({ payload: encryptedData });
});

app.delete('/brainrots', (req, res) => {
  const count = brainrots.size;
  brainrots.clear();
  res.json({ success: true, cleared: count });
});

app.patch('/brainrots/leave', (req, res) => {
  let { name, serverId, jobId } = req.body;
  name = typeof name === 'string' ? name.trim() : '';
  serverId = typeof serverId === 'string' ? serverId.trim() : '';
  jobId = typeof jobId === 'string' ? jobId.trim() : '';
  const key = `${serverId}_${name.toLowerCase()}_${jobId}`;
  brainrots.delete(key);
  res.json({ success: true });
});

app.get('/', (req, res) => {
  cleanupOldBrainrots();
  let activeCount = 0;
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) activeCount++;
  }
  res.send(`
    <h1>🧠 Encrypted Brainrot Backend</h1>
    <p>The <code>/brainrots</code> endpoint is encrypted.</p>
    <hr>
    <p><strong>Active Brainrots:</strong> ${activeCount}</p>
    <p><strong>Active Players:</strong> ${activePlayers.size}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())} seconds</p>
    <hr>
    <p><a href="/players/active">👥 View Active Players (Unencrypted)</a></p>
    <p><a href="/brainrots/debug">🔍 Debug Data (Unencrypted)</a></p>
    <p><a href="/brainrots/stats">📈 Statistics (Unencrypted)</a></p>
  `);
});

app.get('/brainrots/debug', (req, res) => {
  cleanupOldBrainrots();
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  let activeCount = 0;
  let expiredCount = 0;
  const activeList = [];
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
      activeCount++;
      activeList.push({
        name: br.name,
        serverId: br.serverId,
        jobId: br.jobId,
        players: br.players,
        moneyPerSec: br.moneyPerSec,
        secondsSinceLastSeen: Math.floor((now() - br.lastSeen) / 1000),
      });
    } else {
      expiredCount++;
    }
  }
  res.json({
    summary: {
      totalStored: brainrots.size,
      activeCount,
      expiredCount,
    },
    active: activeList,
  });
});

app.get('/brainrots/stats', (req, res) => {
  cleanupOldBrainrots();
  const cutoff = now() - BRAINROT_LIVETIME_MS;
  let activeCount = 0;
  let luaCount = 0;
  let botCount = 0;
  for (const br of brainrots.values()) {
    if (br.lastSeen >= cutoff) {
      activeCount++;
      if (br.source === 'lua') luaCount++;
      else if (br.source === 'bot') botCount++;
    }
  }
  res.json({
    totalActive: activeCount,
    totalPlayers: activePlayers.size,
    bySource: { lua: luaCount, bot: botCount },
    uptime: Math.floor(process.uptime()),
  });
});

setInterval(() => {
  cleanupOldBrainrots();
  cleanupInactivePlayers();
}, 1000);

if (global.gc) {
  setInterval(() => global.gc(), 10000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Backend running on port ${PORT}`);
});
