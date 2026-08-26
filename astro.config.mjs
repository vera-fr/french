// @ts-check
import { defineConfig } from 'astro/config';

const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath,
  trailingSlash: 'always',
});
