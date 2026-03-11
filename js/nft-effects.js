// ===== 3D CARD TILT =====
// Global: initTilt (used by nft-cards.js and arsenal.js)
function initTilt(card, intensity) {
  const maxTilt = intensity || 15;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * maxTilt;
    const rotateY = (x - 0.5) * maxTilt;
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(800px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
  });
}

// ===== HOLOGRAPHIC FOIL ON NFT CARDS =====
(function () {
  if (window.matchMedia('(hover: none)').matches) return;

  // Add foil elements to existing cards (runs after nft-cards.js generates them)
  // Using MutationObserver or delayed init since cards may not exist yet
  function initFoil() {
    document.querySelectorAll('.nft-card').forEach(card => {
      if (card.querySelector('.nft-foil')) return; // Already has foil
      const foil = document.createElement('div');
      foil.className = 'nft-foil';
      card.appendChild(foil);

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        foil.style.backgroundPosition = `${x}% ${y}%`;
      });
    });
  }

  // Delay to ensure cards are generated
  setTimeout(initFoil, 100);
})();
