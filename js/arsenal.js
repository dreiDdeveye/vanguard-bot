// ===== ARSENAL SHOWCASE CARDS =====
(function () {
  const track = document.getElementById('arsenalTrack');
  if (!track) return;

  const arsenalUnits = [
    { name: 'RONIN-X', rank: '#001', rarity: 'Legendary', stats: { PWR: 98, DEF: 87, SPD: 92 }, hue: 155 },
    { name: 'GHOST FRAME', rank: '#007', rarity: 'Legendary', stats: { PWR: 95, DEF: 91, SPD: 88 }, hue: 170 },
    { name: 'CRIMSON EDGE', rank: '#012', rarity: 'Epic', stats: { PWR: 90, DEF: 78, SPD: 96 }, hue: 140 },
    { name: 'VOIDWALKER', rank: '#019', rarity: 'Epic', stats: { PWR: 88, DEF: 94, SPD: 82 }, hue: 165 },
    { name: 'NOVA PRIME', rank: '#025', rarity: 'Epic', stats: { PWR: 92, DEF: 85, SPD: 90 }, hue: 150 },
    { name: 'IRON SIGIL', rank: '#034', rarity: 'Rare', stats: { PWR: 85, DEF: 89, SPD: 79 }, hue: 160 },
    { name: 'AEGIS MK-IV', rank: '#041', rarity: 'Rare', stats: { PWR: 82, DEF: 96, SPD: 74 }, hue: 145 },
    { name: 'SPECTRE', rank: '#053', rarity: 'Rare', stats: { PWR: 79, DEF: 80, SPD: 97 }, hue: 175 },
  ];

  const arsenalPatterns = [
    (h) => `linear-gradient(135deg, hsl(${h}, 60%, 8%) 0%, hsl(${h}, 40%, 15%) 40%, hsl(${h}, 50%, 6%) 100%)`,
    (h) => `radial-gradient(ellipse at 30% 70%, hsl(${h}, 50%, 18%) 0%, hsl(${h}, 30%, 5%) 70%), linear-gradient(180deg, hsl(${h}, 20%, 8%), hsl(${h}, 15%, 3%))`,
    (h) => `conic-gradient(from 200deg at 50% 60%, hsl(${h}, 40%, 6%), hsl(${h}, 60%, 16%), hsl(${h}, 30%, 4%), hsl(${h}, 50%, 12%), hsl(${h}, 40%, 6%))`,
    (h) => `linear-gradient(160deg, hsl(${h}, 50%, 12%) 0%, hsl(${h}, 35%, 5%) 50%, hsl(${h}, 45%, 10%) 100%)`,
  ];

  arsenalUnits.forEach((unit, i) => {
    const card = document.createElement('div');
    card.className = 'arsenal-card reveal';
    card.dataset.delay = String((i % 3) + 1);

    const bg = arsenalPatterns[i % arsenalPatterns.length](unit.hue);
    const rarityClass = unit.rarity.toLowerCase();

    const statsHTML = Object.entries(unit.stats)
      .map(([key, val]) => `<span class="arsenal-stat"><span class="arsenal-stat-label">${key}</span><span class="arsenal-stat-value">${val}</span></span>`)
      .join('');

    card.innerHTML = `
      <div class="arsenal-card-bg" style="background: ${bg};"></div>
      <div class="arsenal-card-overlay"></div>
      <div class="arsenal-card-scan"></div>
      <div class="arsenal-card-info">
        <span class="arsenal-card-rank">${unit.rank}</span>
        <span class="arsenal-card-rarity rarity-${rarityClass}">${unit.rarity}</span>
        <h3 class="arsenal-card-name">${unit.name}</h3>
        <div class="arsenal-card-stats">${statsHTML}</div>
      </div>`;

    track.appendChild(card);
    initTilt(card, 8);
  });

  // Observe arsenal cards for reveal
  const arsenalObs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  track.querySelectorAll('.arsenal-card').forEach(c => arsenalObs.observe(c));
})();
