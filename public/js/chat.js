import { initSpeech, toggleSpeechRecognition, speak } from './speech.js';
import { markFlashcardsUpdated } from './app.js';

const chatWindow = document.getElementById('chat-window');
const sendButton = document.getElementById('send-button');
const clearChatButton = document.getElementById('clear-chat-button');
const chatInput = document.getElementById('chat-input');

let conversationHistory = [];

function createMessage(role, html) {
  const card = document.createElement('div');
  card.className = `message ${role}`;
  card.innerHTML = `
    <span class="role">${role === 'user' ? 'Tú' : 'Professore'}</span>
    <div>${html}</div>
  `;
  return card;
}

function appendChat(message) {
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createAiMessage({ assistantText, translation, corrections, fixedSentence, note }) {
  const card = document.createElement('div');
  card.className = 'message ai';

  let body = `<p>${escapeHtml(assistantText)}</p>`;
  if (translation) {
    body += `<p class="meta">${escapeHtml(translation)}</p>`;
  }

  if (corrections.length > 0 || fixedSentence || note) {
    const items = corrections.map((correction, index) => {
      const wrong = escapeHtml(correction.sbagliato || correction.wrong || '');
      const right = escapeHtml(correction.corretto || correction.correct || '');
      const explanation = escapeHtml(correction.spiegazione || correction.explanation || '');
      const addButton = (correction.corretto || correction.correct)
        ? `<button class="corr-add" type="button" data-correction-index="${index}">➕ Flashcard</button>`
        : '';
      return `<li>
        <span class="corr-wrong">${wrong}</span> → <span class="corr-right">${right}</span>
        ${explanation ? `<span class="corr-note">— ${explanation}</span>` : ''}
        ${addButton}
      </li>`;
    }).join('');

    body += `<div class="corrections">
      <strong>✏️ Correcciones</strong>
      ${items ? `<ul>${items}</ul>` : ''}
      ${fixedSentence ? `<p class="corr-fixed">✅ ${escapeHtml(fixedSentence)}</p>` : ''}
      ${note ? `<p class="corr-tip">💡 ${escapeHtml(note)}</p>` : ''}
    </div>`;
  }

  card.innerHTML = `<span class="role">Professore</span><div>${body}</div>`;

  card.querySelectorAll('.corr-add').forEach((button) => {
    const correction = corrections[Number(button.dataset.correctionIndex)];
    button.addEventListener('click', () => addCorrectionToFlashcards(correction, button));
  });

  return card;
}

function addCorrectionToFlashcards(correction, button) {
  if (!correction) return;
  const italiano = (correction.corretto || correction.correct || '').trim();
  if (!italiano) return;

  let espanol = (correction.espanol || correction.traduccion || '').trim();
  if (!espanol) {
    // Model didn't include a translation — ask so the card is still complete.
    const answer = window.prompt(`¿Agregar "${italiano}" a tus flashcards?\nEscribe el significado en español:`, '');
    if (answer === null) return;
    espanol = answer.trim();
    if (!espanol) return;
  }

  postFlashcardWords([{
    italiano,
    espanol,
    pronuncia: (correction.pronuncia || correction.pronunciacion || '').trim(),
    categoria: (correction.categoria || 'Vida diaria').trim(),
  }]);

  if (button) {
    button.textContent = '✓ Agregada';
    button.disabled = true;
  }
}

async function postFlashcardWords(words) {
  if (!Array.isArray(words) || words.length === 0) return;

  try {
    await fetch('/api/flashcards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
    markFlashcardsUpdated();
  } catch (error) {
    console.warn('Unable to save flashcard words:', error);
  }
}

function parseAssistantResponse(data) {
  if (!data || typeof data !== 'object') return '';

  if (typeof data.risposta === 'string' && data.risposta.trim()) {
    return data.risposta;
  }

  if (typeof data.content === 'string' && data.content.trim()) {
    return data.content;
  }

  if (Array.isArray(data.content)) {
    for (const item of data.content) {
      if (item && typeof item.text === 'string' && item.text.trim()) {
        return item.text;
      }
    }
  }

  if (typeof data.completion === 'string' && data.completion.trim()) {
    return data.completion;
  }

  if (Array.isArray(data.completion)) {
    const completion = data.completion.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.text === 'string') return entry.text;
      if (entry && Array.isArray(entry.content)) {
        return entry.content.map((child) => typeof child.text === 'string' ? child.text : '').join('');
      }
      return '';
    }).join('');
    if (completion.trim()) return completion;
  }

  if (typeof data.text === 'string' && data.text.trim()) {
    return data.text;
  }

  if (typeof data.response === 'string' && data.response.trim()) {
    return data.response;
  }

  return '';
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;

  const clean = text.replace(/```json|```/gi, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    const objectMatch = clean.match(/\{[\s\S]*\}/m);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {}
    }

    const arrayMatch = clean.match(/\[[\s\S]*\]/m);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {}
    }
  }

  return null;
}

function stripCodeFences(text) {
  return String(text ?? '').replace(/```json|```/gi, '').trim();
}

// Pull a single string field out of (possibly truncated/invalid) JSON text.
function extractJsonString(text, key) {
  const match = String(text ?? '').match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!match) return '';
  return match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendChat(createMessage('user', `<p>${text}</p>`));
  conversationHistory.push({ role: 'user', content: text });
  chatInput.value = '';

  const loading = createMessage('ai', '<p>Cargando...</p>');
  appendChat(loading);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: `Eres un profesor de italiano para estudiantes hispanohablantes. El estudiante habla ESPAÑOL, no inglés. Nunca uses inglés.

Responde SIEMPRE con JSON válido y solo JSON, con estas claves:
- "risposta": tu respuesta conversacional EN ITALIANO.
- "traduzione": la traducción de "risposta" AL ESPAÑOL (nunca al inglés).
- "correzioni": array de correcciones; cada una { "sbagliato": "lo que escribió el estudiante", "corretto": "la palabra o forma correcta en italiano", "spiegazione": "explicación breve EN ESPAÑOL", "espanol": "traducción al español de 'corretto'", "pronuncia": "pronunciación aproximada de 'corretto'", "categoria": "tema" }. Usa [] si no hay errores.
- "frase_corretta": la frase del estudiante corregida y completa EN ITALIANO, o null si no había errores.
- "nota": un consejo breve de gramática o uso EN ESPAÑOL, o null.
- "new_words": palabras nuevas como [{ "italiano", "espanol", "pronuncia", "categoria" }].

Para "categoria" usa SIEMPRE un tema en español como: Números, Días, Meses, Colores, Presentaciones, Verbos, Vida diaria. NUNCA uses categorías gramaticales como "sustantivo", "verbo" o "adjetivo".

Mantén las respuestas simples, nivel A1-A2.`,
        messages: conversationHistory,
      }),
    });

    const data = await response.json();
    chatWindow.removeChild(loading);

    if (data.error) {
      appendChat(createMessage('ai', `<p>Error: ${data.error.message || data.error}</p>`));
      return;
    }

    const rawText = parseAssistantResponse(data);
    let parsedJson = rawText ? safeJsonParse(rawText) : null;
    if (!parsedJson && rawText) {
      // JSON was incomplete or invalid (usually truncated). Recover the key
      // fields so the user sees a clean reply instead of raw JSON braces.
      parsedJson = {
        risposta: extractJsonString(rawText, 'risposta'),
        traduzione: extractJsonString(rawText, 'traduzione'),
        nota: extractJsonString(rawText, 'nota'),
      };
    }
    const assistantText = parsedJson?.risposta || parsedJson?.response || parsedJson?.text || stripCodeFences(rawText) || 'No se recibió respuesta.';
    const translation = parsedJson?.traduzione || parsedJson?.traduccion || parsedJson?.translation || data.traduzione || data.traduccion || data.translation || '';
    const corrections = Array.isArray(parsedJson?.correzioni) ? parsedJson.correzioni : [];
    const fixedSentence = parsedJson?.frase_corretta || parsedJson?.frase_correta || '';
    const note = parsedJson?.nota || parsedJson?.pronuncia || '';
    const newWords = parsedJson?.new_words || parsedJson?.words || data.new_words || data.words || [];

    appendChat(createAiMessage({ assistantText, translation, corrections, fixedSentence, note }));

    // Always read the Italian reply aloud — never the Spanish notes/translation.
    speak(assistantText);

    conversationHistory.push({ role: 'assistant', content: assistantText });

    if (Array.isArray(newWords) && newWords.length > 0) {
      postFlashcardWords(newWords);
    }
  } catch (error) {
    chatWindow.removeChild(loading);
    appendChat(createMessage('ai', `<p>Error de conexión: ${error.message}</p>`));
  }
}

sendButton.addEventListener('click', sendChat);
clearChatButton.addEventListener('click', () => {
  chatWindow.innerHTML = '';
  conversationHistory = [];
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && document.activeElement === chatInput) {
    event.preventDefault();
    sendChat();
  }
});

initSpeech();

document.getElementById('mic-button').addEventListener('click', toggleSpeechRecognition);
