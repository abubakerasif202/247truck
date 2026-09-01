---
name: 247truck-conventions
description: Development conventions and patterns for 247truck. TypeScript project with conventional commits.
---

# 247truck Conventions

> Generated from [abubakerasif202/247truck](https://github.com/abubakerasif202/247truck) on 2026-09-01

## Overview

This skill teaches Claude the development patterns and conventions used in 247truck.

## Tech Stack

- **Primary Language**: TypeScript
- **Architecture**: hybrid module organization
- **Test Location**: mixed
- **Test Framework**: vitest

## When to Use This Skill

Activate this skill when:
- Making changes to this repository
- Adding new features following established patterns
- Writing tests that match project conventions
- Creating commits with proper message format

## Commit Conventions

Follow these commit message conventions based on 9 analyzed commits.

### Commit Style: Conventional Commits

### Prefixes Used

- `feat`
- `test`
- `fix`

### Message Guidelines

- Average message length: ~55 characters
- Keep first line concise and descriptive
- Use imperative mood ("Add feature" not "Added feature")


*Commit message example*

```text
feat(inventory): scaffold standalone app
```

*Commit message example*

```text
test(inventory): verify phase 1 security and deployment
```

*Commit message example*

```text
fix(inventory): harden cost access and idempotency
```

*Commit message example*

```text
feat(inventory): add roles locations permissions and audit
```

*Commit message example*

```text
feat(inventory): add login access context and manager invitations
```

*Commit message example*

```text
feat(inventory): add responsive desktop and mobile shell
```

*Commit message example*

```text
feat(inventory): add product and tyre catalogue
```

*Commit message example*

```text
feat(inventory): add atomic stock ledger and weighted cost
```

## Architecture

### Project Structure: Single Package

This project uses **hybrid** module organization.

### Configuration Files

- `.github/workflows/inventory.yml`
- `inventory-app/next.config.ts`
- `inventory-app/package.json`
- `inventory-app/playwright.config.ts`
- `inventory-app/tsconfig.json`
- `inventory-app/vitest.config.ts`
- `tsconfig.json`

### Guidelines

- This project uses a hybrid organization
- Follow existing patterns when adding new code

## Code Style

### Language: TypeScript

### Naming Conventions

| Element | Convention |
|---------|------------|
| Files | camelCase |
| Functions | camelCase |
| Classes | PascalCase |
| Constants | SCREAMING_SNAKE_CASE |

### Import Style: Path Aliases (@/, ~/)

### Export Style: Default Exports


*Preferred import style*

```typescript
// Use path aliases for imports
import { Button } from '@/components/Button'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
```

*Preferred export style*

```typescript
// Use default exports for main component/function
export default function UserProfile() { ... }
```

## Testing

### Test Framework: vitest

### File Pattern: `*.test.ts`

### Test Types

- **Unit tests**: Test individual functions and components in isolation
- **Integration tests**: Test interactions between multiple components/services
- **E2e tests**: Test complete user flows through the application


*Test file structure*

```typescript
import { describe, it, expect } from 'vitest'

describe('MyFunction', () => {
  it('should return expected result', () => {
    const result = myFunction(input)
    expect(result).toBe(expected)
  })
})
```

## Error Handling

### Error Handling Style: Try-Catch Blocks


*Standard error handling pattern*

```typescript
try {
  const result = await riskyOperation()
  return result
} catch (error) {
  console.error('Operation failed:', error)
  throw new Error('User-friendly message')
}
```

## Common Workflows

These workflows were detected from analyzing commit patterns.

### Database Migration

Database schema changes with migration files

**Frequency**: ~20 times per month

**Steps**:
1. Create migration file
2. Update schema definitions
3. Generate/update types

**Files typically involved**:
- `**/types.ts`
- `migrations/*`

**Example commit sequence**:
```
feat(inventory): add roles locations permissions and audit
feat(inventory): add login access context and manager invitations
feat(inventory): add responsive desktop and mobile shell
```

### Feature Development

Standard feature implementation workflow

**Frequency**: ~23 times per month

**Steps**:
1. Add feature implementation
2. Add tests for feature
3. Update documentation

**Files typically involved**:
- `inventory-app/app/*`
- `inventory-app/*`
- `inventory-app/components/ui/*`
- `**/*.test.*`
- `**/api/**`

**Example commit sequence**:
```
feat(inventory): scaffold standalone app
feat(inventory): add roles locations permissions and audit
feat(inventory): add login access context and manager invitations
```


## Best Practices

Based on analysis of the codebase, follow these practices:

### Do

- Use conventional commit format (feat:, fix:, etc.)
- Write tests using vitest
- Follow *.test.ts naming pattern
- Use camelCase for file names
- Prefer default exports

### Don't

- Don't use long relative imports (use aliases)
- Don't write vague commit messages
- Don't skip tests for new features
- Don't deviate from established patterns without discussion

---

*This skill was auto-generated by [ECC Tools](https://ecc.tools). Review and customize as needed for your team.*
