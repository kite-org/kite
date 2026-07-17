// Log theme definitions
export type LogTheme =
  'classic' | 'matrix' | 'cyberpunk' | 'solarized' | 'monokai' | 'github'

export const LOG_THEMES: Record<
  LogTheme,
  {
    name: string
    bg: string
    text: string
    accent: string
    error: string
    warning: string
  }
> = {
  classic: {
    name: 'Classic Terminal',
    bg: 'bg-black',
    text: 'text-green-400',
    accent: 'text-blue-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
  },
  matrix: {
    name: 'Matrix',
    bg: 'bg-gray-900',
    text: 'text-green-300',
    accent: 'text-green-500',
    error: 'text-red-300',
    warning: 'text-yellow-300',
  },
  cyberpunk: {
    name: 'Cyberpunk',
    bg: 'bg-purple-950',
    text: 'text-cyan-300',
    accent: 'text-pink-400',
    error: 'text-red-400',
    warning: 'text-orange-400',
  },
  solarized: {
    name: 'Solarized Dark',
    bg: 'bg-slate-800',
    text: 'text-slate-200',
    accent: 'text-blue-300',
    error: 'text-red-300',
    warning: 'text-yellow-300',
  },
  monokai: {
    name: 'Monokai',
    bg: 'bg-zinc-900',
    text: 'text-gray-200',
    accent: 'text-purple-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
  },
  github: {
    name: 'GitHub',
    bg: 'bg-gray-50',
    text: 'text-gray-800',
    accent: 'text-blue-600',
    error: 'text-red-600',
    warning: 'text-orange-600',
  },
}

// Terminal theme definitions
export type TerminalTheme =
  'classic' | 'matrix' | 'cyberpunk' | 'solarized' | 'monokai' | 'github'

export const TERMINAL_THEMES: Record<
  TerminalTheme,
  {
    name: string
    background: string
    foreground: string
    cursor: string
    selection: string
    black: string
    red: string
    green: string
    yellow: string
    blue: string
    magenta: string
    cyan: string
    white: string
    brightBlack: string
    brightRed: string
    brightGreen: string
    brightYellow: string
    brightBlue: string
    brightMagenta: string
    brightCyan: string
    brightWhite: string
  }
> = {
  classic: {
    name: 'Classic Terminal',
    background: '#000000',
    foreground: '#5cdc70',
    cursor: '#ffffff',
    selection: '#ffffff40',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#ffffff',
  },
  matrix: {
    name: 'Matrix',
    background: '#0d1117',
    foreground: '#39ff14',
    cursor: '#39ff14',
    selection: '#39ff1440',
    black: '#000000',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#44475a',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  cyberpunk: {
    name: 'Cyberpunk',
    background: '#1a0033',
    foreground: '#00ffff',
    cursor: '#ff00ff',
    selection: '#ff00ff40',
    black: '#000000',
    red: '#ff0040',
    green: '#00ff41',
    yellow: '#ffff00',
    blue: '#0066ff',
    magenta: '#cc00ff',
    cyan: '#00ffff',
    white: '#ffffff',
    brightBlack: '#808080',
    brightRed: '#ff6680',
    brightGreen: '#66ff81',
    brightYellow: '#ffff66',
    brightBlue: '#6699ff',
    brightMagenta: '#ff66ff',
    brightCyan: '#66ffff',
    brightWhite: '#ffffff',
  },
  solarized: {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    selection: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  monokai: {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selection: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
  github: {
    name: 'GitHub Light',
    background: '#ffffff',
    foreground: '#24292e',
    cursor: '#24292e',
    selection: '#0366d625',
    black: '#24292e',
    red: '#d73a49',
    green: '#28a745',
    yellow: '#ffd33d',
    blue: '#0366d6',
    magenta: '#ea4aaa',
    cyan: '#39c5cf',
    white: '#6a737d',
    brightBlack: '#959da5',
    brightRed: '#cb2431',
    brightGreen: '#22863a',
    brightYellow: '#b08800',
    brightBlue: '#005cc5',
    brightMagenta: '#e36209',
    brightCyan: '#032f62',
    brightWhite: '#2c2c2c',
  },
}
