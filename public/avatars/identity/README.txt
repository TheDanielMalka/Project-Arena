Identity Studio — portrait PNGs (bundled)
==========================================

This folder contains 18 PNG key-art style busts keyed by preset id:
  ash_chieftain.png … emerald_samurai.png

- Served from the app as /avatars/identity/<file>
- DB / users.avatar stays preset:<id> (unchanged)

S3 / CDN (production)
---------------------
Set in .env:
  VITE_AVATAR_CDN_BASE=https://<your-bucket>.s3.<region>.amazonaws.com/identity/

Upload the same filenames to that prefix. Local files are unused when this is set.

Dev fallbacks (only if you intentionally unset CDN and delete a PNG)
-------------------------------------------------------------------
  VITE_IDENTITY_PORTRAITS=pollinations
  VITE_IDENTITY_PORTRAITS=dicebear
