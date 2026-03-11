// ===== NAVBAR & MOBILE MENU =====
const navbar = document.getElementById('navbar');
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

// ===== HAMBURGER ARIA =====
hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.contains('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});
