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
