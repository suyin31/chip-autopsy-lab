import { describe, expect, it } from 'vitest';
import { ingestDemoPreset } from '@/workers';
import {
  buildAutopsyLiveAnnouncement,
  buildWorkspaceSelectionAnnouncement,
  type WorkspaceSelectionSnapshot,
} from './a11y-announcements';

describe('a11y-announcements (Task 19, Req 14.4)', () => {
  it('composes Autopsy Report live announcements for verdict, claim, and narration status transitions', () => {
    expect(
      buildAutopsyLiveAnnouncement({
        fullHeadline: 'Cause of death: Edge-Ring failure.',
        activeClaimText: null,
        narrationStatusText: null,
      }),
    ).toBe('Cause of death: Edge-Ring failure.');

    expect(
      buildAutopsyLiveAnnouncement({
        fullHeadline: 'Cause of death: Edge-Ring failure.',
        activeClaimText: 'Outer 3 rings drive 93.8% of failures (2,552 dies)',
        narrationStatusText: null,
      }),
    ).toBe('Outer 3 rings drive 93.8% of failures (2,552 dies)');

    expect(
      buildAutopsyLiveAnnouncement({
        fullHeadline: 'Cause of death: Edge-Ring failure.',
        activeClaimText: null,
        narrationStatusText: 'AI summary verified against cited engine facts.',
      }),
    ).toBe(
      'Cause of death: Edge-Ring failure. AI summary verified against cited engine facts.',
    );

    expect(
      buildAutopsyLiveAnnouncement({
        fullHeadline: 'Cause of death: Edge-Ring failure.',
        activeClaimText: 'Outer 3 rings drive 93.8% of failures (2,552 dies)',
        narrationStatusText: 'Showing built-in template summary.',
      }),
    ).toBe(
      'Outer 3 rings drive 93.8% of failures (2,552 dies) Showing built-in template summary.',
    );
  });

  it('announces filter updates, filter clears, pinned dies, and wafer switches', async () => {
    const res = await ingestDemoPreset('edge-ring-etch');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;

    const initial: WorkspaceSelectionSnapshot = {
      hasActiveFilter: false,
      selectedDieCount: res.lot.dies.count,
      activeWaferIndex: 0,
      pinnedDieIndex: null,
    };

    // Initial mount emits nothing so parse-complete announcement is not overwritten
    expect(
      buildWorkspaceSelectionAnnouncement({
        lot: res.lot,
        byWaferYield: res.yieldSummary.byWafer,
        locale: 'en',
        prev: null,
        next: initial,
      }),
    ).toBeNull();

    // Filter applied
    const filtered: WorkspaceSelectionSnapshot = {
      ...initial,
      hasActiveFilter: true,
      selectedDieCount: 148,
    };
    expect(
      buildWorkspaceSelectionAnnouncement({
        lot: res.lot,
        byWaferYield: res.yieldSummary.byWafer,
        locale: 'en',
        prev: initial,
        next: filtered,
      }),
    ).toBe('Filter updated: 148 dies selected.');

    // Filter count updated while active
    const narrowed: WorkspaceSelectionSnapshot = {
      ...filtered,
      selectedDieCount: 42,
    };
    expect(
      buildWorkspaceSelectionAnnouncement({
        lot: res.lot,
        byWaferYield: res.yieldSummary.byWafer,
        locale: 'en',
        prev: filtered,
        next: narrowed,
      }),
    ).toBe('Filter updated: 42 dies selected.');

    // Filter cleared
    expect(
      buildWorkspaceSelectionAnnouncement({
        lot: res.lot,
        byWaferYield: res.yieldSummary.byWafer,
        locale: 'en',
        prev: narrowed,
        next: initial,
      }),
    ).toContain('Filters cleared. Showing all');

    // Pinned die
    let failIdx = 0;
    for (let i = 0; i < res.lot.dies.count; i += 1) {
      if (res.lot.dies.finalPass[i] === 0 && res.lot.dies.x[i]! < 0) {
        failIdx = i;
        break;
      }
    }
    const pinned: WorkspaceSelectionSnapshot = {
      ...initial,
      pinnedDieIndex: failIdx,
    };
    const pinAnnouncement = buildWorkspaceSelectionAnnouncement({
      lot: res.lot,
      byWaferYield: res.yieldSummary.byWafer,
      locale: 'en',
      prev: initial,
      next: pinned,
    });
    expect(pinAnnouncement).toContain('Die at X \u2212');
    expect(pinAnnouncement).toContain('Failed');
    expect(pinAnnouncement).toContain('SBIN');

    // Wafer switch
    const switched: WorkspaceSelectionSnapshot = {
      ...initial,
      activeWaferIndex: 1,
    };
    const waferAnnouncement = buildWorkspaceSelectionAnnouncement({
      lot: res.lot,
      byWaferYield: res.yieldSummary.byWafer,
      locale: 'en',
      prev: initial,
      next: switched,
    });
    expect(waferAnnouncement).toContain(`Wafer ${res.lot.wafers[1]!.waferId}`);
    expect(waferAnnouncement).toContain('tested');
    expect(waferAnnouncement).toContain('failed');
  });
});
