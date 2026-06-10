import { describe, it, expect } from 'vitest';
import { buildManagedLaunchArgs } from './launchArgs.js';

describe('buildManagedLaunchArgs', () => {
  it('omits -shareArchive on a solo launch so the patcher can write updates', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-1',
      useAutologin: true,
      isMultiInstance: false,
      userExtras: [],
    });
    expect(args).toEqual(['-mumble', 'acct-1', '-autologin']);
    expect(args).not.toContain('-shareArchive');
  });

  it('adds -shareArchive only when another instance is already running', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-1',
      useAutologin: true,
      isMultiInstance: true,
      userExtras: [],
    });
    expect(args).toEqual(['-mumble', 'acct-1', '-autologin', '-shareArchive']);
  });

  it('omits -autologin when there is no saved login', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-2',
      useAutologin: false,
      isMultiInstance: false,
      userExtras: [],
    });
    expect(args).toEqual(['-mumble', 'acct-2']);
  });

  it('does not duplicate -shareArchive when the user already supplied it', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-1',
      useAutologin: false,
      isMultiInstance: true,
      userExtras: ['-shareArchive'],
    });
    expect(args.filter((a) => a.toLowerCase() === '-sharearchive')).toHaveLength(1);
  });

  it('honors a user-supplied -shareArchive even on a solo launch', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-1',
      useAutologin: false,
      isMultiInstance: false,
      userExtras: ['-shareArchive'],
    });
    expect(args).toEqual(['-mumble', 'acct-1', '-shareArchive']);
  });

  it('appends user extras after managed args', () => {
    const args = buildManagedLaunchArgs({
      mumbleName: 'acct-1',
      useAutologin: true,
      isMultiInstance: false,
      userExtras: ['-windowed', '-maploadinfo'],
    });
    expect(args).toEqual(['-mumble', 'acct-1', '-autologin', '-windowed', '-maploadinfo']);
  });
});
