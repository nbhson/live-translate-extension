// Chrome Extension: Live Translate Side Panel Script
let recognition = null;
let isListening = false;
let lastFinalIndex = -1;
let activeAudioTrack = null;

let finalizedOffset = 0;
let silenceTimer = null;
const SILENCE_THRESHOLD = 1500; // 1.5s pause to force-finalize
const MAX_INTERIM_LENGTH = 100; // 100 characters to force-finalize

let finalizedEnPhrases = [];
let finalizedViPhrases = [];

// DOM Elements
const toggleBtn = document.getElementById('toggleBtn');
const playIcon = document.getElementById('playIcon');
const stopIcon = document.getElementById('stopIcon');
const btnText = document.getElementById('btnText');
const clearBtn = document.getElementById('clearBtn');
const statusText = document.getElementById('statusText');
const logoDot = document.querySelector('.logo-dot');
const audioSourceSelect = document.getElementById('audioSourceSelect');

const englishLog = document.getElementById('englishLog');
const englishInterim = document.getElementById('englishInterim');
const enPlaceholder = document.getElementById('enPlaceholder');

const vietnameseLog = document.getElementById('vietnameseLog');
const vietnameseInterim = document.getElementById('vietnameseInterim');
const viPlaceholder = document.getElementById('viPlaceholder');

const copyEnBtn = document.getElementById('copyEnBtn');
const copyViBtn = document.getElementById('copyViBtn');
const permissionOverlay = document.getElementById('permissionOverlay');
const grantPermissionBtn = document.getElementById('grantPermissionBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkAndHidePermissionOverlay();
});

// Check microphone permission and hide overlay if granted
async function checkAndHidePermissionOverlay() {
  const isGranted = await checkMicPermission();
  if (isGranted) {
    permissionOverlay.style.display = 'none';
    return true;
  }
  return false;
}

// Check microphone permission
async function checkMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state === 'granted';
  } catch (e) {
    console.warn('navigator.permissions.query not supported for microphone', e);
    // Fallback check by attempting to query devices
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.some(device => device.kind === 'audioinput' && device.label !== '');
    } catch (err) {
      return false;
    }
  }
}

// Set up Event Listeners
function setupEventListeners() {
  toggleBtn.addEventListener('click', toggleListening);
  clearBtn.addEventListener('click', clearContent);
  
  copyEnBtn.addEventListener('click', () => {
    const text = getFullEnglishText();
    if (text) copyToClipboard(text, 'copyEnBtn');
  });
  
  copyViBtn.addEventListener('click', () => {
    const text = getFullVietnameseText();
    if (text) copyToClipboard(text, 'copyViBtn');
  });

  grantPermissionBtn.addEventListener('click', openPermissionTab);

  // Re-check permission when the user focuses back on the side panel
  window.addEventListener('focus', async () => {
    const granted = await checkAndHidePermissionOverlay();
    if (granted && isListening === false && btnText.innerText === 'Bắt đầu') {
      showStatus('Sẵn sàng');
    }
  });
}

// Open the permission tab helper
function openPermissionTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
}

// Toggle Start/Stop Listening
async function toggleListening() {
  if (isListening) {
    stopListening();
    return;
  }

  const source = audioSourceSelect.value;
  if (source === 'tab') {
    startTabCapture();
  } else {
    // Microphone mode
    const isGranted = await checkMicPermission();
    if (!isGranted) {
      showPermissionOverlay();
      return;
    }
    startListening();
  }
}

// Start capturing tab audio
function startTabCapture() {
  showStatus('Đang kết nối âm thanh Tab...');
  
  // Request a fresh stream ID from the background service worker
  chrome.runtime.sendMessage({ type: 'get-tab-stream-id' }, async (response) => {
    if (!response || response.error) {
      const errorMsg = response ? response.error : 'Không có phản hồi từ background';
      console.error('get-tab-stream-id failed:', errorMsg);
      showStatus('Không thể thu âm tab này.');
      alert('Không thể thu âm tab này. Đảm bảo bạn đã click vào biểu tượng Extension ở thanh công cụ để kích hoạt và Tab hiện tại đang phát âm thanh.');
      audioSourceSelect.value = 'mic';
      return;
    }

    const streamId = response.streamId;
    
    try {
      // Capture the tab stream using the stream token
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        },
        video: false
      });

      // Loopback to speakers so the user can still hear the video
      window.capturedAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      window.capturedSource = window.capturedAudioContext.createMediaStreamSource(stream);
      window.capturedSource.connect(window.capturedAudioContext.destination);

      // Extract the audio track
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        throw new Error('No audio tracks found in stream');
      }
      activeAudioTrack = tracks[0];
      window.capturedStream = stream;

      // Start speech recognition
      startListening();
    } catch (err) {
      console.error('Failed to process captured tab audio:', err);
      showStatus('Lỗi kết nối âm thanh tab. Đang thử bằng Microphone...');
      alert('Không thể kết nối âm thanh tab. Tự động chuyển sang chế độ Microphone.');
      audioSourceSelect.value = 'mic';
      cleanupTabCapture();
      
      // Fallback to mic
      const isGranted = await checkMicPermission();
      if (isGranted) startListening();
    }
  });
}

// Clean up tab capture resources
function cleanupTabCapture() {
  if (window.capturedStream) {
    window.capturedStream.getTracks().forEach(track => track.stop());
    window.capturedStream = null;
  }
  activeAudioTrack = null;
  if (window.capturedAudioContext) {
    try {
      window.capturedAudioContext.close();
    } catch (e) {}
    window.capturedAudioContext = null;
  }
}

// Show Permission Overlay
function showPermissionOverlay() {
  permissionOverlay.style.display = 'flex';
  showStatus('Cần cấp quyền microphone');
}

// Start Speech Recognition
function startListening() {
  if (!recognition) {
    initRecognition();
  }
  
  if (recognition) {
    try {
      lastFinalIndex = -1; // Reset index for new session
      finalizedOffset = 0; // Reset offset for new session
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      
      if (activeAudioTrack) {
        recognition.start(activeAudioTrack);
      } else {
        recognition.start();
      }
    } catch (e) {
      console.error('Error starting recognition:', e);
      // If passing track fails (e.g. browser doesn't support track parameter yet)
      if (activeAudioTrack) {
        console.warn('Track-based recognition failed. Falling back to default microphone...');
        activeAudioTrack = null;
        try {
          recognition.start();
        } catch (err) {
          console.error('Fallback microphone start failed:', err);
        }
      }
    }
  }
}

// Stop Speech Recognition
function stopListening() {
  isListening = false;
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      console.error('Error stopping recognition:', e);
    }
  }
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  cleanupTabCapture();
  updateUIForListening(false);
  showStatus('Đã dừng');
}

// Initialize SpeechRecognition Engine
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showStatus('Trình duyệt không hỗ trợ Speech Recognition.');
    return;
  }
  
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  
  recognition.onstart = () => {
    isListening = true;
    updateUIForListening(true);
    if (activeAudioTrack) {
      showStatus('Đang dịch âm thanh Tab...');
    } else {
      showStatus('Đang nghe tiếng Anh (Mic)...');
    }
  };
  
  recognition.onresult = async (event) => {
    let interimEn = '';
    
    // Clear silence timer on every new speech piece
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const result = event.results[i];
      
      if (result.isFinal) {
        if (i > lastFinalIndex) {
          lastFinalIndex = i;
          
          const rawText = result[0].transcript;
          // Extract remaining text that was not finalized by our timed triggers
          const remainingText = rawText.substring(finalizedOffset).trim();
          
          // Reset offset for next index block
          finalizedOffset = 0;
          
          if (remainingText) {
            await finalizeText(remainingText);
          }
        }
      } else {
        const rawText = result[0].transcript;
        
        // Safety guard for offset bounds
        if (finalizedOffset > rawText.length) {
          finalizedOffset = rawText.length;
        }
        
        interimEn = rawText.substring(finalizedOffset).trim();
      }
    }
    
    if (interimEn) {
      hidePlaceholders();
      englishInterim.innerText = interimEn + '...';
      debouncedTranslateInterim(interimEn);
      autoScroll();
      
      // Capture length and trigger timer
      const lastResultIndex = event.results.length - 1;
      const currentRawTextLength = event.results[lastResultIndex][0].transcript.length;
      
      if (interimEn.length >= MAX_INTERIM_LENGTH) {
        await forceFinalizeText(interimEn, currentRawTextLength);
      } else {
        silenceTimer = setTimeout(async () => {
          await forceFinalizeText(interimEn, currentRawTextLength);
        }, SILENCE_THRESHOLD);
      }
    }
  };
  
  recognition.onerror = (event) => {
    console.error('Recognition error:', event.error);
    if (event.error === 'not-allowed') {
      showPermissionOverlay();
      stopListening();
    } else if (event.error === 'no-speech') {
      // Just ignore, SpeechRecognition continuous handles this
    } else {
      showStatus(`Lỗi: ${event.error}`);
      stopListening();
    }
  };
  
  recognition.onend = () => {
    if (isListening) {
      // Auto-restart if we didn't explicitly stop
      try {
        lastFinalIndex = -1;
        finalizedOffset = 0;
        if (activeAudioTrack) {
          recognition.start(activeAudioTrack);
        } else {
          recognition.start();
        }
      } catch (e) {
        console.error('Auto-restart failed:', e);
      }
    } else {
      updateUIForListening(false);
    }
  };
}

// Helper to finalize and translate a block of text
async function finalizeText(text) {
  const cleanText = text.trim();
  if (!cleanText) return;
  
  hidePlaceholders();
  finalizedEnPhrases.push(cleanText);
  renderEnglish();
  
  // Translate to Vietnamese
  showStatus('Đang dịch...');
  const translated = await translateText(cleanText);
  finalizedViPhrases.push(translated || '[Không thể dịch]');
  renderVietnamese();
  
  if (activeAudioTrack) {
    showStatus('Đang dịch âm thanh Tab...');
  } else {
    showStatus('Đang nghe tiếng Anh (Mic)...');
  }
  
  // Clear interim display
  englishInterim.innerText = '';
  vietnameseInterim.innerText = '';
  autoScroll();
}

// Force finalize from interim speech
async function forceFinalizeText(text, rawLength) {
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  
  // Set offset pointer to prevent double-processing
  finalizedOffset = rawLength;
  
  // Clear interim displays immediately
  englishInterim.innerText = '';
  vietnameseInterim.innerText = '';
  
  await finalizeText(text);
}

// Translate Text via Google Translate free API
async function translateText(text) {
  if (!text || !text.trim()) return '';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data && data[0]) {
      let translation = '';
      for (let i = 0; i < data[0].length; i++) {
        if (data[0][i] && data[0][i][0]) {
          translation += data[0][i][0];
        }
      }
      return translation;
    }
    return '';
  } catch (error) {
    console.error('Translation error:', error);
    return '';
  }
}

// Debounce Interim Translation to avoid rate limits
let interimTranslateTimeout = null;
function debouncedTranslateInterim(text) {
  if (interimTranslateTimeout) {
    clearTimeout(interimTranslateTimeout);
  }
  
  interimTranslateTimeout = setTimeout(async () => {
    if (!text || !text.trim()) {
      vietnameseInterim.innerText = '';
      return;
    }
    
    const translated = await translateText(text);
    // Double check if interim text has not changed during API request
    const currentInterimEn = englishInterim.innerText.replace('...', '');
    if (currentInterimEn && text.trim() === currentInterimEn.trim()) {
      vietnameseInterim.innerText = translated + '...';
      autoScroll();
    }
  }, 300);
}

// Render finalized logs
function renderEnglish() {
  englishLog.innerHTML = finalizedEnPhrases.map(phrase => `<p>${phrase}</p>`).join('');
}

function renderVietnamese() {
  vietnameseLog.innerHTML = finalizedViPhrases.map(phrase => `<p>${phrase}</p>`).join('');
}

// Hide place holder text
function hidePlaceholders() {
  enPlaceholder.style.display = 'none';
  viPlaceholder.style.display = 'none';
}

// Show placeholders
function showPlaceholders() {
  enPlaceholder.style.display = 'flex';
  viPlaceholder.style.display = 'flex';
}

// Update UI States when listening/stopped
function updateUIForListening(active) {
  if (active) {
    toggleBtn.className = 'btn btn-danger';
    playIcon.style.display = 'none';
    stopIcon.style.display = 'block';
    btnText.innerText = 'Dừng';
    logoDot.classList.add('listening');
  } else {
    toggleBtn.className = 'btn btn-primary';
    playIcon.style.display = 'block';
    stopIcon.style.display = 'none';
    btnText.innerText = 'Bắt đầu';
    logoDot.classList.remove('listening');
  }
}

// Clear all transcript lists and logs
function clearContent() {
  finalizedEnPhrases = [];
  finalizedViPhrases = [];
  lastFinalIndex = -1;
  finalizedOffset = 0;
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  
  englishLog.innerHTML = '';
  englishInterim.innerText = '';
  vietnameseLog.innerHTML = '';
  vietnameseInterim.innerText = '';
  
  showPlaceholders();
  showStatus('Đã xóa lịch sử');
  setTimeout(() => {
    if (isListening) {
      if (activeAudioTrack) {
        showStatus('Đang dịch âm thanh Tab...');
      } else {
        showStatus('Đang nghe tiếng Anh (Mic)...');
      }
    } else {
      showStatus('Sẵn sàng');
    }
  }, 1000);
}

// Show extension status bar message
function showStatus(msg) {
  statusText.innerText = msg;
}

// Auto Scroll to bottom
function autoScroll() {
  const autoScrollCheck = document.getElementById('autoScrollCheck');
  if (autoScrollCheck && autoScrollCheck.checked) {
    const enContent = document.getElementById('englishContent');
    const viContent = document.getElementById('vietnameseContent');
    enContent.scrollTop = enContent.scrollHeight;
    viContent.scrollTop = viContent.scrollHeight;
  }
}

// Helper to get all combined English text
function getFullEnglishText() {
  const final = finalizedEnPhrases.join(' ');
  const interim = englishInterim.innerText.replace('...', '').trim();
  return (final + ' ' + interim).trim();
}

// Helper to get all combined Vietnamese text
function getFullVietnameseText() {
  const final = finalizedViPhrases.join(' ');
  const interim = vietnameseInterim.innerText.replace('...', '').trim();
  return (final + ' ' + interim).trim();
}

// Copy to Clipboard utility
async function copyToClipboard(text, buttonId) {
  try {
    await navigator.clipboard.writeText(text);
    const button = document.getElementById(buttonId);
    const originalHTML = button.innerHTML;
    
    button.innerHTML = `
      <svg viewBox="0 0 24 24" style="fill: var(--success);">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;
    
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
}
