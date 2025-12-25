'use client';

import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';

import { useWebContainerStore } from '@/store/webContainerStore';

/**
 * 终端面板对外暴露的方法接口
 * 通过 ref 向父组件提供可调用的方法
 */
export interface TerminalPanelRefInterface {
  terminalResize: () => void; // 手动触发终端尺寸调整的方法
}

/**
 * xterm.js 终端主题配置对象
 * 定义终端的视觉外观，模拟真实终端的配色方案
 * 包含标准 ANSI 颜色和亮色变体
 */
const terminalTheme = {
  foreground: '#ffffff', // 默认前景色（文字颜色）
  background: '#1e1e1e', // 背景色（类似 VS Code 暗色主题）
  cursor: '#ffffff', // 光标颜色
  selection: 'rgba(255, 255, 255, 0.3)', // 文本选中时的背景色（半透明白色）

  // ANSI 标准颜色（用于终端输出着色）
  black: '#000000', // ANSI Black
  brightBlack: '#808080', // ANSI Bright Black（灰色）
  red: '#ce2f2b', // ANSI Red（错误信息常用）
  brightRed: '#f44a47', // ANSI Bright Red
  green: '#00b976', // ANSI Green（成功信息常用）
  brightGreen: '#05d289', // ANSI Bright Green
  yellow: '#e0d500', // ANSI Yellow（警告信息常用）
  brightYellow: '#f4f628', // ANSI Bright Yellow
  magenta: '#bd37bc', // ANSI Magenta
  brightMagenta: '#d86cd8', // ANSI Bright Magenta
  blue: '#1d6fca', // ANSI Blue（信息提示常用）
  brightBlue: '#358bed', // ANSI Bright Blue
  cyan: '#00a8cf', // ANSI Cyan
  brightCyan: '#19b8dd', // ANSI Bright Cyan
  white: '#e5e5e5', // ANSI White
  brightWhite: '#ffffff', // ANSI Bright White
};

/**
 * 终端面板组件
 * 使用 forwardRef 允许父组件通过 ref 访问子组件的方法（如 terminalResize）
 *
 * @param props - 组件属性（当前未使用）
 * @param ref - 父组件传入的 ref，用于暴露 terminalResize 方法
 */
export const TerminalPanel = forwardRef<TerminalPanelRefInterface, any>(
  function TerminalPanel(props, ref) {
    // ========== DOM 引用 ==========
    // 终端容器的 DOM 引用，xterm.js 会将终端界面挂载到这个 div 上
    const terminalRef = useRef<HTMLDivElement>(null);

    // ========== WebContainer 状态 ==========
    // webContainerInstance: 浏览器内的 Node.js 运行时实例
    // setUrl: 更新服务器就绪后的 URL（用于预览）
    const { webContainerInstance, setUrl } = useWebContainerStore();

    // ========== 终端相关实例引用 ==========
    /**
     * shell: WebContainer 中运行的 Shell 进程（jsh - JavaScript Shell）
     * 作用：接收用户命令、执行并返回输出
     * 类型应为 WebContainerProcess，这里简化为 any
     */
    let shell = useRef<any>(null);

    /**
     * terminal: xterm.js 的核心终端实例
     * 作用：渲染终端界面、处理用户输入、显示输出
     */
    let terminal: any;

    /**
     * fitAddon: 自适应插件
     * 作用：自动调整终端尺寸以适配容器大小（计算行数和列数）
     */
    let fitAddon: any;

    /**
     * webLinksAddon: 链接识别插件
     * 作用：自动识别终端中的 URL 并使其可点击
     */
    let webLinksAddon: any;

    /**
     * webglAddon: WebGL 渲染插件
     * 作用：使用 GPU 加速终端渲染，提升性能（尤其是大量输出时）
     */
    let webglAddon: any;

    /**
     * useImperativeHandle Hook
     * 作用：向父组件暴露可调用的方法
     *
     * 使用场景：
     * 父组件通过 ref.current.terminalResize() 手动触发终端尺寸调整
     * 例如：当用户拖拽调整面板大小时，父组件调用此方法同步终端尺寸
     */
    useImperativeHandle(
      ref,
      () => ({
        /**
         * terminalResize 方法
         * 作用：重新计算并调整终端尺寸
         *
         * 执行步骤：
         * 1. fitAddon.fit() - 根据容器尺寸计算最佳行列数
         * 2. shell.resize() - 通知 WebContainer 的 Shell 进程调整伪终端尺寸
         *
         * 为什么需要两步？
         * - xterm.js 只负责前端显示，需要手动 fit()
         * - WebContainer 的 Shell 需要知道终端尺寸以正确换行和格式化输出
         */
        terminalResize: () => {
          if (fitAddon && shell.current) {
            // 步骤1：让 xterm.js 重新计算终端尺寸
            fitAddon.fit();

            // 步骤2：将新尺寸同步到 WebContainer 的 Shell 进程
            // cols: 列数（一行可容纳的字符数）
            // rows: 行数（可见的终端行数）
            shell.current.resize({
              cols: terminal?.cols,
              rows: terminal?.rows,
            });
          }
        },
      }),
      [webContainerInstance], // 依赖项：当 WebContainer 实例变化时重新创建方法
    );

    /**
     * useEffect Hook - 终端初始化和生命周期管理
     * 依赖项：[webContainerInstance]
     * 触发时机：当 WebContainer 实例创建或变化时执行
     */
    useEffect(() => {
      /**
       * 异步初始化函数
       * 使用 IIFE（立即执行函数表达式）包装异步逻辑
       */
      (async function init() {
        // ========== 动态导入 xterm.js 相关模块 ==========
        /**
         * 为什么使用动态 import？
         * 1. xterm.js 体积较大（~200KB），动态导入减少初始包大小
         * 2. 仅在需要时加载，提升首屏加载速度
         * 3. 服务端渲染时不会执行（'use client' 标记）
         *
         * 动态导入的核心优势：
         * - 减小主 Bundle 体积 → 首屏加载更快
         * - 避免 SSR 错误 → 浏览器 API 安全使用
         * - 按需加载 → 用户不使用不下载
         * - 代码分割 → Webpack 自动优化
         * - 更好的缓存策略 → 终端代码独立更新
         */

        // 导入核心终端类
        const { Terminal } = await import('xterm');

        // 导入自适应插件（自动调整终端尺寸）
        const { FitAddon } = await import('xterm-addon-fit');

        // 导入链接识别插件（点击 URL 跳转）
        const { WebLinksAddon } = await import('xterm-addon-web-links');

        // 导入 WebGL 渲染插件（GPU 加速）
        const { WebglAddon } = await import('xterm-addon-webgl');

        // ========== 实例化插件 ==========
        fitAddon = new FitAddon();
        webLinksAddon = new WebLinksAddon();
        webglAddon = new WebglAddon();

        // ========== 检查 WebContainer 是否已初始化 ==========
        if (webContainerInstance) {
          // ========== 检查 DOM 容器和终端实例状态 ==========
          // 确保：1. DOM 已挂载  2. 终端尚未创建（避免重复初始化）
          if (terminalRef.current && !terminal) {
            /**
             * 创建 xterm.js 终端实例
             * 这是终端模拟器的核心对象，负责所有终端行为
             */
            terminal = new Terminal({
              /**
               * fontFamily - 字体族
               * 使用等宽字体确保字符对齐（终端必须）
               * 回退顺序：Cascadia Code → Menlo → 系统等宽字体
               */
              fontFamily: '"Cascadia Code", Menlo, monospace',

              /**
               * fontSize - 字体大小（像素）
               * 影响终端的可读性和容器可容纳的行列数
               */
              fontSize: 13,

              /**
               * convertEol - 自动转换行尾符
               * 作用：将 \n 转换为 \r\n（Windows 风格）
               * 确保跨平台换行一致性
               */
              convertEol: true,

              /**
               * cursorBlink - 光标闪烁
               * 提升用户体验，明确显示输入位置
               */
              cursorBlink: true,

              /**
               * scrollback - 历史缓冲区行数
               * 当前值 20 较小！
               * 建议：1000+ 以保留更多历史输出
               * 作用：向上滚动可查看的历史命令输出
               */
              scrollback: 20,

              /**
               * scrollOnUserInput - 输入时自动滚动到底部
               * 用户输入时立即跳转到最新命令行
               */
              scrollOnUserInput: true,

              /**
               * drawBoldTextInBrightColors - 粗体文本使用亮色
               * 符合传统终端行为（粗体 = 高亮）
               */
              drawBoldTextInBrightColors: true,

              /**
               * theme - 主题配置
               * 应用前面定义的 terminalTheme 对象
               */
              theme: terminalTheme,
            });

            // ========== 加载插件到终端实例 ==========
            /**
             * loadAddon - 插件加载方法
             * xterm.js 采用插件架构，核心功能通过插件扩展
             */

            // 加载自适应插件（必须在 open() 之后才能使用 fit()）
            terminal.loadAddon(fitAddon);

            // 加载链接识别插件（自动识别 http://、https:// 等）
            terminal.loadAddon(webLinksAddon);

            // 加载 WebGL 渲染插件（显著提升渲染性能）
            terminal.loadAddon(webglAddon);

            /**
             * open() - 将终端挂载到 DOM
             * 作用：在指定的 div 容器中渲染终端界面
             * 此时用户可以看到终端，但还不能交互（需要连接 Shell）
             */
            terminal.open(terminalRef.current);

            /**
             * fit() - 首次尺寸适配
             * 作用：根据容器尺寸计算最佳行列数
             * 必须在 open() 之后调用（需要实际 DOM 尺寸）
             */
            fitAddon.fit();

            /**
             * ========== 核心步骤：启动 WebContainer 中的 Shell 进程 ==========
             *
             * spawn() - WebContainer API 方法
             * 作用：在浏览器内的虚拟 Linux 环境中启动一个进程
             *
             * 参数说明：
             * - 'jsh': JavaScript Shell（WebContainer 提供的内置 Shell）
             *   相当于 Linux 的 bash，但用 JavaScript 实现
             *   支持基本命令：cd、ls、cat、npm、node 等
             *
             * - terminal 配置：告诉 Shell 当前终端的尺寸
             *   cols: 列数（每行字符数，如 80）
             *   rows: 行数（可见行数，如 24）
             *
             * 为什么需要传递尺寸？
             * - Shell 需要知道何时换行（避免文本溢出）
             * - 某些命令（如 vim、top）需要终端尺寸信息
             *
             * 返回值：WebContainerProcess 实例
             * - 包含 input（输入流）和 output（输出流）
             * - 类似 Node.js 的 child_process
             */
            shell.current = await webContainerInstance.spawn('jsh', {
              terminal: {
                cols: terminal?.cols, // 从 xterm.js 实例获取当前列数
                rows: terminal?.rows, // 从 xterm.js 实例获取当前行数
              },
            });

            /**
             * ========== 监听窗口大小变化 ==========
             *
             * 场景：
             * - 用户调整浏览器窗口大小
             * - 开发者工具打开/关闭
             * - 屏幕旋转（移动设备）
             *
             * 响应式调整流程：
             * 1. 浏览器窗口变化 → resize 事件触发
             * 2. fitAddon.fit() → xterm.js 重新计算行列数
             * 3. shell.resize() → 通知 WebContainer 调整伪终端尺寸
             *
             * 注意：这是全局窗口事件，组件卸载时需要移除（见 cleanup）
             */
            window.addEventListener('resize', () => {
              // 防御性检查：确保插件和 Shell 已初始化
              if (fitAddon && shell.current) {
                // 步骤1：让终端 UI 适配新容器尺寸
                fitAddon.fit();

                // 步骤2：同步新尺寸到 Shell 进程
                // 这样 Shell 输出的命令行宽度会匹配终端显示
                shell.current.resize({
                  cols: terminal?.cols,
                  rows: terminal?.rows,
                });
              }
            });

            /**
             * ========== 建立输出流：Shell → 终端 ==========
             *
             * 流式架构说明：
             * WebContainer 使用 Web Streams API（现代浏览器标准）
             * - ReadableStream：可读流（Shell 的 output）
             * - WritableStream：可写流（自定义处理器）
             *
             * pipeTo() 方法：
             * 作用：将 Shell 的输出流连接到自定义的可写流
             * 类比：Linux 管道 shell.output | terminal.write
             *
             * 数据流向：
             * Shell 执行命令 → 产生输出 → output 流
             *   → WritableStream.write() 回调
             *   → terminal.write(data) → 终端显示
             *
             * 示例：
             * 用户输入 "ls" → Shell 执行 → 输出文件列表
             *   → data = "file1.txt\nfile2.txt\n"
             *   → terminal.write(data) → 用户看到列表
             */
            shell.current.output.pipeTo(
              new WritableStream({
                /**
                 * write() 回调函数
                 * 每当 Shell 产生输出时被调用
                 *
                 * @param data - Shell 输出的数据（字符串或 Uint8Array）
                 */
                write(data) {
                  // 将 Shell 输出写入 xterm.js 终端显示
                  terminal?.write(data);
                },
              }),
            );

            /**
             * ========== 建立输入流：终端 → Shell ==========
             *
             * getWriter() 方法：
             * 作用：获取 Shell 输入流的写入器
             * 类型：WritableStreamDefaultWriter
             * 用途：向 Shell 发送用户输入的命令
             */
            const input = shell.current.input.getWriter();

            /**
             * onData() - xterm.js 事件监听器
             * 作用：监听用户在终端的所有输入
             * 触发时机：
             * - 用户按下键盘按键（包括字母、数字、回车、退格等）
             * - 鼠标粘贴文本
             *
             * 数据流向：
             * 用户按键 → xterm.js 捕获 → onData 回调
             *   → input.write(data) → Shell 接收
             *   → Shell 处理命令 → output 流 → 终端显示
             *
             * 示例完整流程：
             * 1. 用户输入 "n" → data = "n"
             * 2. input.write("n") → Shell 接收
             * 3. Shell 回显 "n" → output 流 → 终端显示 "n"
             * 4. 用户继续输入 "p" "m" " " "i" "n" "s" "t" "a" "l" "l"
             * 5. 用户按回车 → data = "\r"（回车符）
             * 6. Shell 执行 "npm install" → 输出日志 → 终端显示进度
             *
             * @param data - 用户输入的数据（单个字符或粘贴的字符串）
             */
            terminal?.onData((data: any) => {
              // 将用户输入写入 Shell 的输入流
              input.write(data);
            });
          }
        }
      })(); // IIFE 立即执行

      /**
       * ========== Cleanup 函数（组件卸载时执行） ==========
       *
       * useEffect 返回的函数会在以下时机执行：
       * 1. 组件卸载时（用户离开页面）
       * 2. 依赖项 webContainerInstance 变化前（重新初始化前）
       *
       * 清理目的：
       * - 释放内存
       * - 停止后台进程
       * - 移除事件监听器
       * - 防止内存泄漏
       */
      return () => {
        /**
         * 清理 WebContainer 文件系统
         * 作用：删除虚拟文件系统中的所有文件
         * 参数：
         * - '/': 根目录
         * - recursive: true → 递归删除所有子目录和文件
         *
         * 为什么需要？
         * - WebContainer 数据保存在浏览器内存
         * - 不清理会导致内存持续占用
         * - 下次进入页面会重新初始化
         */
        webContainerInstance?.fs.rm('/', { recursive: true });

        /**
         * 终止 Shell 进程
         * 作用：停止 jsh 进程的运行
         * 类比：Linux 的 kill 命令
         *
         * 效果：
         * - 停止接收输入
         * - 停止产生输出
         * - 释放进程资源
         */
        shell.current?.kill();

        /**
         * 清空服务器 URL
         * 作用：重置 Preview 组件的显示状态
         * 场景：如果用户启动了开发服务器（如 npm run dev）
         *      卸载组件时需要清空 URL 避免预览组件显示错误
         */
        setUrl('');

        /**
         * 清空终端实例
         * 作用：释放 xterm.js 实例占用的内存
         *
         * 注意：这里没有调用 terminal.dispose()
         * 更好的做法应该是：
         * if (terminal) {
         *   terminal.dispose(); // 正确清理 xterm.js 资源
         *   terminal = null;
         * }
         */
        terminal = null;

        /**
         * 注意：这里缺少移除 window resize 事件监听器！
         * 可能导致内存泄漏（事件监听器仍然存在）
         *
         * 建议添加：
         * const resizeHandler = () => { ... };
         * window.addEventListener('resize', resizeHandler);
         * return () => {
         *   window.removeEventListener('resize', resizeHandler);
         * };
         */
      };
    }, [webContainerInstance]); // 依赖项：WebContainer 实例变化时重新执行

    /**
     * ========== 组件渲染 ==========
     *
     * 返回一个简单的 div 容器
     * - h-full: Tailwind CSS 类，设置高度 100%（充满父容器）
     * - ref={terminalRef}: 绑定 DOM 引用，供 xterm.js 挂载使用
     *
     * xterm.js 会在这个 div 内部创建：
     * - Canvas 元素（实际的终端渲染区域）
     * - 样式元素（终端外观）
     * - 事件监听器（处理键盘、鼠标输入）
     */
    return <div className="h-full" ref={terminalRef} />;
  },
);
