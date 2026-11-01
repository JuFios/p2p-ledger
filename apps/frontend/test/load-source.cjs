const { readFileSync, existsSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const { createRequire } = require('node:module');
const { compileFunction } = require('node:vm');
const ts = require('typescript');

const root = resolve(__dirname, '..');

// Виконуємо поточні TS/TSX з реальним React, підміняючи лише зовнішні залежності.
function loadSource(path, mocks = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = { exports: {} };
    cache.set(filename, loaded);
    const originalRequire = createRequire(filename);
    const localRequire = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/')
          ? resolve(root, name.slice(2))
          : resolve(dirname(filename), name);
        const source = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
        if (source) return load(source);
      }
      return originalRequire(name);
    };
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    compileFunction(
      outputText,
      ['exports', 'require', 'module', '__filename', '__dirname'],
      {
        filename,
      },
    )(loaded.exports, localRequire, loaded, filename, dirname(filename));
    return loaded.exports;
  }
  return load(resolve(root, path));
}

module.exports = { loadSource };
