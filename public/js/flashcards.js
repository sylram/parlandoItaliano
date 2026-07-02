import { speak } from './speech.js';

const flashcardGrid = document.getElementById('flashcard-grid');
const categorySelect = document.getElementById('flashcard-category-select');
const refreshButton = document.getElementById('refresh-flashcards');
const addFlashcardButton = document.getElementById('add-flashcard-button');
const flashcardBanner = document.getElementById('flashcard-banner');

const newItalian = document.getElementById('new-italian');
const newPronunciation = document.getElementById('new-pronunciation');
const newSpanish = document.getElementById('new-spanish');
const newCategory = document.getElementById('new-category');

async function fetchFlashcards() {
  const res = await fetch('/api/flashcards');
  return res.ok ? res.json() : { cards: [], newWordsAdded: false };
}

function renderCards(cards) {
  flashcardGrid.innerHTML = cards.map((card) => `
    <article class="flashcard-card">
      <h4>${card.categoria}</h4>
      <p class="term">${card.italiano}</p>
      <p>${card.espanol}</p>
      <p class="meta">${card.pronunciacion || ''}</p>
      <button class="flashcard-listen secondary-button" type="button">🔊 Escuchar</button>
    </article>
  `).join('');
}

// One delegated listener — reads the Italian term of the clicked card aloud.
flashcardGrid.addEventListener('click', (event) => {
  const button = event.target.closest('.flashcard-listen');
  if (!button) return;
  const term = button.closest('.flashcard-card')?.querySelector('.term')?.textContent?.trim();
  if (term) speak(term);
});

async function loadFlashcards() {
  const data = await fetchFlashcards();
  const category = categorySelect.value;
  const cards = category === 'Todas' ? data.cards : data.cards.filter((card) => card.categoria === category);
  renderCards(cards);
  flashcardBanner.classList.toggle('hidden', !data.newWordsAdded);
}

refreshButton.addEventListener('click', loadFlashcards);
categorySelect.addEventListener('change', loadFlashcards);

addFlashcardButton.addEventListener('click', async () => {
  const card = {
    italiano: newItalian.value.trim(),
    pronunciacion: newPronunciation.value.trim(),
    espanol: newSpanish.value.trim(),
    categoria: newCategory.value.trim() || 'General',
  };

  if (!card.italiano || !card.espanol) {
    alert('Agrega Italiano y Español.');
    return;
  }

  await fetch('/api/flashcards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card }),
  });

  newItalian.value = '';
  newPronunciation.value = '';
  newSpanish.value = '';
  newCategory.value = '';
  loadFlashcards();
});

loadFlashcards();
