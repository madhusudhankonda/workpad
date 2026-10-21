const KEY = "openaiApiKey";

export async function getOpenAIKey(): Promise<{ key: string; persistent: boolean }> {
  const [session, local] = await Promise.all([chrome.storage.session.get(KEY), chrome.storage.local.get(KEY)]);
  if (typeof session[KEY] === "string" && session[KEY]) return { key: session[KEY], persistent: false };
  return { key: typeof local[KEY] === "string" ? local[KEY] : "", persistent: Boolean(local[KEY]) };
}

export async function saveOpenAIKey(key: string, persistent = false): Promise<void> {
  const value = key.trim();
  if (!value) return;
  if (persistent) await Promise.all([chrome.storage.local.set({ [KEY]: value }), chrome.storage.session.remove(KEY)]);
  else await Promise.all([chrome.storage.session.set({ [KEY]: value }), chrome.storage.local.remove(KEY)]);
}

export async function removeOpenAIKey(): Promise<void> {
  await Promise.all([chrome.storage.session.remove(KEY), chrome.storage.local.remove(KEY)]);
}
