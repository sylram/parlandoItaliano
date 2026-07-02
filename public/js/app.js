const tabs = document.querySelectorAll('.tab-button');
const panels = document.querySelectorAll('.tab-panel');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((btn) => btn.classList.remove('active'));
    panels.forEach((panel) => panel.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

export function markFlashcardsUpdated() {
  document.getElementById('flashcard-banner').classList.remove('hidden');
}

export function clearFlashcardBanner() {
  document.getElementById('flashcard-banner').classList.add('hidden');
}
