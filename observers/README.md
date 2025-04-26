# Frontmatter Observer

A filesystem observer that monitors Markdown files in the content directory and ensures consistent frontmatter based on templates.

## Overview

This tool watches the `content/tooling` directory for new or modified Markdown files and:

1. Adds appropriate frontmatter to new files based on templates
2. Validates existing frontmatter against templates
3. Reports validation errors and suggests fixes

## Architecture

The system is built with these key components:

### Template System

- `MetadataTemplate` - Defines the structure of frontmatter for different types of files
- `TemplateRegistry` - Manages templates and provides methods to find, validate, and apply templates
- Template definitions (e.g., `tooling.ts`) - Define specific templates for different directories

### Filesystem Observer

- Uses `chokidar` to watch for file changes
- Processes new and modified files
- Extracts and validates frontmatter
- Inserts frontmatter when needed

## Usage

```bash
# Install dependencies
pnpm install

# Start the observer
pnpm start
```

## Template Structure

Templates define the expected frontmatter structure:

```typescript
const template: MetadataTemplate = {
  id: 'template-id',
  name: 'Template Name',
  description: 'Template description',
  
  // Define which files this template applies to
  appliesTo: {
    directories: ['content/directory/**/*'],
  },
  
  // Required fields
  required: {
    title: {
      type: 'string',
      description: 'Title field',
      validation: (value) => typeof value === 'string' && value.length > 0
    },
    // More required fields...
  },
  
  // Optional fields
  optional: {
    url: {
      type: 'string',
      description: 'URL field',
      validation: (value) => typeof value === 'string' && value.startsWith('http')
    },
    // More optional fields...
  }
};
```

## Adding New Templates

To add a new template:

1. Create a new template file in the `templates` directory
2. Define the template structure
3. Import and register the template in `templateRegistry.ts`

## Future Enhancements

- Support for more content directories
- Interactive fixing of validation errors
- Integration with build process
- Path resolution for backlinks
- Content indexing service
