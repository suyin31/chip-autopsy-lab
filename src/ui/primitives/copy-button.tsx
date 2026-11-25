'use client';

import * as React from 'react';
import { Button } from './button';
import { AnimatedCheckmark } from './checkmark';
import { StatusSwap } from './status-swap';

type CopyState = 'idle' | 'manual' | 'copied' | 'failed';
type CopyEvent = 'reset' | 'select' | 'success' | 'failure' | 'expire';

export function reduceCopyState(state: CopyState, event: CopyEvent): CopyState {
  switch (event) {
    case 'select': return 'manual';
    case 'success': return 'copied';
    case 'failure': return 'failed';
    case 'expire': return state === 'copied' ? 'idle' : state;
    case 'reset': return 'idle';
  }
}

export function CopyButton({ value, label, copiedLabel, className, 'data-testid': testId }: {
  readonly value: string;
  readonly label: string;
  readonly copiedLabel: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}): React.JSX.Element {
  const [state, dispatch] = React.useReducer(reduceCopyState, 'idle');
  const generation = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const button = React.useRef<HTMLButtonElement>(null);

  React.useLayoutEffect(() => {
    dispatch('reset');
    return () => {
      generation.current++;
      clearTimeout(timer.current);
    };
  }, [value]);

  React.useLayoutEffect(() => {
    if (state === 'manual') {
      textarea.current?.focus();
      textarea.current?.select();
    }
  }, [state]);

  function confirmCopy(): void {
    dispatch('success');
    timer.current = setTimeout(() => dispatch('expire'), 1600);
  }

  async function copy(): Promise<void> {
    const request = ++generation.current;
    clearTimeout(timer.current);
    if (!navigator.clipboard?.writeText) {
      dispatch('select');
      textarea.current?.focus();
      textarea.current?.select();
      return;
    }
    dispatch('reset');
    try {
      await navigator.clipboard.writeText(value);
      if (request === generation.current) confirmCopy();
    } catch {
      if (request === generation.current) dispatch('failure');
    }
  }

  const copied = state === 'copied';
  return (
    <>
      <Button ref={button} variant="text" size="sm" className={className} data-testid={testId} onClick={copy}>
        <StatusSwap
          value={copied ? 'copied' : 'idle'}
          states={{
            idle: label,
            copied: (
              <>
                <AnimatedCheckmark animate={copied} />
                {copiedLabel}
              </>
            ),
          }}
        />
      </Button>
      {state === 'manual' && (
        <label className="block">Copy the selected text using your device’s copy command.
          <textarea ref={textarea} readOnly value={value} onCopy={event => {
            if (!event.nativeEvent.isTrusted) return;
            event.clipboardData.setData('text/plain', value);
            event.preventDefault();
            button.current?.focus();
            confirmCopy();
          }} />
        </label>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? copiedLabel : state === 'failed' ? 'Copy failed. Try again.' : ''}
      </span>
    </>
  );
}
