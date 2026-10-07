// 细节查看的键盘交互纯函数 reducer（无 DOM 依赖，便于验收测试）。
// Tab：在标注热点间自然聚焦；Enter/Space：打开细节；Esc：关闭；
// ←/→：上一个/下一个标注；Home/End：首/尾。
export const ACTIONS = ['open', 'close', 'next', 'prev', 'first', 'last'];

export function keyToAction(key, { open = false } = {}) {
  switch (key) {
    case 'Enter':
    case ' ':
    case 'Spacebar':
      return 'open';
    case 'Escape':
      return open ? 'close' : null;
    case 'ArrowRight':
      return open ? 'next' : null;
    case 'ArrowDown':
      return open ? 'next' : null;
    case 'ArrowLeft':
      return open ? 'prev' : null;
    case 'ArrowUp':
      return open ? 'prev' : null;
    case 'Home':
      return open ? 'first' : null;
    case 'End':
      return open ? 'last' : null;
    default:
      return null;
  }
}

export function detailReducer(state, action, count = 0) {
  switch (action) {
    case 'open':
      return { open: true, index: state.index ?? 0 };
    case 'close':
      return { open: false, index: state.index ?? 0 };
    case 'next':
      if (!count) return state;
      return { open: true, index: ((state.index ?? 0) + 1) % count };
    case 'prev':
      if (!count) return state;
      return { open: true, index: (((state.index ?? 0) - 1) + count) % count };
    case 'first':
      return { open: true, index: 0 };
    case 'last':
      return { open: true, index: Math.max(0, count - 1) };
    default:
      return state;
  }
}
