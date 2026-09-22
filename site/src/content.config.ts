import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const schema = z.object({
  title: z.string(),
  description: z.string(),
  order: z.number().default(0),
  section: z.string().default('General'),
  track: z.enum(['guide', 'reference']).default('guide'),
});

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema,
});

const docsId = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs-id' }),
  schema,
});

export const collections = { docs, 'docs-id': docsId };
