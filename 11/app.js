(() => {
  const progress = document.getElementById('progressBar');
  const revealItems = document.querySelectorAll('.reveal');
  const filters = document.querySelectorAll('.filter');
  const cards = document.querySelectorAll('.card');
  const entries = document.querySelectorAll('.entry');
  const navLinks = document.querySelectorAll('.quicknav a');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.querySelector('.lightbox-close');

  const updateProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  };

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((items, observer) => {
      items.forEach((item) => {
        if (item.isIntersecting) {
          item.target.classList.add('is-visible');
          observer.unobserve(item.target);
        }
      });
    }, { threshold: 0.08 });
    revealItems.forEach((item) => revealObserver.observe(item));

    const sectionObserver = new IntersectionObserver((items) => {
      items.forEach((item) => {
        if (!item.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle('is-active', link.getAttribute('href') === `#${item.target.id}`);
        });
      });
    }, { rootMargin: '-25% 0px -65% 0px' });
    document.querySelectorAll('section[id], article[id]').forEach((el) => sectionObserver.observe(el));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  filters.forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.filter;
      filters.forEach((item) => item.classList.toggle('is-active', item === button));
      cards.forEach((card) => {
        card.classList.toggle('is-hidden', value !== 'all' && card.dataset.cat !== value);
      });
      entries.forEach((entry) => {
        entry.style.display = value !== 'all' && entry.dataset.cat !== value ? 'none' : '';
      });
    });
  });

  document.querySelectorAll('.shot').forEach((button) => {
    button.addEventListener('click', () => {
      lightboxImg.src = button.dataset.full;
      lightboxImg.alt = button.querySelector('img').alt;
      lightboxCaption.textContent = button.closest('figure').querySelector('figcaption').textContent;
      lightbox.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    });
  });

  const closeLightbox = () => {
    lightbox.classList.remove('is-open');
    lightboxImg.removeAttribute('src');
    document.body.style.overflow = '';
  };

  lightboxClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lightbox.classList.contains('is-open')) closeLightbox();
  });

  document.querySelectorAll('pre').forEach((block) => {
    const codeText = block.textContent;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-btn';
    button.textContent = 'COPY';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        button.textContent = 'COPIED';
      } catch {
        button.textContent = 'SELECT';
      }
      window.setTimeout(() => { button.textContent = 'COPY'; }, 1400);
    });
    block.appendChild(button);
  });
})();
