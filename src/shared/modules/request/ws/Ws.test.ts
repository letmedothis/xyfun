import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockWebSocket } = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static instances: MockWebSocket[] = [];

    onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onopen: ((event: unknown) => void) | null = null;
    readyState = MockWebSocket.OPEN;
    close = vi.fn();
    send = vi.fn();

    constructor(public url: string) {
      MockWebSocket.instances.push(this);
    }
  }

  return { MockWebSocket };
});

vi.mock('isomorphic-ws', () => ({ default: MockWebSocket }));

import { VWs } from './Ws';

function createRequest() {
  return new VWs({ requestOptions: { ignoreCancelToken: false } });
}

describe('websocket requests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects after an unexpected disconnect', async () => {
    const request = createRequest();
    const connected = request.get({ autoReconnect: { delay: 10, retries: 1 }, url: 'ws://example.test' });
    const first = MockWebSocket.instances[0];

    first.onopen?.({});
    await connected;
    first.onclose?.({ code: 1006, wasClean: false });
    await vi.advanceTimersByTimeAsync(10);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('cancels an active connection without reconnecting', async () => {
    const request = createRequest();
    const connected = request.get({ autoReconnect: true, url: 'ws://example.test' });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.({});
    await connected;
    request.canceler.removeAllPending();
    socket.onclose?.({ code: 1006, wasClean: false });
    await vi.advanceTimersByTimeAsync(1000);

    expect(socket.close).toHaveBeenCalledOnce();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('keeps only one heartbeat response timeout', async () => {
    const request = createRequest();
    const connected = request.get({
      heartbeat: { interval: 10, message: 'ping', pongTimeout: 25, responseMessage: 'pong' },
      url: 'ws://example.test',
    });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.({});
    await connected;
    await vi.advanceTimersByTimeAsync(20);
    socket.onmessage?.({ data: 'pong' });
    await vi.advanceTimersByTimeAsync(20);

    expect(socket.close).not.toHaveBeenCalled();
  });

  it('closes the connection when a heartbeat is not acknowledged', async () => {
    const request = createRequest();
    const connected = request.get({
      heartbeat: { interval: 10, message: 'ping', pongTimeout: 25, responseMessage: 'pong' },
      url: 'ws://example.test',
    });
    const socket = MockWebSocket.instances[0];

    socket.onopen?.({});
    await connected;
    await vi.advanceTimersByTimeAsync(35);

    expect(socket.send).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
