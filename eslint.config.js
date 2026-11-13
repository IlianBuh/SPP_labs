export default [{ ignores: ['node_modules/**', '.test-data/**'] }, {
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-constant-condition': ['error', { checkLoops: false }], 'no-unreachable': 'error' }
}];
