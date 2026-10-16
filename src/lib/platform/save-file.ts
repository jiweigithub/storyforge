/** Platform handoff only: callers still create backups through PROJECT_TABLES. */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (import.meta.env.MODE === 'android') {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (Capacitor.getPlatform() === 'android') {
      const files = registerPlugin<{
        begin(): Promise<{ id: string }>
        append(options: { id: string; data: string }): Promise<void>
        save(options: { id: string; filename: string; mime: string }): Promise<void>
        discard(options: { id: string }): Promise<void>
      }>('StoryForgeFiles')
      const { id } = await files.begin()
      try {
        for (let offset = 0; offset < blob.size; offset += 49152) {
          const bytes = new Uint8Array(await blob.slice(offset, offset + 49152).arrayBuffer())
          let binary = ''
          for (const byte of bytes) binary += String.fromCharCode(byte)
          await files.append({ id, data: btoa(binary) })
        }
        await files.save({ id, filename, mime: blob.type.split(';')[0] || 'application/octet-stream' })
      } finally { await files.discard({ id }).catch(() => {}) }
      return
    }
  }
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
