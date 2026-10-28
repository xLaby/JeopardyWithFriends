// Statische Pruefung fuer den Server-Code. Wichtigste Regel: no-undef faengt vergessene Funktionen ab,
// z. B. wenn ein Modul in lib/ eine Funktion aus einem anderen Modul aufruft, ohne sie einzubinden.
const node = { require: 'readonly', module: 'writable', process: 'readonly', __dirname: 'readonly', console: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', fetch: 'readonly', structuredClone: 'readonly' };
module.exports = [{
  files: ['server.js', 'lib/**/*.js', 'test/**/*.js'],
  languageOptions: { sourceType: 'commonjs', ecmaVersion: 2022, globals: node },
  rules: { 'no-undef': 'error', 'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }] }
}];
