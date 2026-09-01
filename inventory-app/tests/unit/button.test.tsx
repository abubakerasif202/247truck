import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders accessible button content', () => {
    render(<Button>Receive stock</Button>);

    expect(screen.getByRole('button', { name: 'Receive stock' })).toBeInTheDocument();
  });
});
