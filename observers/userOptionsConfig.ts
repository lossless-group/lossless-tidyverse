/**
 * USER_OPTIONS: Directory-specific configuration for templates and services.
 * Each entry specifies which template and services to use for a directory.
 *
 * This is the single source of truth for directory/template/service/operation config.
 *
 * Aggressively commented for clarity and maintainability.
 */

export interface OperationStep {
  op: string;
  delayMs?: number;
}

export interface ImageKitConfig {
  enabled: boolean;
  uploadFolder?: string; // The folder path in ImageKit where screenshots should be uploaded (e.g., '/uploads/lossless/screenshots')
  overwriteScreenshotUrl: boolean;
  processExistingFilesOnStart?: boolean; // Whether to process all existing files when the observer starts
  batchSize?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  logging?: boolean | {
    debug?: boolean;
    info?: boolean;
    error?: boolean;
  };
}

export interface DirectoryConfig {
  path: string; // Relative to content root
  template: string; // Template ID
  services: {
    openGraph: boolean;
    citations: boolean;
    imageKit?: ImageKitConfig; // Configuration for ImageKit screenshot processing
    reorderYamlToTemplate?: boolean; // If true, output YAML will be reordered to match template property order
    addSiteUUID?: boolean; // Controls addSiteUUID handler ON/OFF
    logging?: {
      extractedFrontmatter?: boolean;
      addSiteUUID?: boolean;
      openGraph?: boolean;
      imageKit?: boolean;
    };
  };
  operationSequence?: OperationStep[];
}

export interface UserOptions {
  directories: DirectoryConfig[];
  // Add more global options as needed
  AUTO_ADD_MISSING_FRONTMATTER_FIELDS?: boolean; // If true, observer scripts may auto-add missing/empty frontmatter fields with defaults.
  
  /**
   * Critical files that should always be processed regardless of tracking status.
   * These files will bypass the processed files check and always be processed on each run.
   * Useful for files that need to be consistently monitored or that serve as triggers for other processes.
   * File names should be specified without paths (e.g., "example.md").
   */
  criticalFiles?: string[];
}

export const USER_OPTIONS: UserOptions = {
  AUTO_ADD_MISSING_FRONTMATTER_FIELDS: true, // Explicitly added global setting
  directories: [
    // CRITICAL: Place the most specific config blocks first to avoid shadowing by general blocks.
    // The 'content/essays' block MUST come before any block that matches 'content' or a parent directory.
    {
      path: 'essays',
      template: 'essays',
      services: {
        addSiteUUID: true,
        openGraph: false,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: true,
          openGraph: false
        }
      }
    },
    {
      path: 'tooling/Products',
      template: 'tooling', // matches a template id
      services: {
        openGraph: true,
        citations: false,
        imageKit: {
          enabled: true,
          uploadFolder: 'uploads/lossless/screenshots',
          overwriteScreenshotUrl: true,
          processExistingFilesOnStart: true,
          batchSize: 5,
          retryAttempts: 3,
          retryDelayMs: 1000
        },
        reorderYamlToTemplate: true, // If true, output YAML will be reordered to match template property order
        logging: {
          extractedFrontmatter: true,
          addSiteUUID: true,
          openGraph: true,
          imageKit: true
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
        { op: 'fetchOpenGraph', delayMs: 25 },
        { op: 'processScreenshots', delayMs: 25 },
        { op: 'validateFrontmatter', delayMs: 25 }
      ]
    },
    {
      path: 'vocabulary',
      template: 'vocabulary',
      services: {
        openGraph: false,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: true,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
      ]
    },
    {
      path: 'concepts',
      template: 'concepts',
      services: {
        openGraph: false,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: true,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
      ]
    },
    {
      path: 'lost-in-public/prompts',
      template: 'prompts',
      services: {
        openGraph: false,
        citations: false,
        addSiteUUID: true,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: true,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
      ]
    },
    {
      path: 'lost-in-public/reminders',
      template: 'reminders',
      services: {
        openGraph: false,
        citations: false,
        addSiteUUID: true,
        reorderYamlToTemplate: false,
        logging: {
          addSiteUUID: true,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
      ]
    },
    {
      path: 'lost-in-public/issue-resolution', // Path for the issue resolution collection
      template: 'issue-resolution', // Corresponds to the template ID
      services: {
        addSiteUUID: true, // Enable UUID generation
        openGraph: false, // Disable OpenGraph by default for this collection
        citations: false, // Disable citations by default
        reorderYamlToTemplate: true, // Reorder frontmatter to match template
        logging: {
          addSiteUUID: true,
          extractedFrontmatter: true,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
        { op: 'validateFrontmatter', delayMs: 25 } // Ensure frontmatter validation runs
      ]
    },
    {
      path: 'specs',
      template: 'specifications',
      services: {
        openGraph: false,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: false,
          openGraph: false
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
      ]
    }
  ],
  // ===================== GLOBAL OBSERVER SCRIPT OPTIONS =====================
  // Option: If true, observer scripts may auto-add missing/empty frontmatter fields with defaults.
  // If false (default), scripts only report missing/empty fields and DO NOT modify files.
  
};
