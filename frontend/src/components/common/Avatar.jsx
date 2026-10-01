import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { initials } from '../../utils/format';

// Photos already loaded in this tab: "id:version" -> Promise<object URL | null>
const photos = new Map();

// The photo endpoint needs the app token, so it's fetched with axios rather than <img src>
function loadPhoto(id, version) {
  const key = `${id}:${version}`;
  if (!photos.has(key)) {
    photos.set(key, api.get(`/users/${id}/photo`, { params: { v: version }, responseType: 'blob' })
      .then(({ data }) => URL.createObjectURL(data))
      .catch(() => null));
  }
  return photos.get(key);
}

/**
 * Round avatar: the user's Microsoft 365 profile photo when they have one (user.photoUpdatedAt is
 * set), otherwise their initials. `size`: undefined (32 px) or 'lg' (64 px).
 */
export default function Avatar({ user, size }) {
  const id = user?.id;
  const version = user?.photoUpdatedAt ? new Date(user.photoUpdatedAt).getTime() : null;
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (id && version) loadPhoto(id, version).then((url) => { if (!cancelled) setSrc(url); });
    return () => { cancelled = true; };
  }, [id, version]);

  const name = user?.displayName || user?.name || user?.email;
  return (
    <span className={size === 'lg' ? 'avatar avatar--lg' : 'avatar'} title={name || undefined}>
      {src ? <img src={src} alt="" className="avatar__img" /> : initials(name)}
    </span>
  );
}
