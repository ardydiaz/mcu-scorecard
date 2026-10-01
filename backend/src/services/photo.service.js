const { Op } = require('sequelize');
const User = require('../models/User');
const UserPhoto = require('../models/UserPhoto');
const { getMsalClient, appScopes } = require('../config/microsoft');
const logger = require('../utils/logger');

// Microsoft 365 profile photos, read with the app's User.Read.All permission and kept in
// user_photos. Refreshed at sign-in, during the admin user sync, and in the background when a
// saved photo is more than a day old.
const PHOTO_SIZE = '120x120'; // sharp on the 32–64 px avatars, ~4 KB each
const RECHECK_MS = 24 * 60 * 60 * 1000;
const SYNC_CONCURRENCY = 6;

const refreshing = new Map(); // userId -> in-flight Promise

// { data, contentType } or null when the user has no photo in M365
async function fetchPhoto(azureOid) {
  const { accessToken } = await getMsalClient().acquireTokenByClientCredential({ scopes: appScopes });
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${azureOid}/photos/${PHOTO_SIZE}/$value`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Graph photo request failed (${res.status})`);
  return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') || 'image/jpeg' };
}

async function doRefresh(user) {
  const photo = await fetchPhoto(user.azureOid);
  const saved = await UserPhoto.findByPk(user.id);
  const changed = photo ? !saved?.data || !saved.data.equals(photo.data) : !!saved?.data;

  await UserPhoto.upsert({
    userId: user.id,
    data: photo?.data || null,
    contentType: photo?.contentType || null,
    checkedAt: new Date(),
  });
  if (changed || (!photo && user.photoUpdatedAt)) {
    await User.update({ photoUpdatedAt: photo ? new Date() : null }, { where: { id: user.id } });
  }
  return changed;
}

// Copies the user's current M365 photo (or its removal). Concurrent calls for one user share a request.
function refreshUserPhoto(user) {
  if (!refreshing.has(user.id)) {
    refreshing.set(user.id, doRefresh(user).finally(() => refreshing.delete(user.id)));
  }
  return refreshing.get(user.id);
}

// For sign-in: waits at most `timeoutMs`, never throws (sign-in mustn't depend on the photo)
async function refreshAtLogin(user, timeoutMs = 4000) {
  try {
    await Promise.race([
      refreshUserPhoto(user),
      new Promise((resolve) => { setTimeout(resolve, timeoutMs); }),
    ]);
  } catch (err) {
    logger.warn(`Could not read the M365 photo of ${user.email}: ${err.message}`);
  }
}

/**
 * Refreshes the photos of all active users not checked in the last day (after a user sync).
 * Runs a few requests at a time; returns { checked, changed, failed }.
 */
async function refreshAllPhotos() {
  const recent = new Set((await UserPhoto.findAll({
    attributes: ['userId'],
    where: { checkedAt: { [Op.gt]: new Date(Date.now() - RECHECK_MS) } },
    raw: true,
  })).map((p) => p.userId));
  const users = (await User.findAll({ where: { isActive: true }, attributes: ['id', 'email', 'azureOid', 'photoUpdatedAt'] }))
    .filter((u) => !recent.has(u.id));

  const result = { checked: 0, changed: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < users.length) {
      const user = users[next++];
      try {
        if (await refreshUserPhoto(user)) result.changed++;
        result.checked++;
      } catch {
        result.failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, worker));
  logger.info(`M365 photos: ${result.checked} checked, ${result.changed} changed, ${result.failed} failed`);
  return result;
}

// The saved photo of a user, or null. A photo checked more than a day ago is refreshed in the
// background (the saved one is served meanwhile).
async function getPhoto(userId) {
  const saved = await UserPhoto.findByPk(userId);
  if (!saved || Date.now() - new Date(saved.checkedAt).getTime() > RECHECK_MS) {
    const user = await User.findByPk(userId, { attributes: ['id', 'email', 'azureOid', 'photoUpdatedAt'] });
    if (user) refreshUserPhoto(user).catch((err) => logger.warn(`Photo refresh failed for ${user.email}: ${err.message}`));
  }
  return saved?.data ? { data: saved.data, contentType: saved.contentType } : null;
}

module.exports = { refreshUserPhoto, refreshAtLogin, refreshAllPhotos, getPhoto };
