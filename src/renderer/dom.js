// DOM 小工具
export function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

// el('div', {class:'x', title:'y', onclick: fn}, [children|string])
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key in node && key !== 'list' && key !== 'type') {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// rgba(r,g,b,a) / #rrggbb ↔ {hex, alpha(0-100)}，设置面板颜色控件用
export function rgbaToHexAlpha(color) {
  if (!color) return { hex: '#000000', alpha: 100 };
  const rgba = String(color).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (rgba) {
    const hex = '#' + [rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    const alpha = rgba[4] === undefined ? 100 : Math.round(parseFloat(rgba[4]) * 100);
    return { hex, alpha };
  }
  const hexMatch = String(color).match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) return { hex: hexMatch[0].toLowerCase(), alpha: 100 };
  return { hex: '#000000', alpha: 100 };
}

export function hexAlphaToRgba(hex, alpha) {
  const m = String(hex).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const a = Math.max(0, Math.min(100, alpha)) / 100;
  return `rgba(${r},${g},${b},${a})`;
}
