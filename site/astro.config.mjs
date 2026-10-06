// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';

// Old Indonesian doc URLs (/docs/id/*) moved to Starlight locale routing (/id/docs/*).
const idSlugs = [
  'getting-started',
  'architecture',
  'configuration',
  'core-routing',
  'resilience',
  'traffic-control',
  'payload',
  'observability',
  'operations',
  'identity-security',
  'features',
  'usage',
  'testing',
];
const redirects = Object.fromEntries(
  idSlugs.map((s) => [`/docs/id/${s}`, `/id/docs/${s}`]),
);

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
        // dark-first initial theme (tsgate design system)
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
          items: [
            'docs/getting-started',
            'docs/architecture',
            'docs/configuration',
            'docs/usage',
          ],
        },
        {
          label: 'Reference',
          items: [
            'docs/core-routing',
            'docs/resilience',
            'docs/traffic-control',
            'docs/payload',
            'docs/observability',
            'docs/operations',
            'docs/identity-security',
            'docs/features',
            'docs/testing',
          ],
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
