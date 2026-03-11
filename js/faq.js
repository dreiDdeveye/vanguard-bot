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
