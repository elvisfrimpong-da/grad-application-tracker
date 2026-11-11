(function (root) {
  'use strict';

  const bytesFrom64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const bytesTo64 = value => btoa(Array.from(new Uint8Array(value), c => String.fromCharCode(c)).join(''));

  async function deriveKey(password, params) {
    if (!params || params.name !== 'PBKDF2' || params.hash !== 'SHA-256' ||
        !Number.isInteger(params.iterations) || params.iterations < 100000 || params.iterations > 2000000 || !params.salt) {
      throw new Error('This backup format is not supported.');
    }
    const base = await root.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({name:'PBKDF2', salt:bytesFrom64(params.salt), iterations:params.iterations, hash:'SHA-256'}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }

  async function decrypt(blob, key) {
    if (!blob || !blob.iv || !blob.ciphertext) throw new Error('This backup format is not supported.');
    const plain = await root.crypto.subtle.decrypt({name:'AES-GCM', iv:bytesFrom64(blob.iv)}, key, bytesFrom64(blob.ciphertext));
    const value = JSON.parse(new TextDecoder().decode(plain));
    if (!value || !Array.isArray(value.applications)) throw new Error('This file is not a GradPath backup.');
    return value;
  }

  function accessPhraseFromFile(text) {
    const matches = text.split(/\r?\n/).map(line => line.trim()).filter(line => /^[A-Za-z2-9]{5}(?:-[A-Za-z2-9]{5}){3}$/.test(line));
    if (matches.length !== 1) throw new Error('Choose your GradPath access phrase .txt file.');
    return matches[0];
  }

  async function encryptWithPassword(value, password) {
    if (!value || !Array.isArray(value.applications)) throw new Error('The tracker data is invalid.');
    const params = {name:'PBKDF2', hash:'SHA-256', iterations:310000, salt:bytesTo64(root.crypto.getRandomValues(new Uint8Array(16)))};
    const key = await deriveKey(password, params);
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await root.crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(JSON.stringify(value)));
    const blob = {version:1, kdf:params, iv:bytesTo64(iv), ciphertext:bytesTo64(ciphertext)};
    await decrypt(blob, key);
    return {blob, key};
  }

  const api = {bytesFrom64, bytesTo64, deriveKey, decrypt, accessPhraseFromFile, encryptWithPassword};
  root.GradCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
