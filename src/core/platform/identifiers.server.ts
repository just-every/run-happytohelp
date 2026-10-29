const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function newUlid(now = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  let time = now
  let identifier = ''
  for (let index = 0; index < 10; index += 1) {
    identifier = alphabet[time % 32] + identifier
    time = Math.floor(time / 32)
  }

  let random = ''
  for (const byte of bytes) {
    random += alphabet[byte >> 3]
  }

  return `${identifier}${random.slice(0, 16)}`
}
