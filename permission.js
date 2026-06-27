document.getElementById('grantBtn').addEventListener('click', async () => {
  try {
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Stop all tracks immediately as we only needed the permission, not the active stream
    stream.getTracks().forEach(track => track.stop());

    // Update UI to success state
    document.getElementById('requestArea').style.display = 'none';
    document.getElementById('grantedArea').style.display = 'block';
    
    const iconBox = document.getElementById('iconBox');
    iconBox.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
    iconBox.style.boxShadow = '0 0 25px rgba(16, 185, 129, 0.4)';
    iconBox.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `;

    // Wait 1.5s then close the tab
    setTimeout(() => {
      window.close();
    }, 1500);

  } catch (error) {
    console.error('Error requesting microphone access:', error);
    alert('Không thể truy cập Microphone. Vui lòng kiểm tra lại quyền của trình duyệt hoặc thiết bị của bạn.');
  }
});
