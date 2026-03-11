// ===== SCROLL REVEAL (STAGGERED) =====
const revealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

revealElements.forEach(el => observer.observe(el));

// ===== TEXT REVEAL MASK — observe =====
(function () {
  const maskEls = document.querySelectorAll('.reveal-mask');
  const maskObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  maskEls.forEach(el => maskObs.observe(el));
})();

// ===== FLOATING HUD ELEMENTS — reveal on scroll =====
(function () {
  const hudEls = document.querySelectorAll('.hud-float');
  const hudObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      entry.target.classList.toggle('visible', entry.isIntersecting);
    });
  }, { threshold: 0, rootMargin: '0px 0px -60px 0px' });
  hudEls.forEach(el => hudObs.observe(el));
})();
