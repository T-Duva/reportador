export function apkDownloadUrl(version: string): string {
  const v = version.replace(/^v/i, '').trim()
  return `https://github.com/T-Duva/reportador/releases/download/v${v}/reportador.apk`
}
