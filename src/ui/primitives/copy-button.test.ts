import { expect, it } from 'vitest';
import { reduceCopyState } from './copy-button';

it('waits for manual copy confirmation before showing success, then resets', () => {
  const selected = reduceCopyState('idle', 'select');
  expect(selected).toBe('manual');
  expect(reduceCopyState(selected, 'expire')).toBe('manual');
  const confirmed = reduceCopyState(selected, 'success');
  expect(confirmed).toBe('copied');
  expect(reduceCopyState(confirmed, 'expire')).toBe('idle');
});

it('allows retry after a rejected clipboard write', () => {
  const failed = reduceCopyState('idle', 'failure');
  expect(failed).toBe('failed');
  expect(reduceCopyState(failed, 'success')).toBe('copied');
});
