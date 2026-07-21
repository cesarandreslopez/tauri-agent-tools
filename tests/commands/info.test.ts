import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerInfo } from '../../src/commands/info.js';

vi.mock('../../src/platform/detect.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/platform/detect.js')>(
    '../../src/platform/detect.js',
  );
  return {
    ...actual,
    detectDisplayServer: vi.fn(() => 'x11'),
  };
});

describe('Info command', () => {
  function createProgram() {
    const program = new Command();
    program.exitOverride();
    const mockAdapter = {
      findWindow: vi.fn().mockResolvedValue('12345'),
      captureWindow: vi.fn(),
      getWindowGeometry: vi.fn().mockResolvedValue({
        windowId: '12345',
        x: 100,
        y: 200,
        width: 1920,
        height: 1080,
      }),
      getWindowName: vi.fn().mockResolvedValue('Test App'),
      listWindows: vi.fn(),
    };
    registerInfo(program, () => mockAdapter);
    return { program, mockAdapter };
  }

  it('outputs human-readable info by default', async () => {
    const { program } = createProgram();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'info', '--title', 'Test App']);

    expect(consoleSpy).toHaveBeenCalledWith('Window ID:      12345');
    expect(consoleSpy).toHaveBeenCalledWith('Name:           Test App');
    expect(consoleSpy).toHaveBeenCalledWith('Position:       100, 200');
    expect(consoleSpy).toHaveBeenCalledWith('Size:           1920x1080');
    expect(consoleSpy).toHaveBeenCalledWith('Display Server: x11');

    consoleSpy.mockRestore();
  });

  it('outputs JSON when --json is passed', async () => {
    const { program } = createProgram();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'info', '--title', 'Test App', '--json']);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output).toMatchObject({
      windowId: '12345',
      x: 100,
      y: 200,
      width: 1920,
      height: 1080,
      name: 'Test App',
      displayServer: 'x11',
    });

    consoleSpy.mockRestore();
  });

  it('requires --title or --window-id', async () => {
    const { program } = createProgram();

    await expect(
      program.parseAsync(['node', 'test', 'info']),
    ).rejects.toThrow(/Either --title or --window-id is required/);
  });

  it('uses --window-id directly without calling findWindow', async () => {
    const { program, mockAdapter } = createProgram();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'info', '--window-id', '99999']);

    expect(mockAdapter.findWindow).not.toHaveBeenCalled();
    expect(mockAdapter.getWindowGeometry).toHaveBeenCalledWith('99999');
    expect(mockAdapter.getWindowName).toHaveBeenCalledWith('99999');

    vi.restoreAllMocks();
  });

  it('--window-id wins over --title', async () => {
    const { program, mockAdapter } = createProgram();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'info', '--title', 'My Window', '-w', '777']);

    expect(mockAdapter.findWindow).not.toHaveBeenCalled();
    expect(mockAdapter.getWindowGeometry).toHaveBeenCalledWith('777');

    vi.restoreAllMocks();
  });

  it('calls adapter methods with correct arguments', async () => {
    const { program, mockAdapter } = createProgram();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['node', 'test', 'info', '--title', 'My Window']);

    expect(mockAdapter.findWindow).toHaveBeenCalledWith('My Window');
    expect(mockAdapter.getWindowGeometry).toHaveBeenCalledWith('12345');
    expect(mockAdapter.getWindowName).toHaveBeenCalledWith('12345');

    vi.restoreAllMocks();
  });
});
