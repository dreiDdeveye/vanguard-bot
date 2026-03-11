// ===== NFT DETAIL MODAL =====
(function () {
  const modal = document.getElementById('nftModal');
  const modalImage = document.getElementById('nftModalImage');
  const modalName = document.getElementById('nftModalName');
  const modalRarity = document.getElementById('nftModalRarity');
  const modalClass = document.getElementById('nftModalClass');
  const modalPrice = document.getElementById('nftModalPrice');
  const modalTraits = document.getElementById('nftModalTraits');
  const closeBtn = document.getElementById('nftModalClose');
  if (!modal) return;

  const traitNames = ['Background', 'Frame', 'Core', 'Overlay', 'Energy', 'Sigil'];
  const traitValues = {
    Background: ['Void Black', 'Deep Space', 'Neon Grid', 'Plasma Field'],
    Frame: ['Titanium', 'Carbon Fiber', 'Chromium', 'Obsidian'],
    Core: ['Fusion Reactor', 'Quantum Drive', 'Ion Core', 'Neural Link'],
    Overlay: ['Holographic', 'Wireframe', 'Circuit', 'Scanline'],
    Energy: ['Emerald Pulse', 'Cyan Stream', 'Ghost Flame', 'Static'],
    Sigil: ['Alpha', 'Omega', 'Delta', 'Sigma']
  };

  document.addEventListener('click', (e) => {
    const card = e.target.closest('.nft-card');
    if (!card) return;

    const name = card.querySelector('.nft-name').textContent;
    const rarity = card.querySelector('.nft-rarity').textContent;
    const rarityClass = card.querySelector('.nft-rarity').className;
    const category = card.querySelector('.nft-class').textContent;
    const price = card.querySelector('.nft-price').textContent;
    const image = card.querySelector('.nft-image');
    const bg = image.style.background;

    modalImage.style.background = bg;
    modalName.textContent = name;
    modalRarity.textContent = rarity;
    modalRarity.className = 'nft-modal-rarity ' + rarityClass.replace('nft-rarity ', '');
    modalClass.textContent = category;
    modalPrice.textContent = price;

    // Generate random traits
    modalTraits.innerHTML = traitNames.map(t => {
      const vals = traitValues[t];
      const val = vals[Math.floor(Math.random() * vals.length)];
      return `<div class="nft-modal-trait">
        <span class="nft-modal-trait-label">${t}</span>
        <span class="nft-modal-trait-value">${val}</span>
      </div>`;
    }).join('');

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    playSound('open');
  });

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    playSound('close');
  }

  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
  });
})();
