// Dependency-free checks: node scripts/test-load-screen.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const gate = fs.readFileSync(path.join(root, 'js/load-screen-gate.js'), 'utf8');
const loader = fs.readFileSync(path.join(root, 'js/load-screen.js'), 'utf8');

function runGate(internal, draws, blockedStorage = false) {
  const classes = new Set();
  const document = {documentElement: {dataset: {}, classList: classes}};
  const storage = new Map(internal ? [['attp-internal-navigation', '1']] : []);
  const window = {};
  let calls = 0;
  vm.runInNewContext(gate, {
    document, window,
    Math: {random: () => { assert.ok(calls < draws.length); return draws[calls++]; }},
    sessionStorage: {
      getItem(key) { if (blockedStorage) throw Error('Unavailable'); return storage.get(key); },
      removeItem: key => storage.delete(key),
    },
  });
  assert.equal(storage.size, 0);
  assert.equal(classes.has('show-load-screen'), window.__attpShowLoadScreen);
  assert.equal(calls, draws.length);
  return {show: window.__attpShowLoadScreen, sport: document.documentElement.dataset.loadSport};
}

assert.deepEqual(runGate(false, [0]), {show: true, sport: 'pingpong'});
assert.deepEqual(runGate(false, [0.5]), {show: true, sport: 'basketball'});
assert.deepEqual(runGate(true, [0.1]), {show: false, sport: undefined});
assert.deepEqual(runGate(true, [0.099, 0.499]), {show: true, sport: 'pingpong'});
assert.deepEqual(runGate(true, [0.099, 0.5]), {show: true, sport: 'basketball'});
assert.deepEqual(runGate(false, [0.9], true), {show: true, sport: 'basketball'});

// Sweep independent, evenly spaced appearance and sport draws: 90% no intro,
// 5% ping pong and 5% basketball, without flaky statistical tolerances.
const totals = {none: 0, pingpong: 0, basketball: 0};
for (let appearance = 0; appearance < 100; appearance++) {
  for (const sport of [0.25, 0.75]) {
    const draws = appearance < 10 ? [appearance / 100, sport] : [appearance / 100];
    const result = runGate(true, draws);
    totals[result.sport || 'none']++;
  }
}
assert.deepEqual(totals, {none: 180, pingpong: 10, basketball: 10});

// Language routes and subdirectory deployments must share the same site root.
for (const prefix of ['/', '/attp/']) {
  const location = new URL(`https://example.test${prefix}ru/about.html`);
  let handler;
  const storage = new Map();
  class Element {
    constructor(href) { this.href = href; this.target = ''; }
    closest() { return this; }
    hasAttribute() { return false; }
  }
  vm.runInNewContext(loader, {
    URL, Element, location,
    document: {
      currentScript: {src: `https://example.test${prefix}js/load-screen.js?v=test`},
      addEventListener: (type, fn) => { if (type === 'click') handler = fn; },
      getElementById: () => null,
    },
    sessionStorage: {setItem: (key, value) => storage.set(key, value)},
  });
  const click = (href, extra = {}) => {
    storage.clear();
    handler({button: 0, target: new Element(href), ...extra});
    return storage.get('attp-internal-navigation') === '1';
  };
  assert.ok(click(`https://example.test${prefix}en/about.html`));
  assert.ok(click(`https://example.test${prefix}index.html`));
  assert.ok(click(`https://example.test${prefix}ru/gallery.html`));
  assert.ok(!click(location.href + '#team'));
  assert.ok(!click('https://elsewhere.test/index.html'));
  assert.ok(!click(`https://example.test${prefix}index.html`, {ctrlKey: true}));
  assert.ok(!click(`https://example.test${prefix}images/photo.jpg`));
}
console.log('PASS: entry, 10% gate, independent 50/50 draw, storage fallback, language navigation.');
