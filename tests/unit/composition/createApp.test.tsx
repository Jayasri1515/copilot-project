import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/composition/createApp';

describe('createApp', () => {
  it('constructs the presentation with runtime adapters without starting live requests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(createApp());

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
