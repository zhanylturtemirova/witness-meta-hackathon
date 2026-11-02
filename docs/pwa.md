# Witness as an app

Witness includes an installable web manifest and an offline app shell. Run `npm run dev`, open the local URL, and let the offline setup finish. On a hosted domain it needs HTTPS and a fresh `npm run build`.

Chrome offers **Install Witness** when installation is available. On iPhone or iPad, open the app in Safari and use **Share → Add to Home Screen**. Installation does not create an account or sync browser data between devices.

## Without a connection

After the shell is saved, Witness can reopen, show saved stories, accept writing, and keep local recordings. Recording still needs browser microphone permission. Meta interviews, transcription, verification, and image generation require a reachable backend and internet connection. Local demo tools remain local demos.

The service worker caches only a build-generated list of public app files. Earth textures cache on demand when Connect is visited under the active service worker; a first visit before worker activation may need one connected return visit. Private audio and generated images remain in IndexedDB, not the public shell cache. API routes, POSTs, unknown paths, external requests, and URLs with query parameters bypass it.

If another tab has already saved newer data, the stale tab stops saving and offers **Download this tab’s draft** or **Reload saved version**. It does not merge concurrent editing sessions. Keep one editing tab open when recording or shaping a story.

Keep downloaded story backups: browser storage is not a permanent archive, and clearing site data removes it.

## Updates

Every build hashes its shell and Earth assets. A new worker prepares a separate cache and waits for **Reload to update**; it does not reload automatically. Active recording, transcription, and pending audio saves block that button. Old Witness shell caches are removed after activation; other app caches and local stories are left alone.

Push notifications, background questions, and cross-device storage are not implemented by this PWA shell. Those need their own permissions and server design.

## Checked locally

A real browser reopened the saved app after its test server was stopped and displayed the existing memory library. A waiting update was applied through its button; saved answers remained. The browser voice flow used a synthetic fictional WAV and simulated API responses to check attachment and continuation. This does not establish microphone capture, Meta recognition accuracy, or installation on an actual phone.
