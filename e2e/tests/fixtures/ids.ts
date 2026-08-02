let counter = 0

export function unique(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${counter++}`
}
