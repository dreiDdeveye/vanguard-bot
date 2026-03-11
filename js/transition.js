// ===== PAGE TRANSITION – GLITCH DISSOLVE =====
(function () {
  const gt = document.getElementById('glitchTransition');
  if (!gt) return;

  document.querySelectorAll('.nav-links a[href^="#"]').forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      // Close mobile menu if open
      const navLinksEl = document.getElementById('navLinks');
      const hamburgerEl = document.getElementById('hamburger');
      if (navLinksEl) navLinksEl.classList.remove('open');
      if (hamburgerEl) hamburgerEl.classList.remove('active');

      playSound('click');

      // Randomize slice delays for organic glitch feel
      const slices = gt.querySelectorAll('.gt-slice');
      slices.forEach(s => {
        s.style.animationDelay = Math.floor(Math.random() * 60) + 'ms';
      });

      // Glitch in
      gt.classList.remove('exit');
      gt.classList.add('active');

      setTimeout(() => {
        // Scroll while slices cover screen
        window.scrollTo({ top: target.offsetTop - 80, behavior: 'instant' });

        // Re-randomize delays for exit
        slices.forEach(s => {
          s.style.animationDelay = Math.floor(Math.random() * 50) + 'ms';
        });

        // Glitch out
        gt.classList.remove('active');
        gt.classList.add('exit');

        setTimeout(() => {
          gt.classList.remove('exit');
          slices.forEach(s => { s.style.animationDelay = ''; });
        }, 450);
      }, 500);
    });
  });
})();
