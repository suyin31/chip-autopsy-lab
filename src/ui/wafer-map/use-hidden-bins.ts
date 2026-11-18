'use client';

import * as React from 'react';
import type { StoreApi } from 'zustand';
import type { LotModel } from '@/core/model';
import {
  areHiddenBinSetsEqual,
  EMPTY_HIDDEN_BINS,
  type SelectionStoreState,
} from '@/ui/state';

function resolveHiddenBins(
  store: StoreApi<SelectionStoreState>,
  lot: LotModel,
): ReadonlySet<number> {
  const state = store.getState();
  return state.lot === lot ? state.hiddenBins : EMPTY_HIDDEN_BINS;
}

/**
 * Tracks the Selection Store `hiddenBins` for `lot` in a ref and calls `onChange` when they
 * change, with no React render. Canvas layers use it to repaint imperatively when the legend
 * hides or shows a bin, so the stage never re-renders for a legend click.
 *
 * The ref is also refreshed on every render, so a render triggered by other props always
 * paints with the current value.
 */
export function useHiddenBinsRef(
  store: StoreApi<SelectionStoreState>,
  lot: LotModel,
  onChange: () => void,
): React.RefObject<ReadonlySet<number>> {
  const hiddenRef = React.useRef<ReadonlySet<number>>(
    resolveHiddenBins(store, lot),
  );
  hiddenRef.current = resolveHiddenBins(store, lot);

  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    return store.subscribe(() => {
      const next = resolveHiddenBins(store, lot);
      if (areHiddenBinSetsEqual(hiddenRef.current, next)) {
        return;
      }
      hiddenRef.current = next;
      onChangeRef.current();
    });
  }, [store, lot]);

  return hiddenRef;
}
