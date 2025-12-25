import { create } from 'zustand';
import { WebContainer } from '@webcontainer/api';
import localforage from 'localforage';

import { curDirectory, writeDirByLocal } from '@/utils';

interface WebContainerState {
  webContainerInstance: WebContainer | null;
  isInitialized: boolean;
  url: string;
}

interface WebContainerActions {
  initWebContainer: (projectId?: string) => Promise<void>;
  setUrl: (url: string) => void;
  setInitialized: (isInitialized: boolean) => void;
}

type WebContainerStore = WebContainerState & WebContainerActions;

export const useWebContainerStore = create<WebContainerStore>((set, get) => ({
  webContainerInstance: null,
  isInitialized: false,
  url: '',
  async initWebContainer(projectId = '') {
    const { webContainerInstance, isInitialized } = get();
    const projectInfo = await localforage.getItem(projectId);
    console.log('projectInfo', projectInfo);

    if (!isInitialized && !webContainerInstance) {
      const newWebContainerInstance = await WebContainer.boot();
      console.log('newWebContainerInstance', newWebContainerInstance);

      if (projectInfo) {
        const { projectFileData } = JSON.parse(projectInfo as string);
        console.log('projectFileData', projectFileData);
        await writeDirByLocal(projectFileData, newWebContainerInstance);
      }

      if (curDirectory) {
        console.log('curDirectory', curDirectory);
        await writeDirByLocal(curDirectory, newWebContainerInstance);
      }

      newWebContainerInstance?.on('server-ready', (port, url) => {
        /**
         * 'server-ready' 事件说明：
         * - 由 WebContainer 内部触发
         * - 当虚拟环境中的开发服务器启动并监听端口时触发
         * - 参数：
         *   port: 服务器监听的端口号（如 5173）
         *   url: WebContainer 生成的公网访问地址
         *        格式：https://<random-id>.webcontainer.io
         *
         * 为什么是公网地址？
         * - WebContainer 运行在浏览器沙箱中
         * - 需要通过 StackBlitz 的代理服务器访问
         * - 自动生成随机子域名隔离不同会话
         */
        console.log('server-ready', port, url);
        set({ url });
      });

      set({ webContainerInstance: newWebContainerInstance, isInitialized: true });
    } else {
      if (projectInfo) {
        const { projectFileData } = JSON.parse(projectInfo as any);
        console.log('projectFileData1', projectFileData);
        await writeDirByLocal(projectFileData, webContainerInstance as WebContainer);
      }

      if (curDirectory) {
        console.log('curDirectory1', curDirectory);
        await writeDirByLocal(curDirectory, webContainerInstance!);
      }

      webContainerInstance?.on('server-ready', (port, url) => {
        /**
         * 'server-ready' 事件说明：
         * - 由 WebContainer 内部触发
         * - 当虚拟环境中的开发服务器启动并监听端口时触发
         * - 参数：
         *   port: 服务器监听的端口号（如 5173）
         *   url: WebContainer 生成的公网访问地址
         *        格式：https://<random-id>.webcontainer.io
         *
         * 为什么是公网地址？
         * - WebContainer 运行在浏览器沙箱中
         * - 需要通过 StackBlitz 的代理服务器访问
         * - 自动生成随机子域名隔离不同会话
         */
        console.log('server-ready11', port, url);
        set({ url });
      });

      set({ webContainerInstance: webContainerInstance, isInitialized: true });
    }
  },
  setUrl(url: string) {
    set({ url });
  },
  setInitialized(isInitialized: boolean) {
    set({ isInitialized });
  },
}));
