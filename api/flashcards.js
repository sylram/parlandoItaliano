const fs = require('fs');
const path = require('path');

const flashcardsPath = path.join(process.cwd(), 'data', 'flashcards.json');
const metaPath = path.join(process.cwd(), 'data', 'flashcards-meta.json');

// Supabase is the production store. If it isn't configured (or the package
// isn't installed), we fall back to the local JSON file so dev still works.
let createClient = null;
try {
  ({ createClient } = require('@supabase/supabase-js'));
} catch {
  createClient = null;
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient && supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const cards = supabase ? await dbGetCards() : await readFlashcards();
      const newWordsAdded = supabase ? false : ((await readMeta()).newWordsAdded ?? false);
      return res.status(200).json({ cards, newWordsAdded });
    }

    if (req.method === 'POST') {
      const { card, words } = req.body || {};

      if (card) {
        if (!card.italiano || !card.espanol) {
          return res.status(400).json({ error: 'Invalid card payload' });
        }
        if (supabase) {
          await dbSaveWords([cardToWord(card)]);
        } else {
          await saveCard(card);
          await writeMeta({ newWordsAdded: true, updatedAt: new Date().toISOString() });
        }
        return res.status(201).json({ ok: true });
      }

      if (Array.isArray(words) && words.length > 0) {
        const added = supabase ? await dbSaveWords(words) : await saveWords(words);
        if (!supabase && added > 0) {
          await writeMeta({ newWordsAdded: true, updatedAt: new Date().toISOString() });
        }
        return res.status(201).json({ ok: true, added });
      }

      return res.status(400).json({ error: 'Payload must include card or words' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('flashcards handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase();
}

function cardToWord(card) {
  return {
    italiano: card.italiano,
    espanol: card.espanol,
    pronuncia: card.pronunciacion || card.pronuncia || '',
    categoria: card.categoria || 'General',
  };
}

// ── Supabase-backed store ──────────────────────────────────────────────
async function dbGetCards() {
  const { data, error } = await supabase
    .from('flashcards')
    .select('italiano, pronunciacion, espanol, categoria')
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Returns how many rows were inserted (0 if all were duplicates).
async function dbSaveWords(words) {
  const existing = await dbGetCards();
  const seen = new Set(existing.map((c) => normalizeWord(c.italiano)));
  const toInsert = [];

  for (const raw of words) {
    if (!raw || !raw.italiano || !raw.espanol) continue;
    const key = normalizeWord(raw.italiano);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    toInsert.push({
      italiano: raw.italiano,
      pronunciacion: raw.pronuncia || '',
      espanol: raw.espanol,
      categoria: raw.categoria || 'General',
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('flashcards').insert(toInsert);
    if (error) throw error;
  }
  return toInsert.length;
}

// ── Local JSON fallback (used when Supabase is not configured) ──────────
function dedupeByItaliano(cards) {
  const seen = new Set();
  const result = [];
  for (const card of cards) {
    const key = normalizeWord(card.italiano);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}

async function readFlashcards() {
  try {
    const content = await fs.promises.readFile(flashcardsPath, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? dedupeByItaliano(parsed) : [];
  } catch {
    return [];
  }
}

async function readMeta() {
  try {
    const content = await fs.promises.readFile(metaPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// Persistence is best-effort: serverless hosts use a read-only filesystem,
// so a failed write must not crash the request.
async function safeWriteJson(filePath, data) {
  try {
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn('Could not persist file (read-only filesystem?):', err.message);
    return false;
  }
}

async function writeMeta(meta) {
  await safeWriteJson(metaPath, meta);
}

async function saveCard(card) {
  if (!card.italiano || !card.espanol) {
    return false;
  }

  const list = await readFlashcards();
  const exists = list.some((item) => normalizeWord(item.italiano) === normalizeWord(card.italiano));
  if (!exists) {
    list.push({
      italiano: card.italiano,
      pronunciacion: card.pronunciacion || '',
      espanol: card.espanol,
      categoria: card.categoria || 'General',
    });
    await safeWriteJson(flashcardsPath, list);
  }
  return true;
}

async function saveWords(words) {
  const list = await readFlashcards();
  let added = 0;

  for (const raw of words) {
    if (!raw || !raw.italiano || !raw.espanol) continue;
    const exists = list.some((item) => normalizeWord(item.italiano) === normalizeWord(raw.italiano));
    if (exists) continue;
    list.push({
      italiano: raw.italiano,
      pronunciacion: raw.pronuncia || '',
      espanol: raw.espanol,
      categoria: raw.categoria || 'General',
    });
    added += 1;
  }

  if (added > 0) {
    await safeWriteJson(flashcardsPath, list);
  }

  return added;
}
