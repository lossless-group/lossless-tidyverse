/**
 * Type definitions for the metadata template system
 * 
 * These types define the structure of templates used to validate and generate
 * frontmatter for markdown files in the content directory.
 */

/**
 * Represents a field in a metadata template with type, validation, and default value
 */
export interface TemplateField {
  type: 'string' | 'date' | 'array' | 'boolean' | 'number';
  description: string;
  validation?: (value: any) => boolean;
  defaultValue?: any;
  defaultValueFn?: (filePath: string) => any;
}

/**
 * Represents a complete metadata template definition
 * Used to validate and generate frontmatter for markdown files
 */
export interface MetadataTemplate {
  // Core template definition
  id: string;
  name: string;
  description: string;
  
  // Matching rules to determine which files this template applies to
  appliesTo: {
    collections?: string[];      // Astro collection names
    directories?: string[];      // Directory glob patterns
    filePatterns?: string[];     // File name patterns
  };
  
  // Required fields that must be present in frontmatter
  required: {
    [key: string]: TemplateField;
  };
  
  // Optional fields that may be present in frontmatter
  optional: {
    [key: string]: TemplateField;
  };

  // Citation configuration for citation processing
  citationConfig?: {
    registryPath: string;
    hexLength: number;
    footnotesSectionHeader: string;
    footnotesSectionSeparator: string;
    [key: string]: any;
  };

  // Content processing capability
  contentProcessing?: {
    enabled: boolean;
    processor: (content: string, filePath: string) => Promise<{
      updatedContent: string;
      changed: boolean;
      stats?: Record<string, any>;
    }>;
  };
}

/**
 * Result of validating frontmatter against a template
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  suggestedFixes?: {[key: string]: any};
}

/**
 * Represents a validation error for a specific field
 */
export interface ValidationError {
  field: string;
  message: string;
  value?: any;
  expected?: string;
}

/**
 * Represents a validation warning for a specific field
 */
export interface ValidationWarning {
  field: string;
  message: string;
  value?: any;
  suggestion?: any;
}
