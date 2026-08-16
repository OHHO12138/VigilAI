// 轻提示
import { el } from './dom.js';

let timer = null;

function ensureToast() {
  let node = document.getElementById('toast');
  if (!node) {
    node = el('div', { id: 'toast', class: 'toast', style: 'display:none;' });
    document.body.appendChild(node);
  }
  return node;
}

export function showToast(message, type = 'info') {
  const node = ensureToast();
  node.textContent = message;
  node.className = `toast show ${type}`;
  node.style.display = '';
  clearTimeout(timer);
  timer = setTimeout(() => {
    node.classList.remove('show');
    node.style.display = 'none';
  }, 2400);
}
