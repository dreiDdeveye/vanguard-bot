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
