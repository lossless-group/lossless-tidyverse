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

export interface DirectoryConfig {
  path: string; // Relative to content root
  template: string; // Template ID
  services: {
    openGraph: boolean;
    citations: boolean;
    reorderYamlToTemplate?: boolean; // If true, output YAML will be reordered to match template property order
    addSiteUUID?: boolean; // Controls addSiteUUID handler ON/OFF
    logging?: {
      extractedFrontmatter?: boolean;
      addSiteUUID?: boolean;
      openGraph?: boolean;
    };
  };
  operationSequence?: OperationStep[];
}

export interface UserOptions {
  directories: DirectoryConfig[];
  // Add more global options as needed
}

export const USER_OPTIONS: UserOptions = {
  directories: [
    {
      path: 'tooling/Enterprise Jobs-to-be-Done',
      template: 'tooling', // matches a template id
      services: {
        openGraph: true,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          extractedFrontmatter: true,
          addSiteUUID: true,
          openGraph: true
        }
      },
      operationSequence: [
        { op: 'addSiteUUID', delayMs: 25 },
        { op: 'fetchOpenGraph', delayMs: 25 },
        { op: 'validateFrontmatter', delayMs: 25 }
      ]
    },
    {
      path: 'vocabulary',
      template: 'vocabulary',
      services: {
        openGraph: false,
        citations: true,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: false,
          openGraph: false
        }
      }
    },
    {
      path: 'lost-in-public/prompts',
      template: 'prompts',
      services: {
        openGraph: false,
        citations: false,
        reorderYamlToTemplate: false, // If true, output YAML will be reordered to match template property order
        logging: {
          addSiteUUID: false,
          openGraph: false
        }
      }
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
      }
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
      }
    }
    // Add more directory configs as needed
  ]
  // Add more global options as needed
};
