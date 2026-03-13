// ===== UNIFIED SCROLL HANDLER (single rAF for all scroll effects) =====
(function () {
  // DOM refs (queried fresh since other scripts may not expose them)
  const navbar = document.getElementById('navbar');
  const scrollProgressBar = document.getElementById('scrollProgress');
  const embers = document.querySelectorAll('.ember');
  const sections = document.querySelectorAll('section[id]');
  const parallaxSections = document.querySelectorAll('.about, .collection, .roadmap, .stats, .arsenal, .faq');
  const heroInner = document.querySelector('.hero-inner');
  const heroTicker = document.querySelector('.hero-ticker');
  const heroSection = document.querySelector('.hero');
  const backToTopBtn = document.getElementById('backToTop');
  const allSections = document.querySelectorAll('.about, .collection, .roadmap, .stats, .arsenal, .faq');
  const navLogo = navbar.querySelector('.logo');
  const navContainer = navbar.querySelector('.nav-container');
  let logoCenterOffset = 0;

  function calcLogoCenterOffset() {
    if (!navLogo || !navContainer) return;
    // Reset transform to measure original position
    navLogo.style.transition = 'none';
    navLogo.style.transform = 'translateX(0)';
    const logoRect = navLogo.getBoundingClientRect();
    const navRect = navContainer.getBoundingClientRect();
    logoCenterOffset = (navRect.left + navRect.width / 2) - (logoRect.left + logoRect.width / 2);
    navLogo.offsetHeight; // force reflow
    navLogo.style.transition = '';
  }

  calcLogoCenterOffset();
  window.addEventListener('resize', calcLogoCenterOffset);

  // Cache nav link map
  const navLinkMap = {};
  sections.forEach(section => {
    const id = section.getAttribute('id');
    const link = document.querySelector(`.nav-links a[href="#${id}"]`);
    if (link) navLinkMap[id] = link;
  });

  // Collect morphable child elements per section
  const morphTargets = [];
  allSections.forEach(section => {
    const container = section.querySelector('.container, .collection-split, .about-panel');
    const title = section.querySelector('h2');
    const grid = section.querySelector('.nft-grid, .stats-bento, .arsenal-track-wrapper, .roadmap-zigzag, .faq-list, .about-panel, .collection-split');
    morphTargets.push({ section, container, title, grid });
  });

  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      const vh = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight - vh;

      // 1. Navbar
      const isScrolled = scrollY > 50;
      navbar.classList.toggle('scrolled', isScrolled);

      // Center the logo when scrolled
      if (navLogo) {
        navLogo.style.transform = isScrolled ? `translateX(${logoCenterOffset}px)` : 'translateX(0)';
      }

      // 2. Scroll progress bar
      if (scrollProgressBar) {
        scrollProgressBar.style.width = (docHeight > 0 ? (scrollY / docHeight) * 100 : 0) + '%';
      }

      // 3. Active nav highlight (using cached link map)
      const scrollCheck = scrollY + 120;
      sections.forEach(section => {
        const id = section.getAttribute('id');
        const link = navLinkMap[id];
        if (link) link.classList.toggle('active', scrollCheck >= section.offsetTop && scrollCheck < section.offsetTop + section.offsetHeight);
      });

      // 4. Parallax embers (use transform instead of marginBottom)
      embers.forEach((ember, i) => {
        const speed = 0.015 + (i % 4) * 0.008;
        ember.style.transform = `translateY(${scrollY * -speed}px) rotate(45deg)`;
      });

      // 5. Parallax depth layers
      parallaxSections.forEach(section => {
        const rect = section.getBoundingClientRect();
        const offset = ((rect.top + rect.height / 2) - vh / 2) * 0.02;
        section.style.setProperty('--parallax-y', offset + 'px');
      });

      // 6. Back to top button
      if (backToTopBtn) backToTopBtn.classList.toggle('visible', scrollY > 600);

      // 7. Hero morph
      if (heroInner && heroSection) {
        const heroH = heroSection.offsetHeight;
        const p = Math.min(scrollY / heroH, 1);
        heroInner.style.opacity = Math.max(0, 1 - p * 1.5);
        heroInner.style.transform = `translateY(${p * -40}px) scale(${1 - p * 0.15})`;
        if (heroTicker) heroTicker.style.opacity = Math.max(0, 1 - p * 2);
      }

      // 8. Section morphs (only for visible sections)
      morphTargets.forEach(({ section, container, title, grid }) => {
        const rect = section.getBoundingClientRect();
        // Skip sections completely off screen
        if (rect.bottom < -100 || rect.top > vh + 100) return;

        const centerOffset = (rect.top + rect.height / 2 - vh / 2) / vh;
        const vis = Math.max(0, 1 - Math.abs(centerOffset) * 1.2);

        if (container) {
          container.style.transform = `translateY(${centerOffset * 20}px) scale(${0.96 + vis * 0.04})`;
          container.style.opacity = 0.4 + vis * 0.6;
        }
        if (title) {
          title.style.transform = `translateX(${(1 - vis) * -20}px)`;
        }
        if (grid) {
          grid.style.transform = `translateY(${centerOffset * 12}px) scale(${0.97 + vis * 0.03})`;
        }
      });

      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
})();
