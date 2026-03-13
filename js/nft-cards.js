// ===== NFT COLLECTION CARDS (REAL IMAGES) =====
const categories = ['Genesis', 'Ascended', 'Elite', 'Core'];
const rarities = ['Legendary', 'Epic', 'Rare', 'Common'];
const rarityWeights = [0.05, 0.15, 0.35, 0.45];

// Map card index to image file
const nftImages = [
  'public/image1.png',
  'public/image2.png',
  'public/image3.png',
  'public/image4.png',
  'public/image5.png',
  'public/image6.png',
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

for (let i = 0; i < nftImages.length; i++) {
  const category = categories[i % categories.length];
  const rarity = getWeightedRarity();
  const id = String(1000 + i).padStart(4, '0');
  const imgSrc = nftImages[i];

  const card = document.createElement('div');
  card.className = 'nft-card reveal';
  card.dataset.filter = category.toLowerCase();
  card.dataset.delay = String((i % 3) + 1);
  card.innerHTML = `
    <div class="nft-card-glow"></div>
    <div class="nft-image">
      <img src="${imgSrc}" alt="Vanguard #${id}" class="nft-img" />
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
