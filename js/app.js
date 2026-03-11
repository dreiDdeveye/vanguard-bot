// ===== HERO HUD GRID + SCAN LINE =====
(function () {
  const canvas = document.getElementById('heroParticles');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let animId;
  let time = 0;
  const spacing = 70;
  let cols, rows;

  function resize() {
    const hero = canvas.parentElement;
    canvas.width = hero.offsetWidth;
    canvas.height = hero.offsetHeight;
    cols = Math.ceil(canvas.width / spacing) + 1;
    rows = Math.ceil(canvas.height / spacing) + 1;
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    time += 0.012;

    const w = canvas.width;
    const h = canvas.height;

    // Draw tech grid lines
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.03)';
    ctx.lineWidth = 0.5;

    for (let c = 0; c <= cols; c++) {
      const x = c * spacing;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r++) {
      const y = r * spacing;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Horizontal scan line sweeping down
    const scanY = ((time * 35) % (h + 200)) - 100;
    const scanGrad = ctx.createLinearGradient(0, 0, w, 0);
    scanGrad.addColorStop(0, 'rgba(76, 201, 138, 0)');
    scanGrad.addColorStop(0.2, 'rgba(76, 201, 138, 0.15)');
    scanGrad.addColorStop(0.5, 'rgba(76, 201, 138, 0.25)');
    scanGrad.addColorStop(0.8, 'rgba(76, 201, 138, 0.15)');
    scanGrad.addColorStop(1, 'rgba(76, 201, 138, 0)');

    ctx.beginPath();
    ctx.strokeStyle = scanGrad;
    ctx.lineWidth = 1.5;
    ctx.moveTo(0, scanY);
    ctx.lineTo(w, scanY);
    ctx.stroke();

    // Glow trail behind scan line
    const glowGrad = ctx.createLinearGradient(0, scanY - 50, 0, scanY + 10);
    glowGrad.addColorStop(0, 'rgba(76, 201, 138, 0)');
    glowGrad.addColorStop(0.7, 'rgba(76, 201, 138, 0.025)');
    glowGrad.addColorStop(1, 'rgba(76, 201, 138, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, scanY - 50, w, 60);

    // Grid intersection nodes that glow near scan line
    for (let c = 0; c <= cols; c++) {
      for (let r = 0; r <= rows; r++) {
        const x = c * spacing;
        const y = r * spacing;
        const distToScan = Math.abs(y - scanY);
        const scanInfluence = distToScan < 120 ? (1 - distToScan / 120) : 0;
        const alpha = 0.04 + scanInfluence * 0.4;
        const size = 1 + scanInfluence * 2.5;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = `rgba(76, 201, 138, ${alpha})`;
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();

        // Draw small connection lines from illuminated nodes
        if (scanInfluence > 0.3) {
          ctx.strokeStyle = `rgba(76, 201, 138, ${scanInfluence * 0.08})`;
          ctx.lineWidth = 0.5;
          if (c < cols) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + spacing, y);
            ctx.stroke();
          }
          if (r < rows) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + spacing);
            ctx.stroke();
          }
        }
      }
    }

    // Diagonal accent lines (subtle)
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.015)';
    ctx.lineWidth = 0.5;
    const diagOffset = (time * 15) % 300;
    for (let i = -h; i < w + h; i += 200) {
      ctx.beginPath();
      ctx.moveTo(i + diagOffset, 0);
      ctx.lineTo(i + diagOffset - h * 0.4, h);
      ctx.stroke();
    }

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

// ===== HERO 3D WIREFRAME =====
(function () {
  const canvas = document.getElementById('heroWireframe');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let time = 0;
  let hoverX = 0, hoverY = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  canvas.parentElement.addEventListener('mousemove', (e) => {
    const rect = canvas.parentElement.getBoundingClientRect();
    hoverX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.4;
    hoverY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.4;
  });

  canvas.parentElement.addEventListener('mouseleave', () => {
    hoverX = 0; hoverY = 0;
  });

  // Octahedron vertices
  const baseVerts = [
    [0, -1.2, 0],   // top
    [1, 0, 0],      // right
    [0, 0, 1],      // front
    [-1, 0, 0],     // left
    [0, 0, -1],     // back
    [0, 1.2, 0],    // bottom
  ];

  const edges = [
    [0,1],[0,2],[0,3],[0,4],  // top to mid
    [1,2],[2,3],[3,4],[4,1],  // mid ring
    [5,1],[5,2],[5,3],[5,4],  // bottom to mid
  ];

  // Inner smaller octahedron
  const innerScale = 0.5;

  function rotateY(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
  }
  function rotateX(v, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c];
  }

  function project(v, w, h, scale) {
    const fov = 3;
    const z = v[2] + fov;
    const px = (v[0] / z) * scale + w / 2;
    const py = (v[1] / z) * scale + h / 2;
    return [px, py, z];
  }

  function draw() {
    const w = canvas.getBoundingClientRect().width;
    const h = canvas.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    time += 0.008;

    const rotY = time + hoverX;
    const rotXAngle = Math.sin(time * 0.5) * 0.15 + hoverY;
    const scale = Math.min(w, h) * 0.7;

    function transformAndProject(verts, scl) {
      return verts.map(v => {
        let tv = [v[0] * scl, v[1] * scl, v[2] * scl];
        tv = rotateY(tv, rotY);
        tv = rotateX(tv, rotXAngle);
        return project(tv, w, h, scale);
      });
    }

    const outerP = transformAndProject(baseVerts, 1);
    const innerP = transformAndProject(baseVerts, innerScale);

    // Draw connecting lines (inner to outer)
    ctx.strokeStyle = 'rgba(76, 201, 138, 0.07)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < baseVerts.length; i++) {
      ctx.beginPath();
      ctx.moveTo(outerP[i][0], outerP[i][1]);
      ctx.lineTo(innerP[i][0], innerP[i][1]);
      ctx.stroke();
    }

    // Draw inner edges
    ctx.strokeStyle = 'rgba(76, 212, 201, 0.15)';
    ctx.lineWidth = 0.8;
    edges.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(innerP[a][0], innerP[a][1]);
      ctx.lineTo(innerP[b][0], innerP[b][1]);
      ctx.stroke();
    });

    // Draw outer edges
    edges.forEach(([a, b]) => {
      const avgZ = (outerP[a][2] + outerP[b][2]) / 2;
      const alpha = 0.15 + (1 - (avgZ - 2) / 3) * 0.35;
      ctx.strokeStyle = `rgba(76, 201, 138, ${Math.max(0.08, Math.min(alpha, 0.55))})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(outerP[a][0], outerP[a][1]);
      ctx.lineTo(outerP[b][0], outerP[b][1]);
      ctx.stroke();
    });

    // Draw vertices as diamonds
    outerP.forEach((p) => {
      const alpha = 0.3 + (1 - (p[2] - 2) / 3) * 0.5;
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(76, 201, 138, ${Math.max(0.15, Math.min(alpha, 0.8))})`;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(76, 201, 138, 0.4)';
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    });

    // Scanning horizontal line across the shape
    const scanLocalY = (Math.sin(time * 1.5) * 0.5 + 0.5) * h;
    const scanGrad = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
    scanGrad.addColorStop(0, 'rgba(76, 201, 138, 0)');
    scanGrad.addColorStop(0.5, 'rgba(76, 201, 138, 0.12)');
    scanGrad.addColorStop(1, 'rgba(76, 201, 138, 0)');
    ctx.strokeStyle = scanGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, scanLocalY);
    ctx.lineTo(w * 0.85, scanLocalY);
    ctx.stroke();

    requestAnimationFrame(draw);
  }
  draw();
})();

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
    <div class="nft-image" style="background: ${pattern};">
      <span class="nft-rarity rarity-${rarity.toLowerCase()}">${rarity}</span>
    </div>
    <div class="nft-info">
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

// ===== PRELOADER =====
(function () {
  const preloader = document.getElementById('preloader');
  const bar = document.getElementById('preloaderBar');
  const status = document.getElementById('preloaderStatus');
  if (!preloader) return;

  const messages = [
    'LOADING ASSETS...',
    'INITIALIZING HUD...',
    'CALIBRATING SENSORS...',
    'CONNECTING TO CHAIN...',
    'SYSTEMS ONLINE'
  ];

  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 18 + 5;
    if (progress > 100) progress = 100;
    bar.style.width = progress + '%';

    const msgIdx = Math.min(Math.floor(progress / 25), messages.length - 1);
    status.textContent = messages[msgIdx];

    if (progress >= 100) {
      clearInterval(interval);
      setTimeout(() => {
        preloader.classList.add('hidden');
        document.body.style.overflow = '';
      }, 400);
    }
  }, 200);

  document.body.style.overflow = 'hidden';
})();

// ===== CUSTOM CURSOR =====
(function () {
  const cursor = document.getElementById('customCursor');
  if (!cursor || window.matchMedia('(hover: none)').matches) return;

  let mouseX = 0, mouseY = 0;
  let cursorX = 0, cursorY = 0;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  function updateCursor() {
    cursorX += (mouseX - cursorX) * 0.15;
    cursorY += (mouseY - cursorY) * 0.15;
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';
    requestAnimationFrame(updateCursor);
  }
  updateCursor();

  const interactiveEls = document.querySelectorAll('a, button, .nft-card, .filter-btn, .faq-question');
  interactiveEls.forEach(el => {
    el.addEventListener('mouseenter', () => cursor.classList.add('hovering'));
    el.addEventListener('mouseleave', () => cursor.classList.remove('hovering'));
  });

  document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
  document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));
})();

// ===== TYPEWRITER EFFECT =====
(function () {
  const titleEl = document.querySelector('.hero-title');
  if (!titleEl) return;

  const originalHTML = titleEl.innerHTML;
  // Extract text parts
  const line1 = 'Collect the';
  const line2 = 'Uncollected.';

  titleEl.innerHTML = '<span class="typewriter-cursor"></span>';
  titleEl.style.opacity = '1';
  titleEl.style.animation = 'none';

  let charIndex = 0;
  const fullText = line1;

  function typePhase1() {
    if (charIndex <= fullText.length) {
      titleEl.innerHTML = fullText.slice(0, charIndex) + '<span class="typewriter-cursor"></span>';
      charIndex++;
      setTimeout(typePhase1, 60 + Math.random() * 40);
    } else {
      charIndex = 0;
      titleEl.innerHTML = line1 + '<br /><span class="accent-gradient"></span><span class="typewriter-cursor"></span>';
      setTimeout(typePhase2, 200);
    }
  }

  function typePhase2() {
    if (charIndex <= line2.length) {
      const gradientSpan = titleEl.querySelector('.accent-gradient');
      gradientSpan.textContent = line2.slice(0, charIndex);
      charIndex++;
      setTimeout(typePhase2, 70 + Math.random() * 50);
    } else {
      // Remove cursor after a delay
      setTimeout(() => {
        const cursorEl = titleEl.querySelector('.typewriter-cursor');
        if (cursorEl) cursorEl.remove();
      }, 2000);
    }
  }

  // Start typing after preloader finishes
  setTimeout(typePhase1, 1800);
})();

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

// ===== BACK TO TOP =====
(function () {
  const btn = document.getElementById('backToTop');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 600);
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    playSound('click');
  });
})();

// ===== SOUND EFFECTS =====
let audioCtx = null;
let isMuted = false;

function playSound(type) {
  if (isMuted) return;
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === 'hover') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === 'click') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now);
    osc.stop(now + 0.1);
  } else if (type === 'open') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(1000, now + 0.15);
    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'close') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.12);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.start(now);
    osc.stop(now + 0.12);
  }
}

// Mute toggle
(function () {
  const muteBtn = document.getElementById('muteToggle');
  if (!muteBtn) return;

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    muteBtn.classList.toggle('muted', isMuted);
    if (!isMuted) playSound('click');
  });
})();

// Hover sounds on interactive elements
document.querySelectorAll('.btn, .filter-btn, .nav-links a, .footer-links a').forEach(el => {
  el.addEventListener('mouseenter', () => playSound('hover'));
});

// ===== HAMBURGER ARIA =====
hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});

// ===== SCROLL PROGRESS BAR =====
(function () {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;

  window.addEventListener('scroll', () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    bar.style.width = pct + '%';
  });
})();

// ===== MAGNETIC BUTTONS =====
(function () {
  const magneticBtns = document.querySelectorAll('.hero-buttons .btn');
  if (window.matchMedia('(hover: none)').matches) return;

  magneticBtns.forEach(btn => {
    btn.classList.add('btn-magnetic');

    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) * 0.25;
      const deltaY = (e.clientY - centerY) * 0.25;
      btn.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translate(0, 0)';
    });
  });
})();

// ===== HOLOGRAPHIC FOIL ON NFT CARDS =====
(function () {
  if (window.matchMedia('(hover: none)').matches) return;

  // Add foil elements to existing cards
  document.querySelectorAll('.nft-card').forEach(card => {
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
})();

// ===== MATRIX SCRAMBLE COUNTER =====
(function () {
  // Override the counter observer to use scramble effect
  const scrambleChars = '0123456789';

  function scrambleCounter(el, target, duration) {
    const startTime = performance.now();
    const isFormatted = target >= 1000;
    const targetStr = isFormatted ? target.toLocaleString() : String(target);

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      if (progress < 1) {
        // During animation: mix real digits with random noise
        let display = '';
        for (let i = 0; i < targetStr.length; i++) {
          const charProgress = Math.min(1, progress * 1.5 - (i * 0.05));
          if (targetStr[i] === ',' || targetStr[i] === '.') {
            display += targetStr[i];
          } else if (charProgress >= 1) {
            display += targetStr[i];
          } else {
            display += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
          }
        }
        el.textContent = display;
        requestAnimationFrame(update);
      } else {
        el.textContent = targetStr;
      }
    }
    requestAnimationFrame(update);
  }

  // Create a new observer for stat values with data-target that haven't animated yet
  const scrambleObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.scrambled) {
        entry.target.dataset.scrambled = 'true';
        const target = parseInt(entry.target.dataset.target, 10);
        scrambleCounter(entry.target, target, 2200);
      }
    });
  }, { threshold: 0.5 });

  document.querySelectorAll('.stat-value[data-target]').forEach(el => {
    scrambleObserver.observe(el);
  });
})();

// ===== ANIMATED GRADIENT BORDERS ON STAT CARDS =====
(function () {
  document.querySelectorAll('.stat-card').forEach(card => {
    const borderLine = document.createElement('div');
    borderLine.className = 'glow-border-line';
    const inner = document.createElement('div');
    inner.className = 'glow-border-inner';
    borderLine.appendChild(inner);
    card.insertBefore(borderLine, card.firstChild);
  });
})();

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

// ===== PARALLAX DEPTH LAYERS =====
(function () {
  const parallaxSections = document.querySelectorAll('.about, .collection, .roadmap, .stats, .team, .faq');

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;

    parallaxSections.forEach(section => {
      const rect = section.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height / 2;
      const viewCenter = window.innerHeight / 2;
      const offset = (sectionCenter - viewCenter) * 0.02;

      // Move ::before pseudo-element via CSS custom property
      section.style.setProperty('--parallax-y', offset + 'px');
    });
  });
})();

// ===== CURSOR PARTICLE TRAIL =====
(function () {
  const canvas = document.getElementById('cursorTrail');
  if (!canvas || window.matchMedia('(hover: none)').matches) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  let mouseX = 0, mouseY = 0;
  let lastX = 0, lastY = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    const dx = mouseX - lastX;
    const dy = mouseY - lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 8) {
      particles.push({
        x: mouseX,
        y: mouseY,
        size: Math.random() * 2.5 + 1,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5 - 0.3
      });
      lastX = mouseX;
      lastY = mouseY;
    }
  });

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= p.decay;
      p.x += p.vx;
      p.y += p.vy;

      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = `rgba(76, 201, 138, ${p.life * 0.5})`;
      ctx.shadowBlur = 6;
      ctx.shadowColor = 'rgba(76, 201, 138, 0.3)';
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // Cap particles
    if (particles.length > 60) {
      particles = particles.slice(-60);
    }

    requestAnimationFrame(animate);
  }
  animate();
})();

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

// ===== SCROLL-DRIVEN MORPH ANIMATIONS (FULL SITE) =====
(function () {
  const heroInner = document.querySelector('.hero-inner');
  const heroTicker = document.querySelector('.hero-ticker');
  const heroSection = document.querySelector('.hero');
  const allSections = document.querySelectorAll('.about, .collection, .roadmap, .stats, .team, .faq');

  // Collect morphable child elements per section
  const morphTargets = [];
  allSections.forEach(section => {
    const container = section.querySelector('.container');
    const title = section.querySelector('h2');
    const grid = section.querySelector('.nft-grid, .stats-grid, .team-grid, .roadmap-timeline, .faq-list, .about-layout');
    morphTargets.push({ section, container, title, grid });
  });

  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const vh = window.innerHeight;

    // === HERO morph ===
    if (heroInner && heroSection) {
      const heroH = heroSection.offsetHeight;
      const p = Math.min(scrollY / heroH, 1);

      heroInner.style.opacity = Math.max(0, 1 - p * 1.5);
      heroInner.style.transform = `translateY(${p * -40}px) scale(${1 - p * 0.15}) perspective(800px) rotateX(${p * 3}deg)`;

      if (heroTicker) {
        heroTicker.style.opacity = Math.max(0, 1 - p * 2);
        heroTicker.style.transform = `translateY(${p * -20}px)`;
      }
    }

    // === SECTION morphs ===
    morphTargets.forEach(({ section, container, title, grid }) => {
      const rect = section.getBoundingClientRect();
      const sectionTop = rect.top;
      const sectionH = rect.height;

      // How far the section center is from viewport center (-1 to 1)
      const centerOffset = (sectionTop + sectionH / 2 - vh / 2) / vh;
      // 0 = fully centered, 1 = off screen
      const dist = Math.abs(centerOffset);
      // Visibility progress: 0 = far away, 1 = centered
      const vis = Math.max(0, 1 - dist * 1.2);

      // Container: subtle scale + Y shift based on distance from center
      if (container) {
        const scale = 0.96 + vis * 0.04;
        const ty = centerOffset * 20;
        container.style.transform = `translateY(${ty}px) scale(${scale})`;
        container.style.opacity = 0.4 + vis * 0.6;
      }

      // Title: slide from left + perspective tilt
      if (title) {
        const tx = (1 - vis) * -20;
        const rotY = (1 - vis) * 2;
        title.style.transform = `translateX(${tx}px) perspective(600px) rotateY(${rotY}deg)`;
      }

      // Grid/content: stagger Y offset + slight scale
      if (grid) {
        const gy = centerOffset * 12;
        const gs = 0.97 + vis * 0.03;
        grid.style.transform = `translateY(${gy}px) scale(${gs})`;
      }
    });
  });
})();
