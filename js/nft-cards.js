// ===== NFT COLLECTION CARDS (MECHA GENERATIVE PATTERNS) =====
const categories = ['Genesis', 'Ascended', 'Elite', 'Core'];
const rarities = ['Legendary', 'Epic', 'Rare', 'Common'];
const rarityWeights = [0.05, 0.15, 0.35, 0.45];

// Mecha-themed angular patterns
const patterns = [
  // Angular conic burst
  (hue) => `conic-gradient(from ${hue}deg at 35% 65%, hsl(155, 80%, 45%), hsl(${hue + 30}, 60%, 20%), hsl(160, 70%, 35%), hsl(${hue + 60}, 50%, 15%), hsl(155, 80%, 45%))`,
  // Circuit board mesh
  (hue) => `
    repeating-linear-gradient(0deg, transparent, transparent 30px, rgba(76, 201, 138, 0.08) 30px, rgba(76, 201, 138, 0.08) 31px),
    repeating-linear-gradient(90deg, transparent, transparent 30px, rgba(76, 201, 138, 0.06) 30px, rgba(76, 201, 138, 0.06) 31px),
    radial-gradient(ellipse at 25% 75%, hsl(155, 70%, 35%) 0%, transparent 45%),
    hsl(155, 15%, 4%)
  `,
  // Armor plate pattern
  (hue) => `
    linear-gradient(135deg, hsl(155, 40%, 20%) 25%, transparent 25%),
    linear-gradient(225deg, hsl(155, 30%, 15%) 25%, transparent 25%),
    linear-gradient(315deg, hsl(155, 40%, 20%) 25%, transparent 25%),
    linear-gradient(45deg, hsl(155, 30%, 15%) 25%, transparent 25%),
    hsl(155, 15%, 5%)
  `,
  // Angular tech stripes
  (hue) => `
    repeating-linear-gradient(45deg, hsl(155, 60%, 30%) 0px, hsl(155, 60%, 30%) 1px, transparent 1px, transparent 20px),
    repeating-linear-gradient(-45deg, hsl(155, 40%, 20%) 0px, hsl(155, 40%, 20%) 1px, transparent 1px, transparent 20px),
    linear-gradient(180deg, hsl(155, 20%, 6%), hsl(${hue}, 15%, 4%))
  `,
  // Hex grid
  (hue) => `
    repeating-conic-gradient(hsl(155, 50%, 30%) 0% 16.67%, transparent 0% 33.33%) 50% / 40px 40px,
    linear-gradient(135deg, hsl(155, 25%, 8%), hsl(${hue}, 20%, 5%))
  `,
  // Mecha cockpit display
  (hue) => `
    repeating-radial-gradient(circle at 50% 50%, transparent 0px, transparent 18px, hsl(155, 50%, 25%) 18px, hsl(155, 50%, 25%) 19px),
    radial-gradient(circle at 30% 30%, hsl(155, 40%, 30%) 0%, transparent 50%),
    hsl(155, 10%, 4%)
  `,
];

function getWeightedRarity() {
  const r = Math.random();
  let sum = 0;
  for (let i = 0; i < rarityWeights.length; i++) {
    sum += rarityWeights[i];
    if (r <= sum) return rarities[i];
  }
  return rarities[3];
}

const nftGrid = document.getElementById('nftGrid');

for (let i = 0; i < 6; i++) {
  const category = categories[i % categories.length];
  const rarity = getWeightedRarity();
  const id = String(1000 + i).padStart(4, '0');
  const hue = (i * 50 + 30) % 360;
  const pattern = patterns[i % patterns.length](hue);

  const card = document.createElement('div');
  card.className = 'nft-card reveal';
  card.dataset.filter = category.toLowerCase();
  card.dataset.delay = String((i % 3) + 1);
  card.innerHTML = `
    <div class="nft-card-glow"></div>
    <div class="nft-image" style="background: ${pattern};">
      <span class="nft-rarity rarity-${rarity.toLowerCase()}">${rarity}</span>
      <div class="nft-scanline"></div>
    </div>
    <div class="nft-info">
      <span class="nft-id-label">ID</span>
      <div class="nft-name">Vanguard #${id}</div>
      <div class="nft-meta">
        <span class="nft-class">${category}</span>
        <span class="nft-price">0.08 ETH</span>
      </div>
    </div>
    <div class="nft-view-overlay">
      <span class="nft-view-btn">VIEW</span>
    </div>`;
  nftGrid.appendChild(card);

  initTilt(card, 10);

  // Set scan height for scanline animation
  requestAnimationFrame(() => {
    const imgEl = card.querySelector('.nft-image');
    if (imgEl) card.style.setProperty('--scan-h', imgEl.offsetHeight + 'px');
  });
}
