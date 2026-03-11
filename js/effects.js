// ===== SOUND EFFECTS =====
// Global: playSound, isMuted, audioCtx
let audioCtx = null;
let isMuted = false;

function playSound(type) {
  if (isMuted) return;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'hover') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === 'click') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'open') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.15);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'close') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.12);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  }
}

// Mute toggle
(function () {
  const muteBtn = document.getElementById('muteToggle');
  if (!muteBtn) return;

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('muted', isMuted);
    if (!isMuted) playSound('click');
  });
})();

// Hover sounds on interactive elements
document.querySelectorAll('.btn, .filter-btn, .nav-links a, .footer-links a').forEach(el => {
  el.addEventListener('mouseenter', () => playSound('hover'));
});

// ===== PRELOADER =====
(function () {
  const preloader = document.getElementById('preloader');
  const bar = document.getElementById('preloaderBar');
  const status = document.getElementById('preloaderStatus');
  if (!preloader) return;

  const messages = [
    'LOADING ASSETS...',
    'INITIALIZING HUD...',
    'CALIBRATING SENSORS...',
    'CONNECTING TO CHAIN...',
    'SYSTEMS ONLINE'
  ];

  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 18 + 5;
    if (progress > 100) progress = 100;
    bar.style.width = progress + '%';

    const msgIdx = Math.min(Math.floor(progress / 25), messages.length - 1);
    status.textContent = messages[msgIdx];

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        preloader.classList.add('hidden');
        document.body.style.overflow = '';
      }, 400);
    }
  }, 200);

  document.body.style.overflow = 'hidden';
})();

// ===== TYPEWRITER EFFECT =====
(function () {
  const titleEl = document.querySelector('.hero-title');
  if (!titleEl) return;

  const originalHTML = titleEl.innerHTML;
  const line1 = 'Collect the';
  const line2 = 'Uncollected.';

  titleEl.innerHTML = '<span class="typewriter-cursor"></span>';
  titleEl.style.opacity = '1';
  titleEl.style.animation = 'none';

  let charIndex = 0;
  const fullText = line1;

  function typePhase1() {
    if (charIndex <= fullText.length) {
      titleEl.innerHTML = fullText.slice(0, charIndex) + '<span class="typewriter-cursor"></span>';
      charIndex++;
      setTimeout(typePhase1, 60 + Math.random() * 40);
    } else {
      charIndex = 0;
      titleEl.innerHTML = line1 + '<br /><span class="accent-gradient"></span><span class="typewriter-cursor"></span>';
      setTimeout(typePhase2, 200);
    }
  }

  function typePhase2() {
    if (charIndex <= line2.length) {
      const gradientSpan = titleEl.querySelector('.accent-gradient');
      gradientSpan.textContent = line2.slice(0, charIndex);
      charIndex++;
      setTimeout(typePhase2, 70 + Math.random() * 50);
    } else {
      setTimeout(() => {
        const cursorEl = titleEl.querySelector('.typewriter-cursor');
        if (cursorEl) cursorEl.remove();
      }, 2000);
    }
  }

  setTimeout(typePhase1, 1800);
})();

// ===== BACK TO TOP =====
(function () {
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    playSound('click');
  });
})();

// ===== MAGNETIC BUTTONS =====
(function () {
  const magneticBtns = document.querySelectorAll('.hero-buttons .btn');
  if (window.matchMedia('(hover: none)').matches) return;

  magneticBtns.forEach(btn => {
    btn.classList.add('btn-magnetic');

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) * 0.25;
      const deltaY = (e.clientY - centerY) * 0.25;
      btn.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });
  });
})();
