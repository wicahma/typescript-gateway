import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tsgate.diama.dev',
  integrations: [sitemap()],
  compressHTML: true,
});