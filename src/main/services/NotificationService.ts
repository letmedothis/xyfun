import { windowService } from '@main/services/WindowService';
import { IPC_CHANNEL } from '@shared/config/ipcChannel';
import type { INotification } from '@shared/config/notification';
import type { BrowserWindow } from 'electron';
import { Notification as ElectronNotification } from 'electron';

class NotificationService {
  private window: BrowserWindow;

  constructor(window: BrowserWindow) {
    // Initialize the service
    this.window = window;
  }

  public async sendNotification(notification: INotification) {
    // Electron Notification API
    const electronNotification = new ElectronNotification({
      title: notification.title,
      body: notification.message,
    });

    electronNotification.on('click', () => {
      if (this.window.isDestroyed()) return;
      windowService.showWindow(this.window);
      this.window.webContents.send(IPC_CHANNEL.NOTIFICATION_CLICK, notification);
    });

    electronNotification.show();
  }
}

export default NotificationService;
