/**
 * Static-hosting awareness.
 *
 * The GitHub Pages build (see .github/workflows/deploy-pages.yml) sets
 * VITE_STATIC_DEPLOY=1. There is no backend behind a static site, so Live AI
 * mode is reported as unavailable up front with an explanation instead of a
 * failed network request. Scripted and Mock modes run entirely in the browser
 * and are unaffected.
 */
export const STATIC_DEPLOY = import.meta.env.VITE_STATIC_DEPLOY === '1';

export const STATIC_DEPLOY_LIVE_AI_MESSAGE =
  'Live AI mode is not available on this hosted demo (there is no backend behind a static site). ' +
  'Clone the repository and run `npm run dev` with an API key to use it. ' +
  'Scripted and Mock modes work fully here.';
