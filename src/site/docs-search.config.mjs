import declaration from '../../deploy-site.json' with { type: 'json' };
export default {
  corpus: '.rer/docs-search/corpus.json', assets: '.rer/site', output: '.rer/docs-search',
  endpoint: '/docs/search', previousUrl: `https://${declaration.domain}/docs-search-vectors.json`,
};
