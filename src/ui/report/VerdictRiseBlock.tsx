'use client';

import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from 'motion/react';
import * as React from 'react';
import { MOTION_TOKENS, SPRING_TOKENS } from '@/ui/tokens';
import type { VerdictRiseStepSpec } from '@/ui/wafer-map/probe-sweep';

export interface VerdictRiseBlockProps {
  readonly step: VerdictRiseStepSpec;
  /** True from ignite start (premium §8.2 trigger); false holds the block at its start state. */
  readonly revealed: boolean;
  /** Input in the verdict column finished the reveal: the block shows its final state at once. */
  readonly completed: boolean;
  readonly reduced: boolean;
  /** The reveal plays once per key (the lot), so switching wafers never replays it. */
  readonly replayKey: string;
  readonly className?: string;
  readonly children?: React.ReactNode;
}

/**
 * One block of the verdict rise-in (premium §8.2): `opacity 0 -> 1` and `translateY(12px -> 0)` on
 * `spring-ui` after its stagger delay, no blur. Motion values are driven imperatively, so an
 * interrupt jumps to the final state from wherever the block is. Reduced motion: opacity 0 -> 1 in
 * 120 ms, every block together.
 */
export function VerdictRiseBlock({
  step,
  revealed,
  completed,
  reduced,
  replayKey,
  className,
  children,
}: VerdictRiseBlockProps): React.JSX.Element {
  const opacity = useMotionValue(0);
  const y = useMotionValue(step.initialY);
  const playedKeyRef = React.useRef<string | null>(null);
  const controlsRef = React.useRef<AnimationPlaybackControls[]>([]);

  const stopAll = React.useCallback((): boolean => {
    const running = controlsRef.current.length > 0;
    for (const controls of controlsRef.current) {
      controls.stop();
    }
    controlsRef.current = [];
    return running;
  }, []);

  React.useLayoutEffect(() => {
    if (!revealed) {
      stopAll();
      opacity.jump(0);
      y.jump(step.initialY);
      playedKeyRef.current = null;
      return;
    }
    if (completed) {
      stopAll();
      opacity.jump(1);
      y.jump(0);
      playedKeyRef.current = replayKey;
      return;
    }
    if (playedKeyRef.current === replayKey) {
      return;
    }
    playedKeyRef.current = replayKey;
    stopAll();
    opacity.jump(0);
    y.jump(step.initialY);

    const clear = (): void => {
      controlsRef.current = [];
    };
    if (reduced) {
      const fade = animate(opacity, 1, {
        duration: (step.durationMs ?? MOTION_TOKENS.dur1Ms) / 1000,
        ease: MOTION_TOKENS.easeOutTuple,
        onComplete: clear,
      });
      controlsRef.current = [fade];
      return;
    }
    const transition = {
      ...(step.spring ?? SPRING_TOKENS.ui),
      delay: step.delayMs / 1000,
    };
    controlsRef.current = [
      animate(opacity, 1, { ...transition, onComplete: clear }),
      animate(y, 0, transition),
    ];
  }, [revealed, completed, reduced, replayKey, step, opacity, y, stopAll]);

  // Unmount stops the rise; a strict-mode remount replays it
  React.useEffect(
    () => () => {
      if (stopAll()) {
        playedKeyRef.current = null;
      }
    },
    [stopAll],
  );

  return (
    <motion.div
      data-verdict-rise-block={step.id}
      data-rise-stagger-ms={step.delayMs}
      style={{ opacity, y }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
