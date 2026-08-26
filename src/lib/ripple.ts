/**
 * 点击涟漪（Ripple）：
 * 在任意按钮上挂载 onPointerDown，点击时从触点扩散一圈水波光晕。
 * 配合 CSS 的 .ripple-host / .ripple-ink 使用。
 */
export function useRipple() {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const host = e.currentTarget;
      const rect = host.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const ink = document.createElement('span');
      ink.className = 'ripple-ink';
      ink.style.width = ink.style.height = `${size}px`;
      ink.style.left = `${e.clientX - rect.left - size / 2}px`;
      ink.style.top = `${e.clientY - rect.top - size / 2}px`;
      host.appendChild(ink);
      setTimeout(() => ink.remove(), 600);
    },
  };
}
