/** @type {import("prettier").Config} */
const config = {
  useTabs: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  semi: true,
  plugins: ['prettier-plugin-svelte', '@trivago/prettier-plugin-sort-imports'],
  overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }],
  importOrder: [
    '^\\$app/(.*)$',
    '^\\$env/(.*)$',
    '^\\$lib/(.*)$',
    '^\\$api/(.*)$',
    '^\\$panel/(.*)$',
    '^\\$components/(.*)$',
    '^\\$styles/(.*)$',
    '^[./]',
  ],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  importOrderParserPlugins: ['typescript', 'decorators-legacy'],
};

export default config;
