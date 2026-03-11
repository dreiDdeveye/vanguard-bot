// ===== HERO AURORA WAVES =====
(function () {
  const canvas = document.getElementById('heroParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let animId;
  let time = 0;

  function resize() {
    const hero = canvas.parentElement;
    canvas.width = hero.offsetWidth;
    canvas.height = hero.offsetHeight;
  }

  function drawWave(yBase, amplitude, frequency, speed, alpha, thickness) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(201, 168, 76, ${alpha})`;
    ctx.lineWidth = thickness;
    ctx.shadowColor = 'rgba(201, 168, 76, 0.15)';
    ctx.shadowBlur = 20;

    for (let x = 0; x <= canvas.width; x += 2) {
      const y = yBase
        + Math.sin(x * frequency + time * speed) * amplitude
        + Math.sin(x * frequency * 0.5 + time * speed * 1.3) * amplitude * 0.5
        + Math.cos(x * frequency * 0.3 + time * speed * 0.7) * amplitude * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    time += 0.008;

    const h = canvas.height;

    drawWave(h * 0.3, 40, 0.003, 0.8, 0.04, 1.5);
    drawWave(h * 0.45, 55, 0.002, 0.6, 0.06, 2);
    drawWave(h * 0.55, 35, 0.004, 1.0, 0.03, 1);
    drawWave(h * 0.7, 50, 0.0025, 0.7, 0.05, 1.8);
    drawWave(h * 0.85, 30, 0.0035, 0.9, 0.025, 1);

    animId = requestAnimationFrame(draw);
  }

  resize();
  draw();

  window.addEventListener('resize', resize);

  const heroObs = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      if (!animId) draw();
    } else {
      cancelAnimationFrame(animId);
      animId = null;
    }
  }, { threshold: 0 });
  heroObs.observe(canvas.parentElement);
})();

// ===== NAVBAR SCROLL =====
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
});

// ===== MOBILE MENU =====
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('active');
  navLinks.classList.toggle('open');
});

navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('active');
    navLinks.classList.remove('open');
  });
});

// ===== CURSOR GLOW (HERO) =====
const cursorGlow = document.getElementById('cursorGlow');
const hero = document.querySelector('.hero');

hero.addEventListener('mouseenter', () => {
  cursorGlow.classList.add('visible');
});

hero.addEventListener('mouseleave', () => {
  cursorGlow.classList.remove('visible');
});

hero.addEventListener('mousemove', (e) => {
  cursorGlow.style.left = e.clientX + 'px';
  cursorGlow.style.top = e.clientY + 'px';
});

// ===== PARALLAX EMBERS (scroll speed shift) =====
const embers = document.querySelectorAll('.ember');
let scrollTicking = false;

window.addEventListener('scroll', () => {
  if (!scrollTicking) {
    requestAnimationFrame(() => {
      const scrollY = window.scrollY;
      embers.forEach((ember, i) => {
        const speed = 0.015 + (i % 4) * 0.008;
        ember.style.marginBottom = `${scrollY * speed}px`;
      });
      scrollTicking = false;
    });
    scrollTicking = true;
  }
});

// ===== 3D CARD TILT =====
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

// Hero featured card tilt
const heroCard = document.getElementById('heroCard');
if (heroCard) {
  initTilt(heroCard, 18);
}

// ===== NFT COLLECTION CARDS (LUXURY GENERATIVE PATTERNS) =====
const categories = ['Genesis', 'Ascended', 'Elite', 'Core'];
const rarities = ['Legendary', 'Epic', 'Rare', 'Common'];
const rarityWeights = [0.05, 0.15, 0.35, 0.45];

// Gold/luxury themed patterns
const patterns = [
  // Gold conic burst
  (hue) => `conic-gradient(from ${hue}deg at 35% 65%, hsl(42, 80%, 50%), hsl(${hue + 30}, 60%, 30%), hsl(42, 70%, 45%), hsl(${hue + 60}, 50%, 25%), hsl(42, 80%, 50%))`,
  // Dark mesh with gold accent
  (hue) => `
    radial-gradient(ellipse at 25% 75%, hsl(42, 70%, 45%) 0%, transparent 45%),
    radial-gradient(ellipse at 75% 25%, hsl(${hue}, 50%, 35%) 0%, transparent 45%),
    radial-gradient(ellipse at 50% 50%, hsl(42, 30%, 15%) 0%, transparent 70%),
    hsl(0, 0%, 4%)
  `,
  // Geometric gold
  (hue) => `
    repeating-conic-gradient(hsl(42, 60%, 40%) 0% 25%, transparent 0% 50%) 50% / 50px 50px,
    linear-gradient(135deg, hsl(42, 30%, 10%), hsl(${hue}, 20%, 8%))
  `,
  // Gold stripes
  (hue) => `
    repeating-linear-gradient(45deg, hsl(42, 70%, 42%) 0px, hsl(42, 70%, 42%) 2px, transparent 2px, transparent 22px),
    repeating-linear-gradient(-45deg, hsl(42, 50%, 30%) 0px, hsl(42, 50%, 30%) 2px, transparent 2px, transparent 22px),
    linear-gradient(135deg, hsl(42, 20%, 8%), hsl(${hue}, 15%, 6%))
  `,
  // Radial luxury
  (hue) => `
    repeating-radial-gradient(circle at 50% 50%, transparent 0px, transparent 22px, hsl(42, 60%, 40%) 22px, hsl(42, 60%, 40%) 24px),
    radial-gradient(circle at 30% 30%, hsl(42, 50%, 35%) 0%, transparent 55%),
    hsl(0, 0%, 4%)
  `,
  // Diamond facets
  (hue) => `
    linear-gradient(135deg, hsl(42, 50%, 30%) 25%, transparent 25%),
    linear-gradient(225deg, hsl(42, 40%, 25%) 25%, transparent 25%),
    linear-gradient(315deg, hsl(42, 50%, 30%) 25%, transparent 25%),
    linear-gradient(45deg, hsl(42, 40%, 25%) 25%, transparent 25%),
    hsl(42, 15%, 6%)
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
    <div class="nft-image" style="background: ${pattern};">
      <span class="nft-rarity rarity-${rarity.toLowerCase()}">${rarity}</span>
    </div>
    <div class="nft-info">
      <div class="nft-name">Vanguard #${id}</div>
      <div class="nft-meta">
        <span class="nft-class">${category}</span>
        <span class="nft-price">0.08 ETH</span>
      </div>
    </div>`;
  nftGrid.appendChild(card);

  initTilt(card, 10);
}

// ===== FILTER =====
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter;

    document.querySelectorAll('.nft-card').forEach(card => {
      if (filter === 'all' || card.dataset.filter === filter) {
        card.style.display = '';
        card.style.animation = 'fadeUp 0.4s ease forwards';
      } else {
        card.style.display = 'none';
      }
    });
  });
});

// ===== MINT CONTROLS =====
const PRICE = 0.08;
const MAX_MINT = 5;
let mintCount = 1;

const mintCountEl = document.getElementById('mintCount');
const mintPriceEl = document.getElementById('mintPrice');

function bounceCounter() {
  mintCountEl.style.transform = 'scale(1.25)';
  mintPriceEl.style.transform = 'scale(1.08)';
  setTimeout(() => {
    mintCountEl.style.transform = 'scale(1)';
    mintPriceEl.style.transform = 'scale(1)';
  }, 200);
}

document.getElementById('mintMinus').addEventListener('click', () => {
  if (mintCount > 1) {
    mintCount--;
    mintCountEl.textContent = mintCount;
    mintPriceEl.textContent = (mintCount * PRICE).toFixed(2) + ' ETH';
    bounceCounter();
  }
});

document.getElementById('mintPlus').addEventListener('click', () => {
  if (mintCount < MAX_MINT) {
    mintCount++;
    mintCountEl.textContent = mintCount;
    mintPriceEl.textContent = (mintCount * PRICE).toFixed(2) + ' ETH';
    bounceCounter();
  }
});

document.getElementById('mintBtn').addEventListener('click', () => {
  alert(`Minting ${mintCount} Vanguard NFT(s) for ${(mintCount * PRICE).toFixed(2)} ETH\n\nConnect a wallet to mint on mainnet.`);
});

// ===== WALLET =====
document.getElementById('connectWallet').addEventListener('click', () => {
  alert('Wallet connection coming soon.\n\nWill support MetaMask, WalletConnect, and Coinbase Wallet.');
});

// ===== FAQ =====
document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.parentElement;
    const answer = item.querySelector('.faq-answer');
    const isOpen = item.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(faq => {
      faq.classList.remove('active');
      faq.querySelector('.faq-answer').style.maxHeight = null;
    });

    if (!isOpen) {
      item.classList.add('active');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  });
});

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

// ===== ACTIVE NAV HIGHLIGHT =====
const sections = document.querySelectorAll('section[id]');

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY + 120;
  sections.forEach(section => {
    const top = section.offsetTop;
    const height = section.offsetHeight;
    const id = section.getAttribute('id');
    const link = document.querySelector(`.nav-links a[href="#${id}"]`);
    if (link) {
      link.classList.toggle('active', scrollY >= top && scrollY < top + height);
    }
  });
});

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
