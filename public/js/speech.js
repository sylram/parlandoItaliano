const micButton = document.getElementById('mic-button');
const speechStatus = document.getElementById('speech-status');
const chatInput = document.getElementById('chat-input');

let recognition = null;
let isListening = false;
const synth = window.speechSynthesis;

export function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    speechStatus.textContent = 'Reconocimiento no soportado en este navegador.';
    micButton.disabled = true;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'it-IT';
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        chatInput.value = chatInput.value.trim() + ' ' + result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    speechStatus.textContent = interim ? `Escuchando... ${interim}` : 'Presiona para hablar en italiano';
  });

  recognition.addEventListener('end', () => {
    toggleListening(false);
    speechStatus.textContent = 'Presiona para hablar en italiano';
  });

  recognition.addEventListener('error', (event) => {
    toggleListening(false);
    speechStatus.textContent = `Error: ${event.error}`;
  });
}

export function toggleSpeechRecognition() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    toggleListening(false);
  } else {
    recognition.start();
    toggleListening(true);
  }
}

function toggleListening(active) {
  isListening = active;
  micButton.classList.toggle('listening', active);
  micButton.textContent = active ? '🛑' : '🎙️';
}

export function speak(text) {
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'it-IT';
  utterance.rate = 0.95;
  synth.speak(utterance);
}
