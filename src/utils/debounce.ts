export function debounce<T extends (...args: Parameters<T>) => void>(fn: T, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => timer && clearTimeout(timer);
  debounced.flush = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    fn(...args);
  };
  return debounced;
}
