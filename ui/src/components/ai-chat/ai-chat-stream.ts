type SSEEventHandler = (
  eventType: string,
  data: Record<string, unknown>
) => void

export async function readAIChatSSEStream(
  response: Response,
  onEvent: SSEEventHandler
): Promise<string | null> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  let eventDataLines: string[] = []
  let streamError: string | null = null

  const flushEvent = () => {
    if (!eventType || eventDataLines.length === 0) {
      eventType = ''
      eventDataLines = []
      return
    }

    try {
      const data = JSON.parse(eventDataLines.join('\n'))
      if (
        eventType === 'error' &&
        streamError == null &&
        typeof data?.message === 'string' &&
        data.message.trim() !== ''
      ) {
        streamError = data.message
      }
      onEvent(eventType, data)
    } catch {
      // ignore invalid SSE payload
    }

    eventType = ''
    eventDataLines = []
  }

  const processLine = (line: string) => {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      eventDataLines.push(line.slice(6))
    } else if (line === '') {
      flushEvent()
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      processLine(line)
    }
  }

  buffer += decoder.decode()
  const remainingLines = buffer.split('\n')
  buffer = remainingLines.pop() || ''
  for (const line of remainingLines) {
    processLine(line)
  }

  if (buffer.trim() !== '') {
    processLine(buffer.trim())
  }
  flushEvent()

  return streamError
}
