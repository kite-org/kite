/* eslint-disable no-control-regex */
/**
 * Simple ANSI escape sequence parser for terminal output
 * Supports basic color codes and formatting
 */

// ANSI color codes mapping
const ANSI_COLORS = {
  // Standard colors (30-37, 90-97)
  30: '#000000', // black
  31: '#cd3131', // red
  32: '#0dbc79', // green
  33: '#e5e510', // yellow
  34: '#2472c8', // blue
  35: '#bc3fbc', // magenta
  36: '#11a8cd', // cyan
  37: '#e5e5e5', // white

  // Bright colors (90-97)
  90: '#666666', // bright black (gray)
  91: '#f14c4c', // bright red
  92: '#23d18b', // bright green
  93: '#f5f543', // bright yellow
  94: '#3b8eea', // bright blue
  95: '#d670d6', // bright magenta
  96: '#29b8db', // bright cyan
  97: '#ffffff', // bright white
} as const

// Background colors (40-47, 100-107)
const ANSI_BG_COLORS = {
  40: '#000000', // black
  41: '#cd3131', // red
  42: '#0dbc79', // green
  43: '#e5e510', // yellow
  44: '#2472c8', // blue
  45: '#bc3fbc', // magenta
  46: '#11a8cd', // cyan
  47: '#e5e5e5', // white

  100: '#666666', // bright black
  101: '#f14c4c', // bright red
  102: '#23d18b', // bright green
  103: '#f5f543', // bright yellow
  104: '#3b8eea', // bright blue
  105: '#d670d6', // bright magenta
  106: '#29b8db', // bright cyan
  107: '#ffffff', // bright white
} as const

export interface AnsiState {
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

interface ParsedSegment {
  text: string
  styles: AnsiState
}

/**
 * Parse ANSI escape sequences in a string and return styled segments
 */
export function parseAnsi(
  text: string,
  initialState: AnsiState = {}
): { segments: ParsedSegment[]; finalState: AnsiState } {
  const segments: ParsedSegment[] = []
  let currentState: AnsiState = { ...initialState }
  let currentText = ''

  // Regex to match ANSI escape sequences - using Unicode escape instead of hex
  const ansiRegex = new RegExp('\u001b\\[([0-9;]*)m', 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before the escape sequence
    const textBeforeEscape = text.slice(lastIndex, match.index)
    if (textBeforeEscape) {
      currentText += textBeforeEscape
    }

    // Process the escape sequence
    const codes = match[1] ? match[1].split(';').map(Number) : [0]
    const newState = processAnsiCodes(codes, { ...currentState })

    // If there's accumulated text, create a segment with the previous state
    if (currentText) {
      segments.push({
        text: currentText,
        styles: { ...currentState },
      })
      currentText = ''
    }

    currentState = newState
    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  const remainingText = text.slice(lastIndex)
  if (remainingText) {
    currentText += remainingText
  }

  // Add final segment if there's text
  if (currentText) {
    segments.push({
      text: currentText,
      styles: { ...currentState },
    })
  }

  return { segments, finalState: currentState }
}

/**
 * Process ANSI codes and update the state
 */
function processAnsiCodes(codes: number[], currentState: AnsiState): AnsiState {
  let newState = { ...currentState }

  for (const code of codes) {
    switch (code) {
      case 0: // Reset all
        newState = {}
        break

      case 1: // Bold
        newState.bold = true
        break

      case 3: // Italic
        newState.italic = true
        break

      case 4: // Underline
        newState.underline = true
        break

      case 22: // Normal intensity (not bold)
        newState.bold = false
        break

      case 23: // Not italic
        newState.italic = false
        break

      case 24: // Not underlined
        newState.underline = false
        break

      case 39: // Default foreground color
        delete newState.color
        break

      case 49: // Default background color
        delete newState.backgroundColor
        break

      default:
        // Foreground colors
        if (ANSI_COLORS[code as keyof typeof ANSI_COLORS]) {
          newState.color = ANSI_COLORS[code as keyof typeof ANSI_COLORS]
        }
        // Background colors
        else if (ANSI_BG_COLORS[code as keyof typeof ANSI_BG_COLORS]) {
          newState.backgroundColor =
            ANSI_BG_COLORS[code as keyof typeof ANSI_BG_COLORS]
        }
        break
    }
  }

  return newState
}

/**
 * Convert AnsiState to CSS styles
 */
export function ansiStateToCss(state: AnsiState): React.CSSProperties {
  const styles: React.CSSProperties = {}

  if (state.color) {
    styles.color = state.color
  }

  if (state.backgroundColor) {
    styles.backgroundColor = state.backgroundColor
  }

  if (state.bold) {
    styles.fontWeight = 'bold'
  }

  if (state.italic) {
    styles.fontStyle = 'italic'
  }

  if (state.underline) {
    styles.textDecoration = 'underline'
  }

  return styles
}

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  return text.replace(new RegExp('\u001b\\[[0-9;]*m', 'g'), '')
}

/**
 * Generate CSS class names for an AnsiState
 */
export function getAnsiClassNames(state: AnsiState): string {
  const classes: string[] = []

  if (state.color) {
    // Find the code for this color
    const code = Object.entries(ANSI_COLORS).find(
      ([, value]) => value === state.color
    )?.[0]
    if (code) classes.push(`ansi-fg-${code}`)
  }

  if (state.backgroundColor) {
    const code = Object.entries(ANSI_BG_COLORS).find(
      ([, value]) => value === state.backgroundColor
    )?.[0]
    if (code) classes.push(`ansi-bg-${code}`)
  }

  if (state.bold) classes.push('ansi-bold')
  if (state.italic) classes.push('ansi-italic')
  if (state.underline) classes.push('ansi-underline')

  return classes.join(' ')
}

/**
 * Generate CSS styles for all ANSI classes
 */
export function generateAnsiCss(): string {
  let css = ''

  // Foreground colors
  Object.entries(ANSI_COLORS).forEach(([code, color]) => {
    css += `.ansi-fg-${code} { color: ${color} !important; }\n`
  })

  // Background colors
  Object.entries(ANSI_BG_COLORS).forEach(([code, color]) => {
    css += `.ansi-bg-${code} { background-color: ${color} !important; }\n`
  })

  // Styles
  css += '.ansi-bold { font-weight: bold !important; }\n'
  css += '.ansi-italic { font-style: italic !important; }\n'
  css += '.ansi-underline { text-decoration: underline !important; }\n'

  return css
}
