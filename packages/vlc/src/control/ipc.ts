import { randomUUID } from 'node:crypto';

import type { WebContents } from 'electron';
import { ipcMain } from 'electron';

import { VLC_IPC_CHANNEL } from '../constants/ipc';
import { VlcApi } from './api';

const instances = new Map<string, VlcApi>();
const instanceOwners = new Map<string, number>();
const wcInstanceIds = new Map<number, Set<string>>();

const getInstance = (id: string): VlcApi | undefined => {
  return instances.get(id);
};

const getOwnedInstance = (wcId: number, id: string): VlcApi | undefined => {
  if (instanceOwners.get(id) !== wcId) return undefined;
  return getInstance(id);
};

export function destroyInstances(ids: Iterable<string>): void {
  for (const id of ids) {
    try {
      instances.get(id)?.destroy();
    } finally {
      instances.delete(id);
      instanceOwners.delete(id);
    }
  }
}

function trackWebContentsLifecycle(wc: WebContents, wcId: number): void {
  if (wcInstanceIds.has(wcId)) return;

  wcInstanceIds.set(wcId, new Set());

  // Page refresh: destroy all old instances before new page loads
  wc.on('did-start-navigation' as any, (_event: any, _url: string, _isInPlace: boolean, isMainFrame: boolean) => {
    if (!isMainFrame) return;
    const ids = wcInstanceIds.get(wcId);
    if (ids && ids.size > 0) {
      destroyInstances(ids);
      ids.clear();
    }
  });

  // Window / tab close
  wc.on('destroyed', () => {
    const ids = wcInstanceIds.get(wcId);
    if (ids) {
      destroyInstances(ids);
      ids.clear();
    }
    wcInstanceIds.delete(wcId);
  });
}

export type OnVlcCreated = (wc: WebContents, instanceId: string, api: VlcApi) => void;

export const ipc = (onCreated?: OnVlcCreated): void => {
  ipcMain.handle(VLC_IPC_CHANNEL.VLC_CREATE, (event, path, options, instanceId?) => {
    const requestedId = typeof instanceId === 'string' && instanceId.trim() ? instanceId : undefined;
    const id = requestedId ?? `vlc_player_${randomUUID()}`;
    if (instances.has(id)) throw new Error(`VLC instance already exists: ${id}`);

    const api = new VlcApi(id);
    const ins = api.create(path, options);

    instances.set(ins, api);
    instanceOwners.set(ins, event.sender.id);
    trackWebContentsLifecycle(event.sender, event.sender.id);
    wcInstanceIds.get(event.sender.id)!.add(ins);

    onCreated?.(event.sender, ins, api);

    return ins;
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_ATTACH, (event, handle, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.attach(handle);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_FRAME_FORMAT, (event, width, height, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setFrameFormat(width, height);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_FRAME_RGBA, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getFrameRgba();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_STATE, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getState();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_METRICS, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getMetrics();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_PLAY, (event, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.play();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_STOP, (event, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.stop();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_PAUSE, (event, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.pause();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_TOGGLE, (event, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.toggle();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_VOLUME, (event, vol, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setVolume(vol);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_VOLUME, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getVolume();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_MUTED, (event, muted, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setMuted(Boolean(muted));
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_MUTED, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getMuted();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SEEK, (event, time, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.seek(time);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_PROGRESS, (event, progress, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setProgress(progress);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_PROGRESS, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getProgress();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_DURATION, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getDuration();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_PLAYED, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getPlayed();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_BUFFERED, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getBuffered();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_ENDED, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getEnded();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_PLAYBACK_RATE, (event, rate, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setPlaybackRate(rate);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_PLAYBACK_RATE, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getPlaybackRate();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_SUBTITLE_TRACK, (event, track, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setSubtitleTrack(track);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_SUBTITLE_TRACK, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getSubtitleTrack();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_ADD_SUBTITLE_FILE, (event, path, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.addSubtitleFile(path);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_SET_AUDIO_TRACK, (event, track, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.setAudioTrack(track);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_GET_AUDIO_TRACK, (event, instanceId?) => {
    return getOwnedInstance(event.sender.id, instanceId ?? 'default')?.getAudioTrack();
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_ON_EVENT, (event, eventName, callback, instanceId?) => {
    getOwnedInstance(event.sender.id, instanceId ?? 'default')?.onEvent(eventName, callback);
  });

  ipcMain.handle(VLC_IPC_CHANNEL.VLC_DESTROY, (event, instanceId?) => {
    const id = instanceId ?? 'default';
    const api = getOwnedInstance(event.sender.id, id);
    if (!api) return;
    api?.destroy();
    instances.delete(id);
    instanceOwners.delete(id);

    for (const ids of wcInstanceIds.values()) {
      ids.delete(id);
    }
  });
};

export { instanceOwners, instances };
