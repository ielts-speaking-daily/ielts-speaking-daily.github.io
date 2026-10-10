const DB_NAME = 'ielts-speaking-audio-v1';
const STORE = 'recordings';
let opening;
function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('浏览器不支持本机音频保存，请下载录音。'));
  if (!opening) opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('questionId', 'questionId', { unique: false });
      }
    };
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); opening = null; }; resolve(req.result); };
    req.onerror = () => { opening = null; reject(new Error('本机音频存储无法打开，请下载录音。')); };
    req.onblocked = () => { opening = null; reject(new Error('请关闭其他旧版练习页后重试本机音频保存。')); };
  });
  return opening;
}
export async function saveAudio(record) {
  if (!record || !(record.blob instanceof Blob) || !record.blob.size) throw new Error('没有捕获到有效音频，请重试。');
  if (record.blob.size > 50 * 1024 * 1024) throw new Error('单条录音超过50MB，请先下载保留。');
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(record.id || '') || !/^QB-/.test(record.questionId || '')) throw new Error('录音标识无效。');
  const value = { id: record.id, questionId: record.questionId, createdAt: record.createdAt || new Date().toISOString(), mode: record.mode === 'read-aloud' ? 'read-aloud' : 'free-answer', blob: record.blob, interrupted: Boolean(record.interrupted), mimeType: record.blob.type, duration: Number.isFinite(record.duration) ? record.duration : null };
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(value);
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(new Error('本机音频未保存，可能空间不足；请先下载本次录音。'));
  });
}
export async function listAudio(questionId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = questionId ? store.index('questionId').getAll(questionId) : store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a,b) => b.createdAt.localeCompare(a.createdAt)));
    req.onerror = () => reject(new Error('暂时无法读取本机音频。'));
  });
}
export async function deleteAudio(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('录音未能删除，请重试。'));
  });
}
