const path = require('path');

// =============================================================================
// Centralized Path Constants
// =============================================================================
// Define absolute paths relative to the monorepo root to ensure scripts
// work correctly regardless of where they are executed from.
// DO NOT USE __dirname or process.cwd() for paths outside the script's directory.
// -----------------------------------------------------------------------------

/**
 * The absolute path to the root of the lossless-monorepo.
 * IMPORTANT: This assumes the script is run from within the monorepo structure.
 * Adjust if the execution context changes significantly, though ideally it shouldn't.
 */
const MONOREPO_ROOT = path.resolve(__dirname, '../../../'); // Assumes utils is 3 levels down from monorepo root

/**
 * Absolute path to the 'content' directory.
 * All content files (markdown, data, reports) reside within this directory.
 */
const CONTENT_ROOT = path.join(MONOREPO_ROOT, 'content');

/**
 * Absolute path to the 'content/reports' directory.
 * All generated script reports MUST be saved here.
 */
const REPORTS_DIR = path.join(CONTENT_ROOT, 'reports');

/**
 * Absolute path to the 'content/tooling' directory.
 * Primary target directory for many content processing scripts.
 */
const CONTENT_TOOLING_DIR = path.join(CONTENT_ROOT, 'tooling');

/**
 * Absolute path to the 'site/src/assets' directory.
 * Location for static assets like images, SVGs, etc., used by the Astro site.
 */
const ASSETS_SRC_DIR = path.join(MONOREPO_ROOT, 'site/src/assets');

/**
 * Absolute path to the 'site/' directory.
 * Root directory for the Astro project.
 */
const SITE_ROOT = path.join(MONOREPO_ROOT, 'site');

// =============================================================================
// Exports
// =============================================================================
module.exports = {
  MONOREPO_ROOT,
  CONTENT_ROOT,
  REPORTS_DIR,
  CONTENT_TOOLING_DIR,
  ASSETS_SRC_DIR,
  SITE_ROOT
};
