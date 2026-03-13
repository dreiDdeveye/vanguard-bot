// ===== ARSENAL SHOWCASE CARDS =====
(function () {
  const track = document.getElementById('arsenalTrack');
  if (!track) return;

  const arsenalUnits = [
    { name: 'RONIN-X', rank: '#001', rarity: 'Legendary', stats: { PWR: 98, DEF: 87, SPD: 92 }, img: 'public/image7.png' },
    { name: 'GHOST FRAME', rank: '#007', rarity: 'Legendary', stats: { PWR: 95, DEF: 91, SPD: 88 }, img: 'public/image8.png' },
    { name: 'CRIMSON EDGE', rank: '#012', rarity: 'Epic', stats: { PWR: 90, DEF: 78, SPD: 96 }, img: 'public/image9.png' },
    { name: 'VOIDWALKER', rank: '#019', rarity: 'Epic', stats: { PWR: 88, DEF: 94, SPD: 82 }, img: 'public/image10.png' },
    { name: 'NOVA PRIME', rank: '#025', rarity: 'Epic', stats: { PWR: 92, DEF: 85, SPD: 90 }, img: 'public/image11.png' },
    { name: 'IRON SIGIL', rank: '#034', rarity: 'Rare', stats: { PWR: 85, DEF: 89, SPD: 79 }, img: 'public/image12.png' },
    { name: 'AEGIS MK-IV', rank: '#041', rarity: 'Rare', stats: { PWR: 82, DEF: 96, SPD: 74 }, img: 'public/image13.png' },
    { name: 'SPECTRE', rank: '#053', rarity: 'Rare', stats: { PWR: 79, DEF: 80, SPD: 97 }, img: 'public/image14.png' },
  ];

  arsenalUnits.forEach((unit, i) => {
    const card = document.createElement('div');
    card.className = 'arsenal-card reveal';
    card.dataset.delay = String((i % 3) + 1);

    const rarityClass = unit.rarity.toLowerCase();

    const statsHTML = Object.entries(unit.stats)
      .map(([key, val]) => `<span class="arsenal-stat"><span class="arsenal-stat-label">${key}</span><span class="arsenal-stat-value">${val}</span></span>`)
      .join('');

    card.innerHTML = `
      <div class="arsenal-card-bg" style="background: url('${unit.img}') center/cover no-repeat;"></div>
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

  // Duplicate all cards for seamless infinite loop
  const origCards = track.querySelectorAll('.arsenal-card');
  origCards.forEach(card => {
    const clone = card.cloneNode(true);
    track.appendChild(clone);
    initTilt(clone, 8);
  });

  // Reveal all cards immediately (no staggered reveal needed for carousel)
  track.querySelectorAll('.arsenal-card').forEach(c => c.classList.add('visible'));
})();
