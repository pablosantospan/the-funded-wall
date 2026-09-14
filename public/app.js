const COLS = 15;

async function loadWall() {
  const res = await fetch('/api/wall');
  const data = await res.json();

  document.getElementById('occupied-count').textContent = data.occupied;
  document.getElementById('total-count').textContent = data.total;
  document.getElementById('current-price').textContent = data.currentPrice;

  renderTopSpot(data.topSlot, data.topPrice);
  renderWall(data.slots);
}

function renderTopSpot(top, price) {
  const el = document.getElementById('top-spot');
  if (top.status === 'confirmed') {
    el.innerHTML = `
            <div class="top-spot-card">
        ${top.avatarUrl ? `<img class="top-spot-avatar" src="${top.avatarUrl}" alt="">` : ''}
        <div>
          <p class="label">top spot</p>
          <p class="name">${escapeHtml(top.alias)}</p>
          <p class="meta">${escapeHtml(top.propFirm || '')} ${top.payoutRange ? '· ' + escapeHtml(top.payoutRange) : ''}</p>
        </div>
      </div>`;
  } else if (top.status === 'reserved') {
    el.innerHTML = `
      <div class="top-spot-card">
        <div>
          <p class="label">top spot</p>
          <p class="name">taken — pending review</p>
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="top-spot-card" id="top-spot-card">
        <div>
          <p class="label">top spot</p>
          <p class="name">still open</p>
          <p class="meta">biggest, first thing people see</p>
        </div>
        <span class="price">${price}</span>
      </div>`;
    document.getElementById('top-spot-card').addEventListener('click', () => openBuyModal('top', price));
  }
}

function renderWall(slots) {
  const wall = document.getElementById('wall');
  wall.innerHTML = '';
  for (let i = 0; i < slots.length; i += COLS) {
    const row = document.createElement('div');
    row.className = 'wall-row' + (((i / COLS) % 2 === 1) ? ' offset' : '');
    for (const slot of slots.slice(i, i + COLS)) {
      const brick = document.createElement('div');
      brick.className = 'brick ' + slot.status;
    if (slot.status === 'confirmed') {
        brick.innerHTML = slot.avatarUrl
          ? `<img class="brick-avatar" src="${slot.avatarUrl}" alt=""><span>${escapeHtml(slot.alias)}</span>`
          : escapeHtml(slot.alias);
        brick.title = `${slot.alias} — ${slot.propFirm || ''} ${slot.payoutRange || ''}`;
        if (slot.xLink) {
          brick.addEventListener('click', () => window.open(slot.xLink, '_blank'));
        }
      } else if (slot.status === 'reserved') {
        brick.textContent = '';
        brick.title = 'reserved';
      } else {
        brick.textContent = '+';
        brick.addEventListener('click', () => openBuyModal('standard'));
      }
      row.appendChild(brick);
    }
    wall.appendChild(row);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- modal de compra ----------
const backdrop = document.getElementById('modal-backdrop');
const modalBody = document.getElementById('modal-body');

function openBuyModal(type, priceLabel) {
  modalBody.innerHTML = `
    <h2>${type === 'top' ? 'claim the top spot' : 'claim a spot on the wall'}</h2>
    <p>you'll enter your alias at checkout. after payment, you'll upload your payout or challenge screenshot to confirm your spot.</p>
    <button class="buy-btn" id="confirm-buy">pay ${priceLabel || ''} and continue</button>
  `;
  backdrop.classList.add('open');
  document.getElementById('confirm-buy').addEventListener('click', () => startCheckout(type));
}

async function startCheckout(type) {
  const btn = document.getElementById('confirm-buy');
  btn.disabled = true;
  btn.textContent = 'redirecting...';
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || 'something went wrong');
      btn.disabled = false;
      btn.textContent = 'try again';
    }
  } catch (err) {
    alert('network error, try again');
    btn.disabled = false;
  }
}

document.getElementById('modal-close').addEventListener('click', () => backdrop.classList.remove('open'));
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.remove('open'); });

loadWall();
