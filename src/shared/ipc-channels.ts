export const IPC_CHANNELS = {
  AGENT_INVOKE: 'agent:invoke',
  AGENT_MESSAGE: 'agent:message',
  AGENT_RESTART: 'agent:restart',
  SHELL_EXECUTE: 'shell:execute',
  UPDATE_PROGRESS: 'update:progress',
  CONFIG_GET: 'config:get',
  CONFIG_SET: 'config:set',
  CONFIG_UPDATE: 'config:update',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const;
