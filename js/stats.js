// ===== SMOOTH COUNTER ANIMATION =====
function animateCounter(el, target, duration) {
  const start = 0;
  const startTime = performance.now();
  const isFormatted = target >= 1000;

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + (target - start) * eased);

    if (isFormatted) {
      el.textContent = current.toLocaleString();
    } else {
      el.textContent = current;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Observe ticker counters
const tickerObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !entry.target.dataset.animated) {
      entry.target.dataset.animated = 'true';
      const target = parseInt(entry.target.dataset.target, 10);
      animateCounter(entry.target, target, 2000);
    }
  });
}, { threshold: 0.5 });

document.querySelectorAll('[data-target]').forEach(el => {
  tickerObserver.observe(el);
});

// ===== MATRIX SCRAMBLE COUNTER =====
(function () {
  const scrambleChars = '0123456789';

  function scrambleCounter(el, target, duration) {
    const startTime = performance.now();
    const isFormatted = target >= 1000;
    const targetStr = isFormatted ? target.toLocaleString() : String(target);

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      if (progress < 1) {
        let display = '';
        for (let i = 0; i < targetStr.length; i++) {
          const charProgress = Math.min(1, progress * 1.5 - (i * 0.05));
          if (targetStr[i] === ',' || targetStr[i] === '.') {
            display += targetStr[i];
          } else if (charProgress >= 1) {
            display += targetStr[i];
          } else {
            display += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
          }
        }
        el.textContent = display;
        requestAnimationFrame(update);
      } else {
        el.textContent = targetStr;
      }
    }
    requestAnimationFrame(update);
  }

  const scrambleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.scrambled) {
        entry.target.dataset.scrambled = 'true';
        const target = parseInt(entry.target.dataset.target, 10);
        scrambleCounter(entry.target, target, 2200);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.stat-value[data-target]').forEach(el => {
    scrambleObserver.observe(el);
  });
})();

