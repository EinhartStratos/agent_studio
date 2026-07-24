const api = window.electronAPI;

api.onUpdateProgress((progress) => {
  const el = document.getElementById('progress');
  if (el) el.textContent = `${progress}%`;
});

document.getElementById('run')?.addEventListener('click', async () => {
  const input = document.getElementById('prompt') as HTMLInputElement | null;
  const output = document.getElementById('output');
  if (!output || !input) return;

  try {
    const result = await api.invokeAgent('run', [input.value]);
    output.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    output.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
});

document.getElementById('cmd')?.addEventListener('click', async () => {
  const input = document.getElementById('command') as HTMLInputElement | null;
  const output = document.getElementById('output');
  if (!output || !input) return;

  const value = input.value.trim();
  if (!value) return;

  const [command, ...args] = value.split(/\s+/);
  if (!command) return;

  try {
    const result = await api.executeCommand(command, args);
    output.textContent = JSON.stringify(result, null, 2);
  } catch (err) {
    output.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
