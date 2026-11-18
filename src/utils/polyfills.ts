// Compatibilidad para tablets con navegadores o WebViews más antiguos
// Se carga antes que cualquier dependencia de React o gráficos.

if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: function hasOwn(target: object, key: PropertyKey): boolean {
      if (target == null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.prototype.hasOwnProperty.call(Object(target), key);
    },
    configurable: true,
    writable: true,
  });
}

if (typeof Array.prototype.at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at<T>(this: T[], index: number): T | undefined {
      const len = this.length >>> 0;
      const n = Math.trunc(index) || 0;
      const k = n >= 0 ? n : len + n;
      if (k < 0 || k >= len) return undefined;
      return this[k];
    },
    configurable: true,
    writable: true,
  });
}

if (typeof String.prototype.at !== 'function') {
  Object.defineProperty(String.prototype, 'at', {
    value: function at(this: string, index: number): string | undefined {
      const s = String(this);
      const len = s.length;
      const n = Math.trunc(index) || 0;
      const k = n >= 0 ? n : len + n;
      if (k < 0 || k >= len) return undefined;
      return s.charAt(k);
    },
    configurable: true,
    writable: true,
  });
}

if (typeof String.prototype.replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value: function replaceAll(
      this: string,
      searchValue: string | RegExp,
      replaceValue: string
    ): string {
      const str = String(this);
      if (searchValue instanceof RegExp) {
        if (!searchValue.global) {
          throw new TypeError('replaceAll must be called with a global RegExp');
        }
        return str.replace(searchValue, replaceValue);
      }
      return str.split(String(searchValue)).join(String(replaceValue));
    },
    configurable: true,
    writable: true,
  });
}
