import { cp } from 'node:fs/promises'
// Keep /storyforge/ routes and asset paths identical, including history fallback.
await cp('dist-android/storyforge/index.html', 'dist-android/index.html')
