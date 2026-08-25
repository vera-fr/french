// @ts-check
import { defineConfig } from 'astro/config';

// BASE_PATH comes from the GitHub Pages workflow:
//   "/" for <user>.github.io, otherwise "/<repo>/".
// Locally it defaults to "/" (site lives at the domain root).
const basePath = process.env.BASE_PATH || '/';

export default defineConfig({
  base: basePath === '/' ? '/' : basePath,
  // Content + search-index + all internal links use trailing slashes,
  // so emit <dir>/index.html to match.
  trailingSlash: 'always'
});
