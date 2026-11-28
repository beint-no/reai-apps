// Instant zero-dependency search + industry filter for the ReAI Apps catalog.
const bars = document.querySelectorAll('[data-catalog-filter]');
for (const bar of bars) {
  const input = bar.querySelector('input[type="search"]');
  const pills = [...bar.querySelectorAll('button[data-industry]')];
  const countEl = bar.querySelector('[data-filter-count]');
  const grid = bar.nextElementSibling;
  if (!grid) continue;
  const cards = [...grid.querySelectorAll('.app-card')];
  let activeIndustry = 'all';

  const apply = () => {
    const q = input instanceof HTMLInputElement ? input.value.trim().toLowerCase() : '';
    let visible = 0;
    for (const card of cards) {
      const ind = card.getAttribute('data-industry') || '';
      const hay = (card.getAttribute('data-search') || card.textContent || '').toLowerCase();
      const matchInd = activeIndustry === 'all' || ind === activeIndustry;
      const matchQ = !q || hay.includes(q);
      const show = matchInd && matchQ;
      card.hidden = !show;
      if (show) visible += 1;
    }
    if (countEl) {
      countEl.textContent = `${visible} / ${cards.length}`;
    }
  };

  if (input) {
    input.addEventListener('input', apply);
  }
  for (const pill of pills) {
    pill.addEventListener('click', () => {
      activeIndustry = pill.getAttribute('data-industry') || 'all';
      for (const other of pills) {
        other.setAttribute('aria-pressed', other === pill ? 'true' : 'false');
      }
      apply();
    });
  }
  apply();
}
