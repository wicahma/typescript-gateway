import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';

const MOVES = {
  'getting-started': 'guides',
  configuration: 'guides',
  usage: 'guides',
  architecture: 'deep-dive',
  'core-routing': 'deep-dive',
  resilience: 'deep-dive',
  'traffic-control': 'deep-dive',
  payload: 'deep-dive',
  observability: 'deep-dive',
  operations: 'deep-dive',
  'identity-security': 'deep-dive',
  features: 'deep-dive',
  'feature-pack': 'deep-dive',
  testing: 'reference',
};

const redirects = {};
for (const [slug, section] of Object.entries(MOVES)) {
  redirects[`/docs/${slug}`] = `/docs/${section}/${slug}`;
  redirects[`/id/docs/${slug}`] = `/id/docs/${section}/${slug}`;
  redirects[`/docs/id/${slug}`] = `/id/docs/${section}/${slug}`;
  redirects[`/docs/docs/${slug}`] = `/docs/${section}/${slug}`;
  redirects[`/docs/id/docs/${slug}`] = `/id/docs/${section}/${slug}`;
}

redirects['/docs/'] = '/docs/guides/';
redirects['/id/docs/'] = '/id/docs/guides/';
redirects['/id'] = '/id/docs/guides/';

const GUIDES = ['getting-started', 'configuration', 'usage'];
const DEEP_DIVE = [
  'architecture',
  'core-routing',
  'resilience',
  'traffic-control',
  'payload',
  'observability',
  'operations',
  'identity-security',
  'features',
  'feature-pack',
];
const REFERENCE = [
  'index',
  'entrypoints',
  'core',
  'pipeline',
  'plugins',
  'identity',
  'config',
  'types',
  'utils',
  'profiling',
  'monitoring',
  'observability',
  'admin',
  'testing',
];

export default defineConfig({
  site: 'https://tsgate.diama.dev',
  integrations: [
    sitemap(),
    starlight({
      title: 'TypeScript Gateway',
      description:
        "A simple gateway, it's all you need. Production-grade TypeScript HTTP API gateway with zero runtime dependencies.",
      logo: { src: './src/assets/logo.svg' },
      components: {
        ThemeProvider: './src/components/ThemeProvider.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/wicahma/typescript-gateway',
        },
      ],
      locales: {
        root: { label: 'English', lang: 'en' },
        id: { label: 'Bahasa Indonesia', lang: 'id' },
      },
      sidebar: [
        {
          label: 'Guides',
          translations: { id: 'Panduan' },
          items: GUIDES.map((s) => `docs/guides/${s}`),
        },
        {
          label: 'Deep Dive',
          translations: { id: 'Pendalaman' },
          items: DEEP_DIVE.map((s) => `docs/deep-dive/${s}`),
        },
        {
          label: 'Reference',
          translations: { id: 'Referensi' },
          items: REFERENCE.map((s) =>
            s === 'index' ? 'docs/reference' : `docs/reference/${s}`
          ),
        },
      ],
      customCss: ['./src/custom.css'],
      head: [
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'preconnect',
            href: 'https://fonts.gstatic.com',
            crossorigin: 'anonymous',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap',
          },
        },
      ],
    }),
  ],
  redirects,
  compressHTML: true,
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
