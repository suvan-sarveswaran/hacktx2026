import { useId, useState, useSyncExternalStore } from "react";
import { KeyRound, SlidersHorizontal, Trash2 } from "lucide-react";

const storageKey = "entertainify-api-keys-v1";
type Provider = "Groq" | "Pollinations" | "ElevenLabs";
const providers: Provider[] = ["Groq", "Pollinations", "ElevenLabs"];
let keys: Partial<Record<Provider, string>> = {};
let storageError = "";
const listeners = new Set<() => void>();
function readKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    keys = Object.fromEntries(providers.filter(p => typeof saved?.[p] === "string" && saved[p].length <= 500 && !/[\r\n]/.test(saved[p])).map(p => [p, saved[p]]));
  } catch { keys = {}; }
}
readKeys();
window.addEventListener("storage", event => { if (event.key === storageKey || event.key === null) { readKeys(); listeners.forEach(fn => fn()); } });
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function saveKey(provider: Provider, value: string) {
  keys = { ...keys, [provider]: value.trim().slice(0, 500).replace(/[\r\n]/g, "") };
  try { localStorage.setItem(storageKey, JSON.stringify(keys)); storageError = ""; }
  catch { storageError = "Browser storage is unavailable. These keys will last only until you refresh."; }
  listeners.forEach(fn => fn());
}
export function useApiKey(provider: Provider): [string, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => keys[provider] ?? "");
  return [value, value => saveKey(provider, value)];
}
export function ApiKeyField({ provider, value, onChange, compact = false }: { provider: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const [error, setError] = useState("");
  const id = useId();
  return <div className="key-field"><label htmlFor={id}>{provider} API key</label><input id={id} type="password" autoComplete="off" spellCheck={false} maxLength={500} value={value} onChange={e => onChange(e.target.value)} placeholder="Paste your key"/>
    {!compact && <><label className="key-file">or load a key from a .txt file<input type="file" accept=".txt,text/plain" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      try { if (file.size > 1000) throw new Error("Choose a text file containing only your API key."); const key = (await file.text()).trim(); if (!key || key.length > 500 || /[\r\n]/.test(key)) throw new Error("The file must contain a single API key."); onChange(key); setError(""); }
      catch (error) { setError(error instanceof Error ? error.message : "Could not read that key file."); }
    }}/></label><small>Auto-saved in this browser. Manage or clear keys in the home settings card.</small></>}{error && <p role="alert">{error}</p>}</div>;
}
export function SettingsPanel() {
  const saved = useSyncExternalStore(subscribe, () => keys);
  const error = useSyncExternalStore(subscribe, () => storageError);
  const count = providers.filter(p => saved[p]).length;
  return <section className="comic-panel settings-panel" aria-labelledby="settings-title">
    <div className="settings-kicker"><span className="eyebrow">SET IT. THEN FORGET IT.</span><SlidersHorizontal size={21}/></div>
    <h2 id="settings-title">Your studio keys.</h2><p>One setup for every little story.</p>
    <div className="settings-fields">{providers.map(provider => <ApiKeyField key={provider} provider={provider} value={saved[provider] ?? ""} onChange={value => saveKey(provider, value)} compact/>)}</div>
    <div className="settings-status"><span role="status"><KeyRound size={14}/>{count ? `${count} of 3 keys saved` : "Add keys to get started"}</span><button type="button" className="text-link" disabled={!count} onClick={() => { keys = {}; try { localStorage.removeItem(storageKey); storageError = ""; } catch { storageError = "Could not clear browser storage. Clear this site's data in your browser settings."; } listeners.forEach(fn => fn()); }}><Trash2 size={13}/>Clear keys</button></div>
    <small>Saved on this device, including after refresh. Anyone using this browser profile can access them. Clear them on shared devices. Keys are sent only when you start a provider request.</small>
    {error && <p role="alert">{error}</p>}
  </section>;
}
