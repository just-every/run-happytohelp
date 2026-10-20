// Base owns preparation, published-vector reuse and the site Worker.
export default {
  type: 'docs-search', module: 'docs-search', bindings: ['ASSETS', 'AI'],
  endpoint: '/docs/search', corpus: '.rer/docs-search/corpus.json',
};
